// Turning a decklist into the counts lib/deck-score.ts consumes.
//
// DeckCheck scores its rubric against a curated card database. This is our version
// of that: a curated list of the cards the rubric names (lib/deck-score-cards.ts)
// with oracle-text reading for everything else. Text reading gets the common
// cases right — "search your library" is a tutor, "counter target spell" is a
// counterspell, an Instant is instant speed — and is roughly right at the
// margins, which is why every reading names the cards it counted so a player
// can see what it saw.
//
// The two judgements the rubric leaves to a human — the fundamental turn and
// commander dependency — are COMPUTED here rather than defaulted. The turn
// comes from a goldfish simulation (lib/goldfish.ts); dependency from where
// the deck's engine and win lines actually live. Both are explained in the
// result, because a number with no working is a verdict nobody can argue with.

import type { CombatInput, CommanderDependency, ConsistencyInput, InteractionInput, ResilienceInput } from "./deck-score";
import { readLadder, TUTOR_LADDER } from "./deck-score";
import {
  BOARD_LEVEL_PROTECTION,
  BURST_DRAW,
  COMBO_TUTORS,
  EFFECTIVE_COUNTERS,
  FREE_INTERACTION,
  GRAVEYARD_TUTORS,
  HARD_WIPES,
  NARROW_TUTORS,
  ONE_SHOT_DRAW,
  PREMIUM_DRAW,
  PREMIUM_TUTORS,
  RECURSION_COMMANDERS,
  RECURSION_ENGINES,
  SELECTION,
  STANDARD_DRAW,
  STANDARD_TUTORS,
  STAX_PIECES,
  TURN_PROTECTION,
  TUTOR_ENGINES,
} from "./deck-score-cards";

// ---------------------------------------------------------------------------
// The card, as the classifier sees it
// ---------------------------------------------------------------------------

export interface ScoredCard {
  name: string;
  typeLine: string;
  oracleText: string;
  manaCost: string | null;
  manaValue: number;
  quantity: number;
  /** Null when Scryfall facts were unavailable or the card has no power. */
  power: number | null;
  toughness: number | null;
  keywords: string[];
  producedMana: string[];
  isCommander: boolean;
}

/** A combo line as Commander Spellbook reports it. */
export interface ComboLineInput {
  pieces: string[];
  produces: string[];
  /** e.g. "{U}{U}{B}" or "". */
  manaNeeded: string;
}

/** Mana value from a cost string like "{2}{U}{U}" — generic plus one per pip. */
export function manaValue(manaCost: string | null): number {
  if (!manaCost) return 0;
  let total = 0;
  for (const sym of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const body = sym[1] ?? "";
    const n = Number.parseInt(body, 10);
    if (Number.isFinite(n)) total += n;
    else if (body !== "X" && body !== "Y" && body !== "Z") total += 1;
  }
  return total;
}

export const nameKey = (name: string): string =>
  name.trim().replace(/\s+/g, " ").toLowerCase().split(" // ")[0]!;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

interface Read {
  card: ScoredCard;
  key: string;
  /** Lowercased oracle text with the card's own name replaced by "~". */
  text: string;
  /** The text's first line — the primary effect for most spells. */
  first: string;
  type: string;
  mv: number;
  copies: number;
  isLand: boolean;
  isCreature: boolean;
  isPermanent: boolean;
  isInstantSpeed: boolean;
  keywords: Set<string>;
}

function read(card: ScoredCard): Read {
  const type = (card.typeLine ?? "").toLowerCase();
  const full = card.name.toLowerCase();
  const short = full.split(",")[0]!.split(" // ")[0]!;
  // Reminder text goes: "(Search your library for a basic land card…)" on a
  // landcycler is not a tutor, and "(Draw a card.)" on a cycling grant is not
  // a draw engine. Then the card's self-references become "~" — the printed
  // name, and Scryfall's newer "this creature" / "this artifact" wording.
  let text = (card.oracleText ?? "").toLowerCase().replace(/\([^)]*\)/g, "");
  if (full) text = text.split(full).join("~");
  if (short && short.length > 3) text = text.split(short).join("~");
  text = text.replace(/\bthis (creature|artifact|enchantment|permanent|land|planeswalker|spell|card|vehicle|equipment|aura|token|battle|saga)\b/g, "~");
  const keywords = new Set(card.keywords.map((k) => k.toLowerCase()));
  const isLand = /\bland\b/.test(type.split("—")[0] ?? type);
  return {
    card,
    key: nameKey(card.name),
    text,
    first: text.split("\n")[0] ?? "",
    type,
    mv: card.manaValue,
    copies: Math.max(1, card.quantity),
    isLand,
    isCreature: /\bcreature\b/.test(type),
    isPermanent: /\b(creature|artifact|enchantment|planeswalker|land|battle)\b/.test(type),
    isInstantSpeed: /\binstant\b/.test(type) || keywords.has("flash") || /\bflash\b/.test(text),
    keywords,
  };
}

const has = (r: Read, re: RegExp): boolean => re.test(r.text);
const firstHas = (r: Read, re: RegExp): boolean => re.test(r.first);

/** A line of the text that is an activated ability ("cost: effect"). */
const activatedLine = (r: Read, re: RegExp): boolean =>
  r.text.split("\n").some((line) => /^[^:]{1,80}:/.test(line) && re.test(line));
const triggeredLine = (r: Read, re: RegExp): boolean =>
  r.text.split("\n").some((line) => /^(whenever|at the beginning of|when )/.test(line) && re.test(line));
const etbOnly = (r: Read, re: RegExp): boolean =>
  r.text.split("\n").some((line) => /^when ~ enters/.test(line) && re.test(line)) &&
  !r.text.split("\n").some((line) => /^(whenever|at the beginning of)/.test(line) && re.test(line)) &&
  !activatedLine(r, re);
const combatLine = (r: Read, re: RegExp): boolean =>
  r.text
    .split("\n")
    .some((line) => /(attacks|deals combat damage|blocks|becomes blocked|attacking creature)/.test(line) && re.test(line));

// ---------------------------------------------------------------------------
// Tutors
// ---------------------------------------------------------------------------

export interface TutorReading {
  points: number;
  premium: boolean;
  /** A repeatable engine, "a permanent that tutors every turn". */
  engine: boolean;
  /** Only scores once the deck has a recursion package. */
  graveyardDestination: boolean;
  /** Finds pieces straight onto the battlefield, repeatably. */
  battlefield: boolean;
}

const SEARCH = /search your library/;
const LAND_TARGET = /\b(land|plains|island|swamp|mountain|forest|gate|locus|desert)\b/;
const NONLAND_TARGET = /\b(nonland|creature|artifact|enchantment|instant|sorcery|planeswalker|permanent|card named|legendary|equipment|aura|spell)\b/;

/** What the search looks for: the phrase between "for" and "card". */
function searchTarget(text: string): string {
  const m = text.match(/search your library for ([^.]*?)(?: cards?\b|,|\.|$)/);
  return m?.[1] ?? "";
}

