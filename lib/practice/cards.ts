// What a card on the table can do: its stats now, its keywords, the mana it
// makes. Read from Scryfall's card data (CardInfo); tokens carry their own.

import { faceUpType, isLandCard, type PlayCard } from "../playtest";
import type { CardBook, CardInfo } from "./types";

export const infoOf = (book: CardBook, card: PlayCard): CardInfo | undefined => book[card.name.toLowerCase()];

const frontType = (typeLine: string | null | undefined) => (typeLine ?? "").split(" // ")[0]!;

export function isCreature(book: CardBook, card: PlayCard): boolean {
  if (card.token) return card.token.kind !== "artifact";
  return /\bCreature\b/.test(frontType(infoOf(book, card)?.typeLine ?? card.typeLine));
}

/** A land now: the face that's up is a land. A modal card with a land back
    (Shatterskull Smashing) is a spell in hand, and a land once played as one. */
export const isLand = (card: PlayCard) => /\bLand\b/.test(faceUpType(card));

/** Can be the turn's land: a land, or a modal card with a land on its back. */
export const canPlayAsLand = (card: PlayCard) => isLandCard(card.typeLine);

/** Power and toughness now: printed (or the token's), plus counters and
    pumps. Unknown stats (Scryfall's facts missing) count as 1/1, so a
    creature doesn't die the moment it lands for want of data. */
export function stats(book: CardBook, card: PlayCard): { power: number; toughness: number } {
  const info = infoOf(book, card);
  // A transformed card (Kefka, Ruler of Ruin) has its back face's stats.
  const face = card.flipped && info?.back ? info.back : info;
  const base = card.token ?? { power: face?.power ?? 1, toughness: face?.toughness ?? 1 };
  const plus = card.counters ?? 0;
  return {
    power: base.power + plus + (card.pump?.power ?? 0) + (card.boost?.power ?? 0),
    toughness: base.toughness + plus + (card.pump?.toughness ?? 0) + (card.boost?.toughness ?? 0),
  };
}

/** A keyword, from Scryfall's list or the card's text ("can't be blocked"). */
export function has(book: CardBook, card: PlayCard, keyword: string): boolean {
  const k = keyword.toLowerCase();
  if (keywordsOf(book, card).some((x) => x.toLowerCase() === k)) return true;
  // Given until end of turn, or by another permanent (a lord, an Aura).
  if ([...(card.eot ?? []), ...(card.boost?.keywords ?? [])].some((x) => x.toLowerCase() === k)) return true;
  if (card.token) return false;
  const text = faceText(infoOf(book, card), card).toLowerCase();
  if (k === "unblockable") return /\bcan't be blocked\b(?! except| by)/.test(text) && !/can't be blocked except/.test(text);
  if (k === "defender") return /^defender\b/m.test(text);
  return false;
}

/** The rules text of the face that's up: the back of a transformed card. */
export function faceText(info: CardInfo | undefined, card: Pick<PlayCard, "flipped">): string {
  const faces = (info?.oracleText ?? "").split("\n//\n");
  return (card.flipped && faces[1] !== undefined ? faces[1] : faces[0]) ?? "";
}

/** Its keywords now. Scryfall lists every face's keywords together, so a
    double-faced card keeps only those its face that's up has (Kefka is no
    flier until it transforms). */
export function keywordsOf(book: CardBook, card: PlayCard): string[] {
  if (card.token) return card.token.keywords;
  const info = infoOf(book, card);
  if (!info) return [];
  if (!(info.oracleText ?? "").includes("\n//\n")) return info.keywords;
  const text = faceText(info, card).toLowerCase();
  return info.keywords.filter((k) => text.includes(k.toLowerCase()));
}

/** Summoning sick: came under its controller's control this turn, and no haste. */
export const isSick = (book: CardBook, card: PlayCard, turn: number) =>
  (card.enteredTurn ?? 0) >= turn && !has(book, card, "Haste");

const COLORS = ["W", "U", "B", "R", "G", "C"];
export const BASIC_COLOR: Record<string, string> = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G", wastes: "C" };

const frontText = (info: CardInfo | undefined) => (info?.oracleText ?? "").split("\n//\n")[0]!;

/** The mana a permanent adds when tapped for it: which colours, and how
    much ("Add {C}{C}" is two), and whether using it sacrifices it (Lotus
    Petal). Null when it makes none. A fetch land makes none: it cracks
    itself when played (fetchOf). */
export function manaOutput(info: CardInfo | undefined, typeLine: string | null): { colors: string[]; amount: number; sacrifice: boolean } | null {
  const text = frontText(info);
  let colors = (info?.producedMana ?? []).filter((c) => COLORS.includes(c));
  // A basic land type makes its colour even when the data says nothing.
  if (!colors.length) {
    const t = frontType(typeLine).toLowerCase();
    colors = Object.entries(BASIC_COLOR).filter(([sub]) => t.includes(sub)).map(([, c]) => c);
  }
  // "Choose a basic land type" or "a color" as it enters (Thran Portal):
  // whichever it needs.
  if (!colors.length && isLandCard(typeLine) && /\bchoose a (basic land type|color)\b/i.test(text)) colors = ["W", "U", "B", "R", "G"];
  if (!colors.length) return null;
  // "{T}: Add {C}{C}." — a run of symbols is one ability adding them all;
  // "Add {G} or {U}" or "one mana of any color" is one.
  let amount = 1;
  for (const m of text.matchAll(/\badd ((?:\{[WUBRGC]\})+)/gi)) {
    amount = Math.max(amount, (m[1]!.match(/\{/g) ?? []).length);
  }
  const sacrifice = /\bsacrifice [^:.]*:[^.]*\badd\b/i.test(text) && !/\{T\}: add/i.test(text);
  return { colors, amount, sacrifice };
}

/** "enters tapped" without an "unless" escape. A shock land ("you may pay
    2 life") doesn't: the AI pays (shockLife). */
export const entersTapped = (info: CardInfo | undefined) => {
  const text = frontText(info).toLowerCase();
  if (shockLife(info)) return false;
  return /enters (the battlefield )?tapped/.test(text) && !/enters (the battlefield )?tapped unless/.test(text);
};

/** A shock land's price for entering untapped. */
export const shockLife = (info: CardInfo | undefined) => (/you may pay 2 life\. if you don't, it enters (the battlefield )?tapped/i.test(frontText(info)) ? 2 : 0);

/** A fetch land: what it searches for. "Island or Mountain" is ["island",
    "mountain"]; "a basic land card" is basic, ["land"]. */
export interface Fetch {
  types: string[];
  basic: boolean;
  tapped: boolean;
  life: number;
}
export function fetchOf(info: CardInfo | undefined): Fetch | null {
  const text = frontText(info);
  const m = /sacrifice [^:]*:\s*search your library for an? (basic )?([a-z ,]+?) card,? (?:and )?put it onto the battlefield( tapped)?/i.exec(text);
  if (!m) return null;
  const types = m[2]!
    .toLowerCase()
    .split(/,|\bor\b/)
    .map((t) => t.trim())
    .filter(Boolean);
  return { types, basic: !!m[1], tapped: !!m[3], life: /pay 1 life/i.test(text) ? 1 : 0 };
}

/** A hard counterspell: what it can counter, and a way to cast it without
    mana. Soft counters ("unless its controller pays") are left out: the
    app doesn't track the player's mana, so it can't tell if they'd pay. */
export interface Counter {
  hits: (spell: { typeLine: string; manaValue: number; blue: boolean }) => boolean;
  /** "commander": free while the AI controls its commander (Fierce
      Guardianship). "exile-blue": exile another blue card instead (Force of
      Will). */
  free: "commander" | "exile-blue" | null;
  freeLife: number;
  /** X is the countered spell's mana value (Disrupting Shoal). */
  xIsValue: boolean;
  /** What else it does, for the log ("Its controller creates a 2/2 blue Bird…"). */
  rider: string;
}
export function counterOf(info: CardInfo | undefined): Counter | null {
  const text = frontText(info);
  if (/unless its controller pays/i.test(text)) return null;
  const m = /counter target ([a-z ,]*?)spell( with mana value (\d+)| if it's blue)?/i.exec(text);
  if (!m) return null;
  const words = m[1]!
    .toLowerCase()
    .replace(/,|\bor\b/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const not = words.filter((w) => w.startsWith("non")).map((w) => w.slice(3));
  const only = words.filter((w) => !w.startsWith("non"));
  const value = m[3] ? Number(m[3]) : null;
  const needsBlue = /if it's blue/i.test(m[2] ?? "");
  const rest = text.slice(m.index + m[0].length).split("\n")[0]!.replace(/^[.;]\s*/, "");
  return {
    hits: ({ typeLine, manaValue, blue }) => {
      const t = typeLine.toLowerCase();
      if (not.some((w) => t.includes(w))) return false;
      if (only.length && !only.some((w) => t.includes(w))) return false;
      if (value !== null && manaValue !== value) return false;
      if (needsBlue && !blue) return false;
      return true;
    },
    free: /if you control a commander, you may cast this spell without paying its mana cost/i.test(text)
      ? "commander"
      : /exile a blue card from your hand rather than pay this spell's mana cost/i.test(text)
        ? "exile-blue"
        : null,
    freeLife: /pay 1 life and exile a blue card/i.test(text) ? 1 : 0,
    xIsValue: /mana value is x\b/i.test(text),
    rider: /^its controller\b/i.test(rest) ? rest.split(/(?<=\.)\s/)[0]! : "",
  };
}

/** "rather than pay this spell's mana cost", "without paying its mana cost":
    a card that may be cast some other way. The player's casts of these
    aren't tapped for automatically. */
export const hasAltCost = (info: CardInfo | undefined) =>
  /rather than pay (?:this spell's|its) mana cost|without paying (?:its|this spell's) mana cost/i.test(frontText(info));

/** A search of your library: how many cards, which ones, and where each goes. */
export interface Search {
  count: number;
  /** "a creature card", for the prompt. */
  what: string;
  /** Where each find goes, in order; the last repeats. */
  to: { zone: "hand" | "battlefield" | "top"; tapped?: boolean }[];
  test: (typeLine: string | null, info: CardInfo | undefined) => boolean;
}
/** An activated ability that searches (a fetch land, Evolving Wilds,
    Sakura-Tribe Elder), with its costs. */
export interface SearchAbility extends Search {
  tap: boolean;
  sacrifice: boolean;
  life: number;
  /** Its mana cost, if any ("{1}"): the player pays that by hand. */
  mana: string | null;
}

const WORD_NUMBER: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const COLOR_PIP: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };

/** One "Search your library for …" sentence. */
function parseSearch(line: string): Search | null {
  const m = /search your library(?: and\/or graveyard)? for (up to (\w+) |an? |any number of )?(.*?) ?cards?\b( with [^,.]+?)?(?=[,.]| and | then |$)/i.exec(line);
  if (!m) return null;
  const count = /^up to/i.test(m[1] ?? "") ? (WORD_NUMBER[(m[2] ?? "").toLowerCase()] ?? 1) : /any number/i.test(m[1] ?? "") ? 99 : 1;
  const desc = (m[3] ?? "").trim().toLowerCase();
  const alts = desc
    ? desc
        .split(/,\s*(?:or\s+)?|\s+or\s+/)
        .map((a) => a.trim().split(/\s+/).filter(Boolean))
        .filter((a) => a.length)
    : [];
  const rule = (m[4] ?? "").toLowerCase();
  const power = /power (\d+) or less/.exec(rule);
  const valueMax = /mana value (\d+) or less/.exec(rule);
  const valueMin = /mana value (\d+) or greater/.exec(rule);
  const rest = line.slice(m.index + m[0].length);
  const split = /put one onto the battlefield( tapped)? and the other into your hand/i.exec(rest);
  const dest = /\bput (?:it|that card|the card|them|those cards|one of them)\b[^.]*?(into your hand|onto the battlefield( tapped)?|on top)/i.exec(rest);
  const to: Search["to"] = split
    ? [{ zone: "battlefield", tapped: !!split[1] }, { zone: "hand" }]
    : dest
      ? [/hand/i.test(dest[1]!) ? { zone: "hand" } : /top/i.test(dest[1]!) ? { zone: "top" } : { zone: "battlefield", tapped: !!dest[2] }]
      : [{ zone: "hand" }];
  const word = (w: string, t: string, info: CardInfo | undefined) => {
    if (COLOR_PIP[w]) return new RegExp(`\\{[^}]*${COLOR_PIP[w]}[^}]*\\}`).test(info?.manaCost ?? "");
    if (w === "colorless") return !/\{[^}]*[WUBRG][^}]*\}/.test(info?.manaCost ?? "");
    if (w.startsWith("non")) return !new RegExp(`\\b${w.slice(3)}\\b`).test(t);
    return new RegExp(`\\b${w.replace(/s$/, "")}s?\\b`).test(t);
  };
  return {
    count,
    what: `${desc ? `${desc} ` : ""}card${count > 1 ? "s" : ""}`,
    to,
    test: (typeLine, info) => {
      const t = (info?.typeLine ?? typeLine ?? "").split(" // ")[0]!.toLowerCase();
      if (alts.length && !alts.some((words) => words.every((w) => word(w, t, info)))) return false;
      if (power && (info?.power ?? 99) > Number(power[1])) return false;
      if (valueMax && (info?.manaValue ?? 0) > Number(valueMax[1])) return false;
      if (valueMin && (info?.manaValue ?? 0) < Number(valueMin[1])) return false;
      return true;
    },
  };
}

/** What casting this card searches for: a tutor's spell text, or a
    permanent's "when it enters" search. Activated abilities are left to
    searchAbility. */
export function searchOnCast(info: CardInfo | undefined): Search | null {
  const spell = /\b(Instant|Sorcery)\b/.test(frontType(info?.typeLine));
  for (const line of frontText(info).split("\n")) {
    const at = line.toLowerCase().indexOf("search your library");
    if (at < 0) continue;
    const colon = line.indexOf(":");
    if (colon >= 0 && colon < at) continue;
    // A permanent's own "When ~ enters": not "Whenever an Aura you control
    // enters" (Light-Paws), which is about other cards.
    if (!spell && !/^when\b[^.]*\benters\b/i.test(line.trim())) continue;
    const s = parseSearch(line);
    if (s) return s;
  }
  return null;
}

/** A permanent's activated ability that searches, with its costs. */
export function searchAbility(info: CardInfo | undefined): SearchAbility | null {
  for (const line of frontText(info).split("\n")) {
    const at = line.toLowerCase().indexOf("search your library");
    const colon = line.indexOf(":");
    if (at < 0 || colon < 0 || colon > at) continue;
    const s = parseSearch(line.slice(colon + 1));
    if (!s) continue;
    const cost = line.slice(0, colon);
    const life = /pay (\d+) life/i.exec(cost);
    const mana = (cost.match(/\{(?!T\})[^}]+\}/g) ?? []).join("");
    return { ...s, tap: /\{T\}/.test(cost), sacrifice: /sacrifice/i.test(cost), life: life ? Number(life[1]) : 0, mana: mana || null };
  }
  return null;
}