export function tutorReading(r: Read): TutorReading | null {
  if (r.isLand && !SEARCH.test(r.text)) return null;
  const none: TutorReading = { points: 0, premium: false, engine: false, graveyardDestination: false, battlefield: false };

  if (PREMIUM_TUTORS.has(r.key)) return { ...none, points: 6, premium: true };
  if (COMBO_TUTORS.has(r.key)) return { ...none, points: 4 };
  if (GRAVEYARD_TUTORS.has(r.key)) return { ...none, points: 4, graveyardDestination: true };

  // Transmute's search lives in reminder text, which read() strips; the
  // keyword is the tutor. Standard tier: restricted to one mana value.
  if (r.keywords.has("transmute") || /^transmute \{/m.test(r.text)) return { ...none, points: 4 };
  const searches = SEARCH.test(r.text);
  const repeatable =
    r.isPermanent &&
    (activatedLine(r, SEARCH) || (triggeredLine(r, SEARCH) && !etbOnly(r, SEARCH))) &&
    !combatLine(r, SEARCH);
  const battlefield = repeatable && /onto the battlefield/.test(r.text);
  // Attack-trigger materialisation (Gishath, Winota class): a battlefield
  // tutor by the rubric's July addendum, at the combat-conditioned 4.
  const attackMaterialise = r.isPermanent && combatLine(r, /onto the battlefield/) && combatLine(r, /(search your library|look at the top|reveal the top)/);

  if (TUTOR_ENGINES.has(r.key) && repeatable) return { ...none, points: 6, premium: true, engine: true, battlefield };
  if (STANDARD_TUTORS.has(r.key) && (searches || attackMaterialise || /look at the top/.test(r.text))) return { ...none, points: 4, battlefield: attackMaterialise };
  if (NARROW_TUTORS.has(r.key)) return { ...none, points: 2 };
  if (attackMaterialise) return { ...none, points: 4, battlefield: true };
  if (!searches) return null;

  const target = searchTarget(r.text);
  // "Search your library for a basic land" is ramp, not a tutor.
  if (LAND_TARGET.test(target) && !NONLAND_TARGET.test(target)) return null;
  // Fetch lands and similar: a land that searches for a land.
  if (r.isLand) return null;

  if (/put (it|that card|those cards|them) into your graveyard/.test(r.text)) {
    return { ...none, points: 4, graveyardDestination: true };
  }
  if (repeatable) return { ...none, points: 6, premium: true, engine: true, battlefield };
  if (combatLine(r, SEARCH)) return { ...none, points: 4 };

  const restricted = target !== "a" && target !== "" && !/^(a|any)$/.test(target.trim());
  if (r.mv <= 2 && !restricted) return { ...none, points: 6, premium: true };
  if (r.mv <= 4) return { ...none, points: 4 };
  return { ...none, points: 2 };
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

export type DrawKind = "burst" | "premium" | "engine" | "combat" | "political" | "selection" | "oneshot" | "symmetric" | "monarch";

export interface DrawReading {
  points: number;
  kind: DrawKind;
}

const DRAW = /draw(s)? (a|an|one|two|three|four|five|six|seven|x|that many|\w+)( additional| extra)? cards?/;
const WHEEL = /each player (discards|shuffles) (their|his or her) hand[^.]*draws? (seven |\w+ )?cards/;

export function drawReading(r: Read): DrawReading | null {
  if (BURST_DRAW.has(r.key) || (has(r, WHEEL) && !r.isLand)) return { points: 6, kind: "burst" };
  if (PREMIUM_DRAW.has(r.key)) return { points: 5, kind: "premium" };
  if (SELECTION.has(r.key)) return { points: 3, kind: "selection" };
  // "Cards that trigger on your opponents' draws are punishers, not draw
  // sources — they score as Interaction, never here."
  if (has(r, /whenever an opponent draws/) && !has(r, /you draw|draw a card\./)) return null;
  if (r.keywords.has("cycling") && !has(r, DRAW) && !has(r, /scry|surveil/)) return null;

  const draws = has(r, DRAW) || has(r, /draws? cards? equal to/);
  const selectionText = /\b(scry \d|surveil \d|look at the top (\w+ )?cards?|loot|connive|discard a card, then draw|draw a card, then discard)\b/;

  if (has(r, /you become the monarch|becomes? the monarch/)) return { points: 4, kind: "monarch" };

  if (draws) {
    // Symmetric gifts: three opponents drink first.
    if (has(r, /each (player|opponent)('s)?[^.]*draws?|all players draw/) && !has(r, /you draw|you may draw/)) {
      return { points: 2, kind: "symmetric" };
    }
    if (r.isPermanent) {
      if (combatLine(r, DRAW)) return { points: 3, kind: "combat" };
      if (triggeredLine(r, DRAW) && !etbOnly(r, DRAW)) {
        if (has(r, /whenever an opponent/)) return { points: 3, kind: "political" };
        return { points: 4, kind: "engine" };
      }
      if (activatedLine(r, DRAW)) {
        if (has(r, /sacrifice ~/)) return { points: 2, kind: "oneshot" };
        return { points: 4, kind: "engine" };
      }
      if (etbOnly(r, DRAW)) return { points: 2, kind: "oneshot" };
      if (has(r, /whenever|at the beginning/)) return { points: 4, kind: "engine" };
      return { points: 2, kind: "oneshot" };
    }
    // Instants and sorceries: the primary effect decides.
    if (firstHas(r, DRAW) || firstHas(r, /target player draws/)) {
      const single = firstHas(r, /draw a card/) && !firstHas(r, /draw (two|three|four|five|x|\w+ cards)/);
      if (single && (has(r, selectionText) || r.text.length < 60)) return { points: 3, kind: "selection" };
      if (single) return null; // a cantrip stapled to another effect is not a draw source
      return { points: 2, kind: "oneshot" };
    }
    if (has(r, selectionText) && r.mv <= 2) return { points: 3, kind: "selection" };
    return null;
  }

  // Selection with no draw: scry, surveil, dig — the primary effect, cheap.
  if (has(r, selectionText)) {
    if (!r.isPermanent && firstHas(r, selectionText)) return { points: 3, kind: "selection" };
    if (r.isPermanent && !r.isCreature && !r.isLand && activatedLine(r, selectionText)) return { points: 3, kind: "selection" };
    if (SELECTION.has(r.key)) return { points: 3, kind: "selection" };
    return null;
  }
  if (has(r, /investigate|create a clue/)) return { points: 2, kind: "oneshot" };
  // Impulse draw: exile the top and play it.
  if (has(r, /exile the top (card|two cards|three cards)[\s\S]{0,120}you may (play|cast)/)) {
    if (!r.isPermanent) return { points: 2, kind: "oneshot" };
    if (combatLine(r, /exile the top/)) return { points: 3, kind: "combat" };
    if (triggeredLine(r, /exile the top/) || activatedLine(r, /exile the top/)) return { points: 4, kind: "engine" };
    return { points: 2, kind: "oneshot" };
  }

  if (STANDARD_DRAW.has(r.key)) return { points: 4, kind: "engine" };
  if (SELECTION.has(r.key)) return { points: 3, kind: "selection" };
  if (ONE_SHOT_DRAW.has(r.key)) return { points: 2, kind: "oneshot" };
  return null;
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

export interface InteractionReadingCard {
  piece: boolean;
  counterspell: boolean;
  free: boolean;
  turnProtection: boolean;
  instantSpeed: boolean;
  /** Exile-all / each-player-sacrifices / −X/−X at CMC ≤ 4. */
  hardWipe: boolean;
  wipe: boolean;
  /** A wipe that hits your board too. Creature-only wipes are re-judged by the deck. */
  symmetricWipe: boolean;
  creatureOnlyWipe: boolean;
  removal: boolean;
  bounce: boolean;
  answersCreatures: boolean;
  answersArtifacts: boolean;
  answersEnchantments: boolean;
  protection: boolean;
  boardLevel: boolean;
  attackDeterrent: boolean;
  stax: boolean;
  /** Stack protection: counters, free interaction, turn protection. */
  stackProtection: boolean;
}

const ENGINES_NOT_STAX = new Set(["rhystic study", "mystic remora", "esper sentinel", "smothering tithe"]);

const TARGETS = "(target|another target|up to \\w+ target|all|each|any number of target|x target)";
const OBJ_CREATURE = "(creature|creatures|nonland permanent|nonland permanents|permanent|permanents|creature or planeswalker|attacking creature|blocking creature|attacking or blocking creature|creature or enchantment|artifact or creature|artifact, creature|creature, enchantment|artifact, creature, or enchantment|nontoken creature|non-\\w+ creature|creature token|creature an opponent controls|creatures your opponents control|creature with)";
const OBJ_ARTIFACT = "(artifact|artifacts|nonland permanent|nonland permanents|permanent|permanents|artifact or enchantment|artifact or creature|artifact, creature|noncreature permanent|artifact, creature, or enchantment|artifact or land|artifact, enchantment)";
const OBJ_ENCHANTMENT = "(enchantment|enchantments|nonland permanent|nonland permanents|permanent|permanents|artifact or enchantment|noncreature permanent|creature or enchantment|artifact, creature, or enchantment|creature, enchantment|artifact, enchantment)";

const OBJECT = "(creature|creatures|artifact|artifacts|enchantment|enchantments|permanent|permanents|nonland|noncreature|nonbasic|nonblack|nonwhite|nonblue|nonred|nongreen|land|lands|planeswalker|planeswalkers|attacking|blocking|tapped|untapped|token|tokens|other|non-\\w+|\\w+ creature|\\w+ permanent|battle|battles)(?! card)";
const DESTROY_EXILE = new RegExp(`\\b(destroy|exile) ${TARGETS} ${OBJECT}`);
const DAMAGE = /deals? (\d+|x|that much|damage equal to)( damage)? (damage )?to (any target|target creature|target creature or planeswalker|target creature an opponent controls|each creature|each creature your opponents control|target opponent or planeswalker|target player or planeswalker|target attacking|target blocking|each opponent and each creature|another target creature)/;
const SHRINK = /(target|each|all) (creature|creatures|creature or planeswalker)[^.]* gets? -\d+\/-\d+|gets? -x\/-x|get -x\/-x|all creatures get -\d+\/-\d+|each creature gets -\d+\/-\d+/;
const EDICT = /(each opponent|target player|target opponent|each player|that player) sacrifices/;
const FIGHT = /\bfights? (target|another target|up to)|deals damage equal to its power to (target|another target)/;
const BOUNCE = new RegExp(`return ${TARGETS} (creature|creatures|nonland permanent|nonland permanents|permanent|permanents|artifact|enchantment|planeswalker)[^.]* to (its|their) owner'?s'? hands?`);
const COUNTER = /counter target (spell|ability|activated|triggered|noncreature|creature|instant|sorcery|artifact|enchantment|planeswalker|\w+ spell)|counter (it|that spell|that ability)|change the target of target spell|gain control of target spell/;
const WIPE = /(destroy|exile) (all|each) (creature|creatures|nonland permanent|nonland permanents|permanent|permanents|artifact|artifacts|enchantment|enchantments|other creatures|other permanents|artifacts and enchantments|artifacts, creatures, and enchantments|nontoken|creatures and planeswalkers)|each player sacrifices all|all creatures get -\d+\/-\d+|each creature gets -x\/-x|all creatures get -x\/-x|each creature gets -\d+\/-\d+|deals? \d+ damage to each creature/;
const GRAVEYARD_HATE = /exile (target|all|each) (player's|opponent's|card|cards)[^.]*graveyard|exile all (cards from all )?graveyards|exile target card from a graveyard|exile each opponent's graveyard|cards in graveyards can't|from graveyards? can't/;
const HAND_ATTACK = /target (player|opponent) (reveals|discards)|each opponent discards/;
const THEFT = /gain control of (target|another target|each|all)/;
const PROTECT_GRANT = /(gains?|have|has|with|get|gets)[^.]*\b(hexproof|indestructible|shroud|protection from)\b|regenerate (target|~|another|each|all|it)\b|: regenerate|prevent all (combat )?damage|phases? out|counter target spell (or ability )?that targets|can't be the target of spells or abilities|equipped creature (has|gains) (hexproof|shroud|indestructible)|damage that would be dealt to (you|creatures you control|permanents you control)[^.]*prevented/;
const BOARD_LEVEL = /(creatures|permanents|nonland permanents|other permanents|other creatures) you control (gain|have|get)[^.]*\b(hexproof|indestructible)\b|you gain protection from everything|until your next turn, you and permanents you control gain|prevent all (combat )?damage that would be dealt (this turn|to creatures)|prevent all combat damage|phases? out[^.]*(permanents|creatures) you control|exile (any number of|up to \w+|all|each)[^.]*(creatures|permanents) you control[^.]*return|damage that would be dealt to you and permanents you control this turn is prevented|creatures you control can't be dealt damage/;
const DETERRENT = /creatures can't attack you (or planeswalkers you control )?unless|can't attack you or planeswalkers you control unless|can't attack you unless|no more than one creature can attack (you|each combat)|creatures can't attack (you|planeswalkers you control) unless|attack you if able|goad/;
const STAX_TEXT = /(players|opponents|your opponents|each opponent|each player|your opponent) can't (search|draw more|cast|untap|activate|play|gain|sacrifice)|(spells|noncreature spells|creature spells|artifact spells|instant and sorcery spells) cost \{?\d\}? more to cast|can't cast more than one spell each turn|activated abilities of (artifacts|creatures|nonmana|lands) can't be activated|(creatures|artifacts|nonbasic lands|permanents|lands) your opponents control enter (the battlefield )?tapped|don't untap during (their|its) controller'?s'? untap step|players can't|each player can't|no more than one (spell|creature)|nonbasic lands are mountains|whenever an opponent (draws a card|searches (their|his or her) library|casts a spell|casts their first)[^.]*(deals? \d+ damage|loses \d+ life|counter|sacrifice|exile|can't)|creature spells can't be countered|opponents can't|activated abilities can't be activated|cards can't be put into graveyards|if a (card|permanent) would (be put into|leave)/;

export function interactionReadingCard(r: Read, creatureCards: number): InteractionReadingCard {
  const none: InteractionReadingCard = {
    piece: false, counterspell: false, free: false, turnProtection: false, instantSpeed: false,
    hardWipe: false, wipe: false, symmetricWipe: false, creatureOnlyWipe: false, removal: false, bounce: false,
    answersCreatures: false, answersArtifacts: false, answersEnchantments: false,
    protection: false, boardLevel: false, attackDeterrent: false, stax: false, stackProtection: false,
  };
  const out = { ...none };
  const t = r.text;

  out.counterspell = COUNTER.test(t) || EFFECTIVE_COUNTERS.has(r.key);
  out.turnProtection =
    TURN_PROTECTION.has(r.key) ||
    /(opponents|players|your opponents) can't cast spells (during your turn|this turn)|can't cast spells this turn|your opponents can't cast spells during your turn|can cast spells only (any time they could cast a sorcery|during their own turns?)/.test(t);

  const destroys = DESTROY_EXILE.test(t) && !/exile ~/.test(t.split("\n")[0] ?? "");
  const damages = DAMAGE.test(t);
  const shrinks = SHRINK.test(t);
  const edicts = EDICT.test(t);
  const fights = FIGHT.test(t);
  out.bounce = BOUNCE.test(t);
  out.removal = destroys || damages || shrinks || edicts || fights;
  out.wipe = WIPE.test(t);
  const graveyardHate = GRAVEYARD_HATE.test(t);
  // A wheel empties three opponents' hands: targeted hand attack, at scale.
  const handAttack = HAND_ATTACK.test(t) || WHEEL.test(t);
  const theft = THEFT.test(t) && !/gain control of target spell/.test(t);
  out.attackDeterrent = DETERRENT.test(t);
  // Taxes on opponents' spells (Rhystic Study, Mystic Remora, Esper
  // Sentinel, Smothering Tithe) are draw engines first, but they are also
  // the "hoser punishers" the count includes: they change what an opponent
  // can do on the stack.
  const tax = ENGINES_NOT_STAX.has(r.key) || /whenever an opponent casts (a|their first) (spell|noncreature spell)[^.]*unless (that player|they) pays?/.test(t);
  out.stax = STAX_PIECES.has(r.key) || STAX_TEXT.test(t) || tax;
  out.protection = PROTECT_GRANT.test(t) || out.attackDeterrent;
  out.boardLevel =
    BOARD_LEVEL.test(t) &&
    (!r.isPermanent || activatedLine(r, BOARD_LEVEL) || triggeredLine(r, BOARD_LEVEL) || /sacrifice ~/.test(t));
  if (BOARD_LEVEL_PROTECTION.has(r.key) && BOARD_LEVEL.test(t)) out.boardLevel = true;

  // Symmetry and scope for wipes.
  if (out.wipe) {
    const oneSided =
      /each opponent sacrifices|your opponents control|(you control )?(don't|aren't|can't be) destroyed|except|other than|you control gain indestructible|return[^.]*you control/.test(t) &&
      !/destroy all creatures\./.test(t);
    const creatureOnly = /(destroy|exile) (all|each) (creatures?|other creatures|creatures and planeswalkers)\b|all creatures get|each creature gets|damage to each creature/.test(t) && !/permanent|artifact|enchantment/.test(t);
    out.creatureOnlyWipe = creatureOnly;
    // Symmetry is judged in context: a creature-only wrath in a deck running
    // 8 or fewer creatures is effectively one-sided.
    out.symmetricWipe = !oneSided && !(creatureOnly && creatureCards <= 8);
    const hard = /exile (all|each)|each player sacrifices|-x\/-x|-\d+\/-\d+/.test(t);
    out.hardWipe = (hard || HARD_WIPES.has(r.key)) && hard && r.mv <= 4;
  }

  const objects = t;
  if (out.removal || out.wipe) {
    out.answersCreatures =
      new RegExp(`(${TARGETS}|any target) ${OBJ_CREATURE}\\b(?! card)`).test(objects) || damages || shrinks || edicts || fights ||
      /any target|destroy all creatures|each creature/.test(objects);
    out.answersArtifacts = new RegExp(`${TARGETS} ${OBJ_ARTIFACT}\\b(?! card)`).test(objects) || /(destroy|exile) (all|each) artifacts?/.test(objects);
    out.answersEnchantments =
      new RegExp(`${TARGETS} ${OBJ_ENCHANTMENT}\\b(?! card)`).test(objects) || /(destroy|exile) (all|each) enchantments?/.test(objects);
    // "Target artifact or enchantment" style lists.
    if (/target (artifact|enchantment)( or (artifact|enchantment|creature|planeswalker))+/.test(objects)) {
      if (/artifact/.test(objects)) out.answersArtifacts = true;
      if (/enchantment/.test(objects)) out.answersEnchantments = true;
    }
  }

  out.piece =
    out.removal || out.counterspell || out.wipe || out.bounce || graveyardHate || handAttack || theft ||
    out.protection || out.stax || out.turnProtection || out.boardLevel;

  if (!out.piece) return none;

  // Instant speed: the type, flash, or an activated ability (usable any time).
  const activatedAnswer =
    r.isPermanent &&
    activatedLine(r, /destroy|exile|counter|deals? \d+ damage|sacrifices|-\d+\/-\d+|gains? (hexproof|indestructible)|return/);
  out.instantSpeed = r.isInstantSpeed || activatedAnswer;

  // Free: 0 mana, an alternative cost, or the "if you control a commander" cycle.
  const altCost =
    /rather than pay (this spell's|its|~'s) mana cost|you may pay \d+ life rather than|without paying its mana cost if|if you control a commander, you may cast this spell without paying|exile a[n]? \w+ card (you own )?from your hand rather than pay|you may exile a[n]? (blue|black|red|green|white) card/.test(t);
  out.free = (!r.isPermanent || r.keywords.has("flash")) && (r.mv === 0 || altCost || FREE_INTERACTION.has(r.key));
  if (r.isLand) out.free = false;

  out.stackProtection = out.counterspell || out.free || out.turnProtection;
  return out;
}

// ---------------------------------------------------------------------------
// Resilience readings
// ---------------------------------------------------------------------------

export interface ThreatReading {
  /** 1 for a threat, 0.5 for a vanilla beatstick, 0 for none. */
  weight: number;
  selfProtecting: boolean;
  deathtouch: boolean;
  /** Small body that counts toward a go-wide aggregate. */
  small: boolean;
  anthem: boolean;
  tokenEngine: boolean;
}

const EVASION = ["flying", "trample", "menace", "deathtouch", "shadow", "fear", "intimidate", "horsemanship", "skulk", "infect", "toxic", "double strike", "annihilator", "wither"];
const SELF_PROTECT = ["hexproof", "indestructible", "shroud", "ward", "protection", "undying", "persist"];

export function threatReading(r: Read): ThreatReading {
  const none: ThreatReading = { weight: 0, selfProtecting: false, deathtouch: false, small: false, anthem: false, tokenEngine: false };
  const t = r.text;
  const makesOwnTokens = /create (a|an|two|three|x|that many|\d+) [^.]*tokens?/;
  const tokenEngine =
    r.isPermanent && !r.isLand &&
    (triggeredLine(r, makesOwnTokens) || activatedLine(r, makesOwnTokens)) &&
    !etbOnly(r, makesOwnTokens) &&
    !/(opponent|player) creates/.test(t);
  const anthem = /(creatures|creature tokens|other creatures|\w+ creatures) you control get \+\d\/\+\d|creatures you control have|would create one or more tokens[^.]*instead|twice that many/.test(t);
  const isPlaneswalker = /\bplaneswalker\b/.test(r.type);
  const manland = r.isLand && /becomes? a[n]? [^.]*creature/.test(t);
  const drainEngine = r.isPermanent && (triggeredLine(r, /each opponent loses \d+ life|deals? \d+ damage to each opponent/) || /whenever[^.]*each opponent loses/.test(t));
  const theftOrClone = r.isPermanent && (/gain control of/.test(t) || /(enters|enter) (the battlefield )?as a copy of|you may have ~ enter as a copy/.test(t));

  if (isPlaneswalker || manland || (tokenEngine && !r.isCreature) || drainEngine || theftOrClone) {
    return { ...none, weight: 1, anthem, tokenEngine };
  }
  if (!r.isCreature) return { ...none, anthem, tokenEngine };

  const evasive = (EVASION.some((k) => r.keywords.has(k)) || /can't be blocked/.test(t)) && (r.card.power ?? r.mv) >= 2;
  const selfProtecting = SELF_PROTECT.some((k) => r.keywords.has(k)) || /~ (has|gains|can't be the target)/.test(t);
  const deathtouch = r.keywords.has("deathtouch");
  const power = r.card.power ?? r.mv;
  const big = power >= 4;
  const small = power <= 2 && r.mv <= 3;
  const valueText = t.replace(/\b(flying|trample|menace|vigilance|haste|reach|first strike|double strike|lifelink|deathtouch|hexproof|indestructible|defender|flash|ward \d|protection from \w+)\b[,.]?\s*/g, "").trim();
  const hasEngine = valueText.length > 0 || tokenEngine || drainEngine;

  if (r.card.isCommander) return { ...none, weight: 1, selfProtecting, deathtouch, small, anthem, tokenEngine };
  if (!(big || evasive || deathtouch)) return { ...none, selfProtecting, deathtouch, small, anthem, tokenEngine };
  // "A vanilla beatstick — big power with no evasion, no self-protection, and
  // no value engine attached — weighs HALF."
  const vanilla = big && !evasive && !selfProtecting && !hasEngine;
  return { weight: vanilla ? 0.5 : 1, selfProtecting, deathtouch, small, anthem, tokenEngine };
}

export interface RecursionReading {
  points: number;
  engine: boolean;
  kind: "format-defining" | "repeatable" | "mass" | "exile" | "token" | "flicker" | "one-shot" | "hand";
}

const RECUR_TO_BATTLEFIELD = /return (target|another target|up to \w+ target|all|each|any number of target|x target)[^.]*(from (your|a|each player's|all|their) graveyards?|graveyard)[^.]* (onto|to) the battlefield|put (target|a|all|each)[^.]*from (your|a) graveyard onto the battlefield/;
const RECUR_TO_HAND = /return (target|another target|up to \w+ target)[^.]*from your graveyard to your hand|return[^.]*graveyard[^.]*to (its owner's|your) hand|from your graveyard to your hand/;
const RECUR_CAST = /you may (cast|play)[^.]*from your graveyard/;
const FROM_EXILE = /return[^.]*from exile|from exile (to|onto)/;
const FLICKER = /exile (target|another target|up to \w+ target)[^.]*(then )?return (it|that card|them)[^.]*(to|onto) the battlefield/;

export function recursionReading(r: Read): RecursionReading | null {
  const t = r.text;
  const toBattlefield = RECUR_TO_BATTLEFIELD.test(t);
  const toHand = RECUR_TO_HAND.test(t);
  const castFrom = RECUR_CAST.test(t);
  const fromExile = FROM_EXILE.test(t);
  const mass = /return (all|each|any number of)[^.]*graveyard[^.]*(onto|to) the battlefield|each player (returns|puts) all|all creature cards from all graveyards/.test(t);
  const flicker = r.isPermanent && FLICKER.test(t) && (triggeredLine(r, FLICKER) || activatedLine(r, FLICKER));
  const tokenEngine = r.isPermanent && (triggeredLine(r, /create[^.]*token/) || activatedLine(r, /create[^.]*token/)) && !etbOnly(r, /create[^.]*token/) && /at the beginning of|whenever/.test(t);
  const selfRecur = /return ~ from your graveyard/.test(t) || r.keywords.has("persist") || r.keywords.has("undying");

  const named = RECURSION_ENGINES.has(r.key) || RECURSION_COMMANDERS.has(r.key);
  const repeatable =
    r.isPermanent &&
    (toBattlefield || toHand || castFrom) &&
    (activatedLine(r, /graveyard/) || (triggeredLine(r, /graveyard/) && !etbOnly(r, /graveyard/)));

  if (fromExile && (toBattlefield || /return[^.]*from exile/.test(t))) return { points: 1.5, engine: false, kind: "exile" };
  if (mass) return { points: 2, engine: true, kind: "mass" };
  if (repeatable) return { points: 2, engine: true, kind: "repeatable" };
  if (flicker) return { points: 1.5, engine: true, kind: "flicker" };
  if (tokenEngine && !r.isLand) return { points: 1.5, engine: true, kind: "token" };
  if (toBattlefield) return { points: 1, engine: false, kind: "one-shot" };
  if (toHand || castFrom) return { points: 1, engine: false, kind: "hand" };
  if (named && (/graveyard/.test(t) || selfRecur)) {
    return r.isPermanent ? { points: 2, engine: true, kind: "format-defining" } : { points: 1, engine: false, kind: "one-shot" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The classification
// ---------------------------------------------------------------------------

export interface NamedCount {
  label: string;
  names: string[];
}

/** What the classifier read on one card, for calibration against a reference. */
export interface CardReading {
  tutor?: number;
  draw?: number;
  piece?: boolean;
  stack?: number;
  threat?: number;
  recursion?: number;
}

export interface Classification {
  consistency: ConsistencyInput;
  interaction: InteractionInput;
  resilience: ResilienceInput;
  /** Draw and tutor points from the 99 alone — the commander's own bonuses excluded. */
  ninetyNine: { drawPoints: number; tutorPoints: number };
  /** Combo lines as counted for the rubric, before assembly adjustment. */
  comboLines: { counted: number; total: number; clunky: number; sharedFailure: boolean };
  commanderDependencyReason: string;
  mana: { lands: number; rocks: number; dorks: number; effectiveSources: number; target: number; averageManaValue: number; weakColor: string | null };
  exposure: { className: string | null; share: number; answers: number };
  redundancy: { subtype: string | null; count: number; bonus: number };
  groups: Record<string, NamedCount>;
  /** Per-card readings, by printed name — what calibration diffs against DeckCheck. */
  cardReadings: Record<string, CardReading>;
  /** Per-card readings the goldfish reuses. */
  reads: Read[];
  creatureCards: number;
}

function wordNumber(word: string): number {
  const table: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
  return table[word] ?? (Number.parseInt(word, 10) || 0);
}

/** Mana a permanent adds per activation, from "{T}: Add {G}{G}" or "add two mana". */
export function manaProduced(r: Read): number {
  const line = r.text.split("\n").find((l) => /^\{t\}(, [^:]*)?: add|^\{t\}: add|: add /.test(l) || /^add /.test(l));
  if (!line) return 0;
  const braces = line.match(/add ((?:\{[wubrgc]\})+)/);
  if (braces) return (braces[1]!.match(/\{/g) ?? []).length;
  const words = line.match(/add (one|two|three|four|five|x|an amount of) mana/);
  if (words) return words[1] === "x" || words[1] === "an amount of" ? 2 : wordNumber(words[1]!);
  if (/add \{[wubrgc]\}/.test(line) || /add one mana|add mana of any/.test(line)) return 1;
  return 1;
}

/** The plan's land-count target, curve-adjusted, in the spirit of the usual 36 ± the curve. */
export function landTarget(averageManaValue: number): number {
  const target = 36 + Math.round((averageManaValue - 3) * 4);
  return Math.max(30, Math.min(40, target));
}

export function classify(cards: ScoredCard[], lines: ComboLineInput[] = []): Classification {
  const reads = cards.map(read);
  const commanders = reads.filter((r) => r.card.isCommander);
  const commanderKeys = new Set(commanders.map((r) => r.key));
  const nonland = reads.filter((r) => !r.isLand);
  const copies = (r: Read) => r.copies;
  const creatureCards = reads.filter((r) => r.isCreature && !r.isLand).reduce((n, r) => n + copies(r), 0);
  const groups: Record<string, NamedCount> = {};
  const group = (id: string, label: string, name: string) => {
    (groups[id] ??= { label, names: [] }).names.push(name);
  };
  const cardReadings: Record<string, CardReading> = {};
  const note = (r: Read, patch: CardReading) => {
    cardReadings[r.card.name] = { ...(cardReadings[r.card.name] ?? {}), ...patch };
  };

  // --- Consistency ---------------------------------------------------------
  let tutorPoints99 = 0;
  let premiumTutors = 0;
  let commanderTutor = false;
  let battlefieldTutorCommander = false;
  const graveyardTutors: Read[] = [];
  const tutorReads = new Map<Read, TutorReading>();
  for (const r of reads) {
    const t = tutorReading(r);
    if (!t) continue;
    tutorReads.set(r, t);
    if (r.card.isCommander) {
      commanderTutor = true;
      if (t.battlefield) battlefieldTutorCommander = true;
      if (t.premium) premiumTutors += 1;
      group("tutors", "Tutors", `${r.card.name} (commander)`);
      continue;
    }
    if (t.graveyardDestination) {
      graveyardTutors.push(r);
      continue;
    }
    tutorPoints99 += t.points * copies(r);
    if (t.premium) premiumTutors += copies(r);
    note(r, { tutor: t.points });
    group("tutors", "Tutors", `${r.card.name} · ${t.points}`);
  }

  let drawPoints99 = 0;
  let selectionPoints = 0;
  let monarchCards = 0;
  let commanderDraw = false;
  const drawReads = new Map<Read, DrawReading>();
  for (const r of reads) {
    const d = drawReading(r);
    if (!d) continue;
    drawReads.set(r, d);
    if (r.card.isCommander) {
      commanderDraw = true;
      group("draw", "Card advantage", `${r.card.name} (commander)`);
      continue;
    }
    note(r, { draw: d.points });
    if (d.kind === "selection") {
      selectionPoints += d.points * copies(r);
      group("draw", "Card advantage", `${r.card.name} · ${d.points}`);
      continue;
    }
    if (d.kind === "monarch") {
      monarchCards += 1;
      if (monarchCards > 2) continue;
    }
    drawPoints99 += d.points * copies(r);
    group("draw", "Card advantage", `${r.card.name} · ${d.points}`);
  }
  // "Selection points count toward the draw total only up to 30."
  drawPoints99 += Math.min(30, selectionPoints);

  // Recursion package (also unlocks graveyard-destination tutors).
  let recursionPoints = 0;
  let rebuildEngines = 0;
  let recursionCards = 0;
  let stickyBodies = 0;
  const recursionCommander = commanders.some((r) => RECURSION_COMMANDERS.has(r.key) || recursionReading(r)?.engine);
  for (const r of reads) {
    if (r.keywords.has("persist") || r.keywords.has("undying") || /return ~ from your graveyard to the battlefield/.test(r.text) || r.keywords.has("escape") || r.keywords.has("encore")) {
      stickyBodies += copies(r);
    }
    const rec = recursionReading(r);
    if (!rec) continue;
    if (r.card.isCommander) continue; // counted as the recursion commander below
    recursionCards += copies(r);
    recursionPoints += rec.points * copies(r);
    note(r, { recursion: rec.points });
    if (rec.engine) rebuildEngines += copies(r);
    group("recursion", "Recursion", `${r.card.name} · ${rec.points}`);
  }
  rebuildEngines += Math.floor(stickyBodies / 3);
  if (recursionCommander) {
    rebuildEngines += 1;
    recursionPoints += 2;
    group("recursion", "Recursion", `${commanders.map((c) => c.card.name).join(" + ")} (commander)`);
  }
  const hasRecursionPackage = recursionCards >= 3 || recursionCommander;
  for (const r of graveyardTutors) {
    const t = tutorReads.get(r)!;
    if (hasRecursionPackage) {
      tutorPoints99 += t.points * copies(r);
      note(r, { tutor: t.points });
      group("tutors", "Tutors", `${r.card.name} · ${t.points}`);
    } else {
      note(r, { tutor: 0 });
      group("tutors", "Tutors", `${r.card.name} · 0 (no recursion package)`);
    }
  }

  // Tribal / synergy redundancy.
  const subtypeCounts = new Map<string, number>();
  for (const r of reads) {
    if (!r.isCreature || r.isLand) continue;
    const sub = (r.type.split("—")[1] ?? "").trim().split(/\s+/).filter(Boolean);
    for (const s of new Set(sub)) subtypeCounts.set(s, (subtypeCounts.get(s) ?? 0) + copies(r));
  }
  let redundancy = { subtype: null as string | null, count: 0, bonus: 0 };
  for (const [sub, count] of subtypeCounts) {
    if (count < 6 || count <= redundancy.count) continue;
    // The type has to be a ROLE the deck cares about, not a coincidence: some
    // other card (or the commander) has to name it.
    const singular = sub;
    const mentions = reads.filter((r) => !r.type.includes(singular) && new RegExp(`\\b${singular.replace(/s$/, "")}(s|es)?\\b`).test(r.text)).length;
    if (mentions < 3 && !commanders.some((c) => c.text.includes(singular))) continue;
    redundancy = { subtype: sub, count, bonus: count >= 10 ? 10 : 5 };
  }
  const leansOnRedundancy = redundancy.bonus > 0 && readLadder(tutorPoints99, TUTOR_LADDER) < 7;

  // Combo lines and the commander's part in them.
  const winsOrEngine = (l: ComboLineInput) =>
    l.produces.some((p) => /win the game|loses? the game|^infinite|infinite /i.test(p));
  const lineMana = (l: ComboLineInput) => manaValue(l.manaNeeded) + (l.manaNeeded.includes("X") ? 99 : 0);
  const realLines = lines.filter(winsOrEngine);
  const commanderInLine = (l: ComboLineInput) => l.pieces.some((p) => commanderKeys.has(nameKey(p)));
  // Distinct win conditions, not registered combos: Spellbook lists every
  // pairing, and Isochron Scepter with three different spells is one line
  // with a single point of failure, not three. Combos sharing a piece are one
  // cluster; a cluster is a line, at half credit when every member is clunky.
  const isClunky = (l: ComboLineInput) => l.pieces.length >= 4 || lineMana(l) > 6;
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    const p = parent.get(k) ?? k;
    if (p === k) return k;
    const root = find(p);
    parent.set(k, root);
    return root;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const l of realLines) {
    const keys = l.pieces.map(nameKey).filter((k) => !commanderKeys.has(k));
    for (let i = 1; i < keys.length; i++) union(keys[0]!, keys[i]!);
  }
  const clusters = new Map<string, ComboLineInput[]>();
  for (const l of realLines) {
    const keys = l.pieces.map(nameKey).filter((k) => !commanderKeys.has(k));
    const root = keys.length ? find(keys[0]!) : `cz:${l.pieces.join("+")}`;
    (clusters.get(root) ?? clusters.set(root, []).get(root)!).push(l);
  }
  let comboCounted = 0;
  let clunky = 0;
  const sharedFailure = realLines.length > clusters.size;
  for (const members of clusters.values()) {
    // "Lines sharing a single point of failure count as 1.5, not 2": a
    // cluster of two or more combos is 1.5, a lone combo is 1, and a cluster
    // whose every member is clunky reads half of that.
    const allClunky = members.every(isClunky);
    if (allClunky) clunky += 1;
    const credit = members.length > 1 ? 1.5 : 1;
    comboCounted += allClunky ? credit / 2 : credit;
    const best = members.find((m) => !isClunky(m)) ?? members[0]!;
    group("combos", "Win lines", `${best.pieces.join(" + ")}${members.length > 1 ? ` (+${members.length - 1} sharing a piece)` : ""}${allClunky ? " · half (clunky)" : ""}`);
  }
  const commanderComboPiece = realLines.some(commanderInLine);
  const sisayClass = battlefieldTutorCommander && comboCounted > 0;
  if (sisayClass) comboCounted += 0.5;

  const tutorPoints = tutorPoints99 + (commanderTutor ? 5 : 0) + (commanderComboPiece ? 4 : 0) + redundancy.bonus;
  const drawPoints = drawPoints99 + (commanderDraw ? 3 : 0) + (commanderComboPiece ? 4 : 0);
  if (commanderTutor) premiumTutors += 0; // a tutor commander counted above when premium

  // Command-zone engine.
  let commandZoneEngine: "access" | "volume" | null = null;
  for (const c of commanders) {
    const t = tutorReads.get(c);
    const d = drawReads.get(c);
    // A commander that repeatedly puts cards from hand or library straight
    // onto the battlefield (Braids, Sneak Attack class) is an access engine:
    // it is how the deck's pieces arrive.
    const materialises =
      c.isPermanent &&
      (triggeredLine(c, /from (your|their) hand onto the battlefield|from your library onto the battlefield/) ||
        activatedLine(c, /from your hand onto the battlefield|from your library onto the battlefield/));
    if ((t && t.engine) || materialises || (d && d.kind === "selection" && activatedLine(c, /look at the top|scry|surveil/))) commandZoneEngine = "access";
    else if (d && (d.kind === "engine" || d.kind === "premium" || d.kind === "combat" || d.kind === "burst") && !commandZoneEngine) commandZoneEngine = "volume";
  }
  // Trigger amplifiers count only with 10+ cards in the amplified family.
  const amplifier = commanders.find((c) => /trigger(s)? an additional time|triggers twice|causes? a triggered ability[^.]*trigger/.test(c.text));
  if (amplifier && !commandZoneEngine) {
    const family = /attacks|enters/;
    const carriers = reads.filter((r) => !r.card.isCommander && triggeredLine(r, family)).reduce((n, r) => n + copies(r), 0);
    if (carriers >= 10) commandZoneEngine = "volume";
  }

  // Mana reliability.
  let lands = 0;
  let rocks = 0;
  let dorks = 0;
  let mvTotal = 0;
  let mvCount = 0;
  const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const producers: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const r of reads) {
    if (r.isLand) {
      lands += copies(r);
      for (const c of r.card.producedMana) if (producers[c] != null) producers[c] += copies(r);
      if (r.card.producedMana.length === 0 && /any color/.test(r.text)) for (const c of Object.keys(producers)) producers[c]! += copies(r);
      continue;
    }
    if (r.card.isCommander) continue;
    mvTotal += r.mv * copies(r);
    mvCount += copies(r);
    for (const sym of (r.card.manaCost ?? "").matchAll(/\{([^}]+)\}/g)) {
      for (const c of Object.keys(pips)) if (sym[1]!.includes(c)) pips[c]! += copies(r);
    }
    const producesMana = /\{t\}[^:]*: add|: add \{|^add \{|add one mana|add two mana|add three mana|mana of any/.test(r.text) && !/only to (cast|activate)/.test(r.first) ;
    if (producesMana && /\bartifact\b/.test(r.type) && !r.isCreature) {
      rocks += copies(r);
      for (const c of r.card.producedMana) if (producers[c] != null) producers[c] += copies(r);
    } else if (producesMana && r.isCreature) {
      dorks += copies(r);
      for (const c of r.card.producedMana) if (producers[c] != null) producers[c] += copies(r);
    }
  }
  const averageManaValue = mvCount > 0 ? mvTotal / mvCount : 0;
  const effectiveSources = lands + 0.75 * (rocks + dorks);
  const target = landTarget(averageManaValue);
  let manaReliability = 0;
  if (effectiveSources <= target - 10) manaReliability -= 2;
  else if (effectiveSources <= target - 6) manaReliability -= 1;
  const totalPips = Object.values(pips).reduce((a, b) => a + b, 0);
  let weakColor: string | null = null;
  for (const c of Object.keys(pips)) {
    if (totalPips > 0 && pips[c]! / totalPips >= 0.2 && producers[c]! < 10 && producers[c]! > 0) weakColor = c;
    // A colour with no producers at all and real pips: the same hole.
    if (totalPips > 0 && pips[c]! / totalPips >= 0.2 && producers[c]! === 0 && lands > 0 && reads.some((r) => r.isLand && r.card.producedMana.length > 0)) weakColor = c;
  }
  if (weakColor) manaReliability -= 1;
  manaReliability = Math.max(-2, manaReliability);

  // --- Interaction ---------------------------------------------------------
  let pieces = 0;
  let stackPoints = 0;
  let counterspells = 0;
  let symmetricWipes = 0;
  let stackProtection = 0;
  let protectionCards = 0;
  let boardLevel = 0;
  let staxPieces = 0;
  let answersCreatures = false;
  let answersArtifacts = false;
  let answersEnchantments = false;
  let artifactEnchantmentAnswers = 0;
  const interactionReads = new Map<Read, InteractionReadingCard>();
  for (const r of reads) {
    const i = interactionReadingCard(r, creatureCards);
    if (!i.piece) continue;
    interactionReads.set(r, i);
    const n = copies(r);
    pieces += n;
    let pts = 0;
    if (i.counterspell) {
      pts += 2;
      counterspells += n;
    }
    if (i.free) pts += 2;
    if (i.turnProtection) pts += 2;
    // Bounce is tempo, sorcery-speed removal earns 0, but a counter or
    // protection at instant speed does.
    if (i.instantSpeed && !(i.bounce && !i.removal && !i.counterspell && !i.protection)) pts += 1;
    if (i.hardWipe) pts += 1;
    stackPoints += pts * n;
    note(r, { piece: true, stack: pts });
    if (i.symmetricWipe) symmetricWipes += n;
    if (i.stackProtection) stackProtection += n;
    if (i.protection || i.boardLevel) protectionCards += n;
    if (i.boardLevel) boardLevel += n;
    if (i.stax) staxPieces += n;
    if (i.answersCreatures) answersCreatures = true;
    if (i.answersArtifacts) answersArtifacts = true;
    if (i.answersEnchantments) answersEnchantments = true;
    if (i.answersArtifacts || i.answersEnchantments) artifactEnchantmentAnswers += n;
    const tags = [
      i.counterspell ? "counter" : null,
      i.free ? "free" : null,
      i.turnProtection ? "turn protection" : null,
      i.boardLevel ? "board protection" : i.protection ? "protection" : null,
      i.wipe ? (i.symmetricWipe ? "symmetric wipe" : "wipe") : null,
      i.removal && !i.wipe ? "removal" : null,
      i.bounce && !i.removal ? "bounce" : null,
      i.stax ? "stax" : null,
    ].filter(Boolean);
    group("interaction", "Interaction", `${r.card.name}${pts ? ` · ${pts}` : ""}${tags.length ? ` (${tags.join(", ")})` : ""}`);
  }

  // --- Resilience ----------------------------------------------------------
  let threats = 0;
  let selfProtecting = 0;
  let deathtouch = 0;
  let smallCreatures = 0;
  let anthems = 0;
  let equipment = 0;
  let auras = 0;
  for (const r of reads) {
    const th = threatReading(r);
    const n = copies(r);
    if (th.weight > 0) {
      threats += th.weight * n;
      note(r, { threat: th.weight });
      group("threats", "Threats", `${r.card.name}${th.weight < 1 ? " · half (vanilla)" : ""}`);
    }
    if (th.selfProtecting && r.isCreature) selfProtecting += n;
    if (th.deathtouch) deathtouch += n;
    if (th.small && r.isCreature) smallCreatures += n;
    if (th.anthem) anthems += n;
    if (/\bequipment\b/.test(r.type)) equipment += n;
    if (/\baura\b/.test(r.type)) auras += n;
  }
  if (battlefieldTutorCommander) threats += 1;
  // Go-wide: with 12+ small bodies, every anthem and lord is a threat.
  if (smallCreatures >= 12) threats += anthems;
  const protectionEffective = protectionCards + Math.floor(selfProtecting / 3) + Math.floor(deathtouch / 3);

  // Heavy draw is recovery.
  if (drawPoints >= 40) recursionPoints += 2;
  else if (drawPoints >= 32) recursionPoints += 1;

  const combat: CombatInput = {
    threats,
    protectionCards,
    protectionEffective,
    recursionPoints,
    rebuildEngines,
    boardLevelProtection: boardLevel,
  };

  // Engine exposure.
  const nonlandCount = nonland.reduce((n, r) => n + copies(r), 0);
  const classes: Record<string, number> = { artifact: 0, enchantment: 0, graveyard: 0 };
  for (const r of nonland) {
    const fightsAsCreature = r.isCreature || /\bvehicle\b/.test(r.type) || r.card.isCommander;
    if (!fightsAsCreature && /\bartifact\b/.test(r.type)) classes.artifact! += copies(r);
    if (!fightsAsCreature && /\benchantment\b/.test(r.type)) classes.enchantment! += copies(r);
    if (/graveyard/.test(r.text) && (recursionReading(r) || r.keywords.has("flashback") || r.keywords.has("escape") || r.keywords.has("delve") || r.keywords.has("dredge") || r.keywords.has("unearth") || /from your graveyard/.test(r.text))) classes.graveyard! += copies(r);
  }
  let exposure = { className: null as string | null, share: 0, answers: artifactEnchantmentAnswers };
  for (const [name, count] of Object.entries(classes)) {
    const share = nonlandCount > 0 ? count / nonlandCount : 0;
    if (share > exposure.share) exposure = { className: name, share, answers: artifactEnchantmentAnswers };
  }
  let engineExposure = 0;
  if (exposure.share >= 0.45 && exposure.answers < 2) engineExposure = -2;
  else if (exposure.share >= 0.45 || (exposure.share >= 0.3 && exposure.answers < 2)) engineExposure = -1;
  if (engineExposure === 0) exposure = { ...exposure, className: null };

  // Commander dependency.
  const commanderMentions = reads.filter((r) => !r.card.isCommander && /\b(your commander|commander you control|commanders you control|a commander)\b/.test(r.text) && !/if you control a commander, you may cast/.test(r.text)).reduce((n, r) => n + copies(r), 0);
  const commanderEngine = commanderTutor || commanderDraw || commandZoneEngine !== null;
  const commanderIsCreature = commanders.some((c) => c.isCreature);
  const signals: string[] = [];
  let weight = 0;
  if (realLines.length > 0 && realLines.filter(commanderInLine).length / realLines.length >= 0.5) {
    weight += 2;
    signals.push("the commander is in most of the deck's win lines");
  }
  // An engine commander is a dependency only when the 99 cannot replace it.
  if (commanderEngine && drawPoints99 < 24) {
    weight += 1;
    signals.push("the commander is the card-advantage engine");
    if (drawPoints99 + tutorPoints99 < 20) {
      // The engine lives in the command zone and nothing replaces it: that
      // is the rubric's "High" on its own.
      weight += 2;
      signals.push("the 99 have little card flow of their own");
    }
  }
  const themed = redundancy.subtype !== null && commanders.some((c) => c.text.includes(redundancy.subtype!.toLowerCase()) || c.type.includes(redundancy.subtype!.toLowerCase()));
  if (themed) signals.push(`the deck is built around the commander's ${redundancy.subtype} theme`);
  if (commanderIsCreature && equipment + auras >= 8) {
    weight += 1;
    signals.push(`${equipment + auras} equipment and auras want a body in the command zone`);
  }
  if (commanderMentions >= 5) {
    weight += 1;
    signals.push(`${commanderMentions} cards reference the commander`);
  }
  let commanderDependency: CommanderDependency = "moderate";
  let commanderDependencyReason: string;
  if (commanders.length === 0) {
    commanderDependency = "none";
    commanderDependencyReason = "No commander on the decklist.";
  } else if (weight >= 3) {
    commanderDependency = "high";
    commanderDependencyReason = `High: ${signals.join("; ")}.`;
  } else if (
    weight === 0 &&
    !themed &&
    (drawPoints99 >= 32 || (realLines.length > 0 && !realLines.some(commanderInLine) && tutorPoints99 >= 24))
  ) {
    commanderDependency = "none";
    commanderDependencyReason = realLines.length > 0 && !realLines.some(commanderInLine)
      ? "None: the win lines and the card flow both live in the 99."
      : "None: the 99 carry their own card flow, and nothing leans on the command zone.";
  } else {
    commanderDependencyReason = signals.length
      ? `Moderate: ${signals.join("; ")} — the deck still executes without it.`
      : "Moderate: the format default — the commander matters, the deck still runs without it.";
  }

  return {
    consistency: {
      drawPoints,
      tutorPoints,
      premiumTutors,
      leansOnRedundancy,
      commandZoneEngine,
      manaReliability,
    },
    interaction: {
      pieces,
      stackPoints,
      answersCreatures,
      answersArtifacts,
      answersEnchantments,
      counterspells,
      symmetricWipes,
    },
    resilience: {
      comboLines: comboCounted,
      tutorPoints,
      battlefieldTutorCommander,
      staxPieces,
      stackProtectionPieces: stackProtection,
      combat,
      equipment,
      interactionPieces: pieces,
      counterspells,
      drawPoints,
      engineExposure,
      commanderDependency,
    },
    ninetyNine: { drawPoints: drawPoints99, tutorPoints: tutorPoints99 },
    comboLines: { counted: comboCounted, total: realLines.length, clunky, sharedFailure },
    commanderDependencyReason,
    mana: { lands, rocks, dorks, effectiveSources, target, averageManaValue, weakColor },
    exposure,
    redundancy,
    groups,
    cardReadings,
    reads,
    creatureCards,
  };
}

export type { Read as CardRead };