/** Can be cast on the other player's turn: an instant, or a card with flash. */
export function isInstantSpeed(book: CardBook, card: PlayCard): boolean {
  if (card.token || isLand(card)) return false;
  const info = infoOf(book, card);
  return /\bInstant\b/.test(frontType(info?.typeLine ?? card.typeLine)) || !!info?.keywords.some((k) => k.toLowerCase() === "flash");
}

/** An instant that removes a creature: destroy, exile, return to hand, or
    damage. What it may target, and what else it does (for the log). */
export interface Removal {
  kind: "destroy" | "exile" | "bounce" | "damage";
  amount: number;
  attackingOnly: boolean;
  /** "nonblack": not this colour; "nonartifact": not this type. */
  notColor: string | null;
  notType: string | null;
  /** "With mana value 4 or greater" (Despark). */
  minValue: number;
  rider: string;
}
export function removalOf(info: CardInfo | undefined, speed: "instant" | "sorcery" = "instant"): Removal | null {
  // An instant, to answer on the player's turn; or a sorcery, for the AI's own.
  if (!info || !new RegExp(`\\b${speed === "instant" ? "Instant" : "Sorcery"}\\b`).test(frontType(info.typeLine))) return null;
  const text = frontText(info);
  // "Target creature", and the wider targets a creature fits: a permanent
  // (Beast Within), a nonland permanent (Anguished Unmaking), an artifact or
  // creature (Putrefy), with or without "an opponent controls".
  const kill = /\b(destroy|exile) target (attacking |tapped )?(?:non(\w+) )?(?:creature|permanent|artifact or creature|creature or artifact|creature or enchantment|creature or planeswalker|artifact, creature, or enchantment)\b(?! card)(?: an opponent controls| you don't control)?(?: with mana value (\d+) or greater)?/i.exec(text);
  const burn = /\bdeals? (\d+) damage to (any target|target creature|target attacking creature|target creature or planeswalker)\b/i.exec(text);
  const bounce = /\breturn target (attacking )?(?:creature|nonland permanent|permanent) to its owner's hand\b/i.exec(text);
  const m = kill ?? burn ?? bounce;
  if (!m) return null;
  const not = kill?.[3]?.toLowerCase() ?? null;
  const pip = not ? COLOR_PIP[not] : undefined;
  const after = text.slice(m.index + m[0].length).replace(/^[^.]*\.\s*/, "");
  return {
    kind: kill ? (kill[1]!.toLowerCase() as "destroy" | "exile") : burn ? "damage" : "bounce",
    amount: burn ? Number(burn[1]) : 0,
    attackingOnly: /attacking/i.test((kill?.[2] ?? "") + (burn?.[2] ?? "") + (bounce?.[1] ?? "")),
    notColor: pip ?? null,
    notType: not && !pip ? not : null,
    minValue: Number(kill?.[4]) || 0,
    rider: /^its controller\b/i.test(after) ? after.split(/(?<=\.)\s/)[0]! : "",
  };
}

/** Blue, by its mana cost (hybrid and phyrexian count). */
export const isBlue = (info: CardInfo | undefined) => /\{[^}]*U[^}]*\}/.test(info?.manaCost ?? "");

// ── Abilities the engine carries out (K'rrik, Kefka, Vivi…) ─────────────

const CARD_TYPES = ["artifact", "battle", "creature", "enchantment", "instant", "kindred", "land", "planeswalker", "sorcery", "tribal"];

/** A card's types ("Artifact Creature" is two), from its front face. */
export const cardTypes = (typeLine: string | null | undefined): string[] => {
  const words = frontType(typeLine).split(/\s+[—-]\s+/)[0]!.toLowerCase().split(/\s+/);
  return CARD_TYPES.filter((t) => words.includes(t));
};

/** The colours of mana a permanent lets its controller pay with 2 life
    instead ("For each {B} in a cost, you may pay 2 life rather than pay that
    mana": K'rrik). */
export function lifeForMana(book: CardBook, card: PlayCard): string[] {
  if (card.token) return [];
  const text = faceText(infoOf(book, card), card);
  return [...text.matchAll(/for each \{([WUBRG])\} in a cost, you may pay 2 life rather than pay that mana/gi)].map((m) => m[1]!.toUpperCase());
}

/** A spell, as a cast trigger sees it. */
export interface SpellSeen {
  typeLine: string;
  manaCost: string;
}

/** Does "a <words> spell" describe this spell? Words are colours ("black":
    by its mana cost, hybrid and phyrexian included), "multicolored",
    "colorless", card types and their "non-" forms. A word it doesn't know
    (historic, a spell with a target) never matches. */
function spellIs(words: string[], spell: SpellSeen): boolean {
  const t = frontType(spell.typeLine).toLowerCase();
  const colors = new Set([...(spell.manaCost.split(" // ")[0] ?? "").toUpperCase().matchAll(/\{([^}]+)\}/g)].flatMap((m) => m[1]!.match(/[WUBRG]/g) ?? []));
  return words.every((w) => {
    if (COLOR_PIP[w]) return colors.has(COLOR_PIP[w]!);
    if (w === "multicolored") return colors.size >= 2;
    if (w === "colorless") return colors.size === 0;
    if (w.startsWith("non") && CARD_TYPES.includes(w.slice(3))) return !new RegExp(`\\b${w.slice(3)}\\b`).test(t);
    if (CARD_TYPES.includes(w)) return new RegExp(`\\b${w}\\b`).test(t);
    if (w === "legendary") return /\blegendary\b/.test(t);
    return false;
  });
}

/** What a permanent does when its controller casts a spell: "Whenever you
    cast a black spell, put a +1/+1 counter on K'rrik", Vivi's counter and
    damage, prowess, a cantrip, a token. Only the parts the table can do. */
export interface CastTrigger {
  hits: (spell: SpellSeen) => boolean;
  counters: number;
  /** Damage to each opponent ("it deals 1 damage to each opponent"). */
  damage: number;
  /** "Each opponent loses 1 life." */
  drain: number;
  gain: number;
  draw: number;
  /** Until end of turn, on itself (prowess). */
  pump: number;
  token: { name: string; power: number; toughness: number; keywords: string[] } | null;
}

export function castTriggerOf(book: CardBook, card: PlayCard): CastTrigger | null {
  if (card.token) return null;
  const info = infoOf(book, card);
  const text = faceText(info, card);
  const self = (info?.name ?? card.name).split(" // ")[card.flipped ? 1 : 0]!.trim();
  const short = self.split(",")[0]!;
  const m = /\bwhenever you cast an? ([a-z ,]*?)\s*spell, ([^\n]*)/i.exec(text);
  if (!m) {
    if (!keywordsOf(book, card).some((k) => k.toLowerCase() === "prowess")) return null;
    return { hits: (s) => spellIs(["noncreature"], s), counters: 0, damage: 0, drain: 0, gain: 0, draw: 0, pump: 1, token: null };
  }
  const alts = m[1]!
    .toLowerCase()
    .split(/,\s*(?:or\s+)?|\s+or\s+/)
    .map((a) => a.trim().split(/\s+/).filter(Boolean));
  const rest = m[2]!.split(/(?<=\.)\s/)[0]!.toLowerCase();
  const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3 };
  const num = (w: string | undefined) => (w ? (NUM[w] ?? (Number(w) || 0)) : 0);
  const names = [self.toLowerCase(), short.toLowerCase(), "it", "this creature", "~"].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const onSelf = `(?:${names.join("|")})`;
  const counters = new RegExp(`put (a|an|one|two|three|\\d+) \\+1/\\+1 counters? on ${onSelf}\\b`).exec(rest);
  const damage = /deals? (\d+) damage to each opponent/.exec(rest);
  const drain = /each opponent loses (\d+) life/.exec(rest);
  const gain = /you gain (\d+) life/.exec(rest);
  const draw = /\bdraw (a|one|two) cards?\b/.exec(rest);
  const pump = new RegExp(`${onSelf} gets \\+(\\d+)/\\+\\d+ until end of turn`).exec(rest);
  const token = /create (?:a|one) (\d+)\/(\d+) ([a-z ]+?) creature token(?: with ([a-z]+))?/.exec(rest);
  const t: CastTrigger = {
    hits: (s) => alts.some((words) => words.length > 0 && spellIs(words, s)) || (alts.length === 1 && alts[0]!.length === 0),
    counters: num(counters?.[1]),
    damage: num(damage?.[1]),
    drain: num(drain?.[1]),
    gain: num(gain?.[1]),
    draw: num(draw?.[1]),
    pump: num(pump?.[1]),
    token: token
      ? {
          name: token[3]!.split(" ").filter((w) => !COLOR_PIP[w] && w !== "and" && w !== "colorless").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") || "Token",
          power: Number(token[1]),
          toughness: Number(token[2]),
          keywords: token[4] ? [token[4][0]!.toUpperCase() + token[4].slice(1)] : [],
        }
      : null,
  };
  if (!t.counters && !t.damage && !t.drain && !t.gain && !t.draw && !t.pump && !t.token) return null;
  return t;
}

/** "Whenever Kefka enters or attacks, each player discards a card. Then you
    draw a card for each card type among cards discarded this way." */
export function discardTriggerOf(book: CardBook, card: PlayCard): { enters: boolean; attacks: boolean } | null {
  if (card.token) return null;
  const m = /whenever [^.\n]*?\b(enters or attacks|enters|attacks), each player discards a card\. then you draw a card for each card type among cards discarded this way/i.exec(
    faceText(infoOf(book, card), card)
  );
  if (!m) return null;
  const when = m[1]!.toLowerCase();
  return { enters: when.includes("enters"), attacks: when.includes("attacks") };
}

/** "{8}: Each opponent sacrifices a permanent of their choice. Transform
    Kefka. Activate only as a sorcery." */
export interface Edict {
  mana: string;
  /** What's sacrificed: "permanent", "creature", "nonland permanent". */
  what: string;
  transform: boolean;
}
export function edictOf(book: CardBook, card: PlayCard): Edict | null {
  if (card.token) return null;
  const m = /^((?:\{[^}]+\})+): each opponent sacrifices an? ([a-z ]+?)(?: of their choice)?\.( transform [^.]+\.)?/im.exec(faceText(infoOf(book, card), card));
  if (!m || /\{T\}/.test(m[1]!)) return null;
  return { mana: m[1]!, what: m[2]!.toLowerCase(), transform: !!m[3] };
}

/** "Whenever an opponent loses life during your turn, you draw that many
    cards" (Kefka, Ruler of Ruin). */
export const drawsOnLifeLoss = (book: CardBook, card: PlayCard) =>
  !card.token && /whenever an opponent loses life during your turn, you draw that many cards/i.test(faceText(infoOf(book, card), card));

/** "During your turn, Kefka has indestructible." */
export const indestructibleOnYourTurn = (book: CardBook, card: PlayCard) =>
  !card.token && /during your turn, [^.\n]*\bhas indestructible\b/i.test(faceText(infoOf(book, card), card));

/** "Ninjutsu {U}{B}" or "Commander ninjutsu {U}{B}" (Yuriko): its cost, and
    whether it also works from the command zone. */
export function ninjutsuOf(book: CardBook, card: PlayCard): { cost: string; commander: boolean } | null {
  if (card.token) return null;
  const m = /^(commander )?ninjutsu ((?:\{[^}]+\})+)/im.exec(faceText(infoOf(book, card), card));
  return m ? { cost: m[2]!, commander: !!m[1] } : null;
}

/** A Ninja: by its type line, or a changeling. */
export const isNinja = (book: CardBook, card: PlayCard) =>
  /\bNinja\b/.test(card.token ? (card.typeLine ?? "") : faceUpType({ typeLine: infoOf(book, card)?.typeLine ?? card.typeLine, flipped: card.flipped })) ||
  has(book, card, "Changeling");

/** What a permanent does when a creature hits a player: "Whenever a Ninja
    you control deals combat damage to a player, reveal the top card of your
    library and put that card into your hand. Each opponent loses life equal
    to that card's mana value" (Yuriko), "…, draw a card" (Ingenious
    Infiltrator), and its own "Whenever ~ deals combat damage to a player,
    draw a card" (Ninja of the Deep Hours). */
export interface HitTrigger {
  /** Any Ninja of its controller's, or only itself. */
  ninjas: boolean;
  reveal: boolean;
  draw: number;
}
export function hitTriggersOf(book: CardBook, card: PlayCard): HitTrigger[] {
  if (card.token) return [];
  const info = infoOf(book, card);
  const text = faceText(info, card);
  const self = (info?.name ?? card.name).split(" // ")[card.flipped ? 1 : 0]!.trim();
  const out: HitTrigger[] = [];
  for (const m of text.matchAll(/whenever ([^,\n]+?) deals combat damage to a player, ([^\n]*)/gi)) {
    const who = m[1]!.toLowerCase();
    const ninjas = /^a ninja you control$/.test(who);
    if (!ninjas && who !== self.toLowerCase() && who !== self.split(",")[0]!.toLowerCase() && who !== "this creature") continue;
    const what = m[2]!.toLowerCase();
    const reveal = /reveal the top card of your library and put that card into your hand\. each opponent loses life equal to that card's mana value/.test(what);
    const draw = /^(?:you may )?draw a card\b/.test(what) ? 1 : 0;
    if (reveal || draw) out.push({ ninjas, reveal, draw });
  }
  return out;
}
