// What the model sees and answers when it plays the AI's turn
// (docs/practice-vs-ai.md): the rules of the table and its decklist (the
// cached prefix), the board this turn (the brief), the JSON schema its plan
// must follow, and the clean-up of that plan. Pure, for tests.

import type { PlayCard } from "../playtest";
import { canPlayAsLand, castTriggerOf, counterOf, discardTriggerOf, drawsOnLifeLoss, edictOf, faceText, hitTriggersOf, indestructibleOnYourTurn, infoOf, ninjutsuOf, isCreature, isLand, isSick, keywordsOf, lifeForMana, stats } from "./cards";
import { availableMana, castable, cardId, lifeFor } from "./game";
import { manaSummary } from "./mana";
import type { CardBook, Effect, EffectType, PlanAction, PracticeGame, TurnPlan } from "./types";

const EFFECT_TYPES: EffectType[] = ["damage", "life", "destroy", "exile", "bounce", "tap", "untap", "draw", "discard", "mill", "token", "counters", "pump", "search", "mana", "note"];

// Nullable fields as anyOf: the form structured outputs documents.
const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });
const nullableEnum = (values: string[]) => ({ anyOf: [{ type: "string", enum: values }, { type: "null" }] });
const EFFECT_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: EFFECT_TYPES },
    target: nullable("string"),
    player: nullableEnum(["ai", "player"]),
    amount: nullable("integer"),
    name: nullable("string"),
    power: nullable("integer"),
    toughness: nullable("integer"),
    keywords: { type: "array", items: { type: "string" } },
    to: nullableEnum(["battlefield", "hand"]),
    tapped: nullable("boolean"),
    text: nullable("string"),
  },
  required: ["type", "target", "player", "amount", "name", "power", "toughness", "keywords", "to", "tapped", "text"],
  additionalProperties: false,
};
const ACTION_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["land", "cast", "activate"] },
    card: { type: "string" },
    x: nullable("integer"),
    tap_card: nullable("boolean"),
    sacrifice_card: nullable("boolean"),
    mana: nullable("string"),
    life: nullable("integer"),
    effects: { type: "array", items: EFFECT_SCHEMA },
  },
  required: ["kind", "card", "x", "tap_card", "sacrifice_card", "mana", "life", "effects"],
  additionalProperties: false,
};
/** The plan's shape, enforced by the API's structured outputs. */
export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    main: { type: "array", items: ACTION_SCHEMA },
    attack: { type: "array", items: { type: "string" } },
    after_combat: { type: "array", items: ACTION_SCHEMA },
    say: { type: "string" },
  },
  required: ["main", "attack", "after_combat", "say"],
  additionalProperties: false,
};

const RULES = `You are the opponent in a practice game of Magic: The Gathering on Spellpool. You pilot the deck below against the player, who is practising with their own deck. Play to win, like a strong and fair player: make your land drops, spend your mana, use removal on the biggest threats, attack when it's good, keep blockers back when you need them. Play the deck the way it wants to be played.

HOW THIS TABLE WORKS
- Each of your turns you get a brief: your hand, your mana right now, both battlefields, life totals and what happened since your last turn. Cards are named by id, like c10023.
- You answer with your plan for the whole turn: "main" (actions before combat, in order), "attack" (ids of your creatures that attack the player), "after_combat" (actions after combat, in order) and "say" (one short line of table talk in character, at most 12 words, or "").
- The app checks every action. One land per turn. A spell or ability has to be paid from your untapped mana: the brief says what each card costs and whether you can pay for it now. Actions are paid in order, so put first what you most want to cast. Don't plan more than your mana allows.
- Don't activate mana abilities: the app taps your lands and mana sources when you cast, and uses up one-shot sources (Lotus Petal) last.
- Fetch lands crack themselves when you play them: the app finds the land that suits your hand. Shock lands enter untapped for 2 life while you can afford it.
- On the player's turn the app plays for you. It blocks, and it casts your hard counterspells (marked "counterspell" in your hand) at the player's spells that are worth it, if you left their mana untapped. Nothing else of yours is cast on their turn, so cards that only work in response (protection, redirecting a spell, combat tricks) are rarely worth casting on your own turn.
- Creatures that are summoning sick (marked in the brief) can't attack.

HOW TO PLAY WELL
- Use your mana every turn. A turn where you only play a land is a wasted turn, unless you're holding mana open on purpose for a counterspell.
- Develop first: mana rocks and ramp, your commander when it's good to cast, card draw and engines, then threats. Spend spare mana on cheap card draw, cantrips and tutors.
- Rituals and fast mana: cast them when the mana lets you cast something more this turn. Mana a spell adds floats only until the end of the phase.
- Keep mana open for a counterspell only when you hold one and have nothing better to do with that mana.
- Attack when the player can't block well; keep blockers back when their board threatens lethal.

ACTIONS
- {"kind":"land","card":"<id>"}: play a land from your hand. A modal card with a land on its back (marked in your hand) can be cast as its front, or played as your land this way.
- {"kind":"cast","card":"<id>","x":<n or null>,"effects":[...]}: cast a card from your hand or command zone. A permanent enters the battlefield; an instant or sorcery resolves and goes to your graveyard. "effects" is what the spell does, or what the permanent's enters-the-battlefield ability does, right now.
- {"kind":"activate","card":"<id>","tap_card":<bool>,"sacrifice_card":<bool>,"mana":"{2}{G}" or null,"life":<n or null>,"effects":[...]}: an activated ability of a permanent you control, with its costs.
Every field is always present; set the ones an action doesn't use to null (effects to []).

EFFECTS (every field present: unused ones null, keywords [] when unused)
- damage: target is a card id, "player" or "ai"; amount.
- life: player is "ai" or "player"; amount (negative to lose life).
- destroy, exile, bounce (return to its owner's hand), tap, untap: target is a card id on the battlefield.
- draw, discard, mill: player and amount. Your own discards pick themselves; the player chooses theirs.
- token: name, power, toughness, amount (how many), keywords, tapped, and player (whose; null means yours).
- counters: target and amount (+1/+1 counters; negative for -1/-1).
- pump: target, power and toughness, until end of turn.
- search: name (an exact card name from your deck still in your library), to ("battlefield" or "hand"), tapped.
- mana: text is the mana it adds, like "{R}{R}{R}" (a ritual, or "three mana of any one color": pick the colour). Your next actions spend it first.
- note: text, for anything else the card does. The player resolves it by hand, so make it short and concrete ("The player sacrifices a creature").
Turn each card's text into these effects faithfully. Never invent an effect a card doesn't have. Target only cards the brief shows, by id.`;

export interface DeckLine {
  name: string;
  quantity: number;
}

const line = (book: CardBook, name: string) => {
  const info = book[name.toLowerCase()];
  if (!info) return name;
  const text = (info.oracleText ?? "").replace(/\s*\n\s*/g, " ").slice(0, 600);
  const pt = info.power !== null && info.toughness !== null ? ` ${info.power}/${info.toughness}` : "";
  return `${info.name} ${info.manaCost ?? ""} — ${info.typeLine ?? ""}${pt}${text ? ` — ${text}` : ""}`;
};

/** What the app does by itself for a card of the deck (K'rrik's life for
    {B}, cast triggers, Kefka's discard and its {8}), so the plan leaves it
    out: one line per card that has any. */
export function automatedNotes(deck: DeckLine[], book: CardBook): string[] {
  const out: string[] = [];
  for (const d of deck) {
    const info = book[d.name.toLowerCase()];
    if (!info) continue;
    const front: PlayCard = { iid: 0, name: info.name, imageUri: "", typeLine: info.typeLine, tapped: false, commander: false, flipped: false };
    const back: PlayCard = { ...front, flipped: true };
    const notes: string[] = [];
    if (lifeForMana(book, front).length) notes.push(`while it's out you may pay 2 life for each {${lifeForMana(book, front).join("}/{")}} in a cost: the app does it when your mana runs short, and "you can pay for it now" counts it`);
    if (castTriggerOf(book, front)) notes.push("its trigger when you cast a spell (counters, damage, a token) happens by itself");
    if (discardTriggerOf(book, front)) notes.push("its discard-and-draw as it enters or attacks happens by itself: give it no discard or draw effects");
    const edict = edictOf(book, front);
    if (edict) notes.push(`to use its ${edict.mana} ability, activate it with "mana":"${edict.mana}" and no effects: the player chooses what to sacrifice${edict.transform ? " and it transforms" : ""}`);
    if (drawsOnLifeLoss(book, back) || drawsOnLifeLoss(book, front)) notes.push("drawing when the player loses life on your turn happens by itself");
    if (indestructibleOnYourTurn(book, front)) notes.push("it's indestructible on your turn");
    const ninja = ninjutsuOf(book, front);
    if (ninja)
      notes.push(
        `its ${ninja.commander ? "commander " : ""}ninjutsu ${ninja.cost} is used in combat, after the player's blocks, for one of your unblocked attackers (from your hand${ninja.commander ? " or the command zone, with no tax" : ""}) when you have the mana: attack with cheap or evasive creatures to set it up, and keep ${ninja.cost} untapped`
      );
    if (hitTriggersOf(book, front).length) notes.push("what it does when a creature deals combat damage to the player happens by itself");
    if (notes.length) out.push(`- ${info.name}: ${notes.join("; ")}.`);
  }
  return out;
}

/** The cached prefix: the rules, then the AI's deck with each card's text. */
export function systemPrompt(deck: DeckLine[], book: CardBook, commander: string | null): { rules: string; deck: string } {
  const lines = [...deck].sort((a, b) => a.name.localeCompare(b.name)).map((d) => `- ${d.quantity}× ${line(book, d.name)}`);
  const auto = automatedNotes(deck, book);
  return {
    rules: RULES,
    deck: `YOUR DECK${commander ? ` (commander: ${commander})` : ""}\n${lines.join("\n")}${auto.length ? `\n\nTHE APP DOES THESE BY ITSELF (never put them in effects)\n${auto.join("\n")}` : ""}`,
  };
}

const describe = (g: PracticeGame, book: CardBook, c: PlayCard, opts: { text?: boolean } = {}) => {
  const bits: string[] = [];
  if (isCreature(book, c)) {
    const s = stats(book, c);
    bits.push(`${s.power}/${s.toughness}`);
    if (c.damage) bits.push(`${c.damage} damage marked`);
  }
  const kw = keywordsOf(book, c);
  if (kw.length) bits.push(kw.join(", "));
  bits.push(c.tapped ? "tapped" : "untapped");
  if (isCreature(book, c) && isSick(book, c, g.turn) && g.active === "opp") bits.push("summoning sick");
  if (c.counters) bits.push(`${c.counters > 0 ? "+" : ""}${c.counters} counters`);
  if (c.commander) bits.push("commander");
  if (c.flipped && c.name.includes(" // ")) bits.push(`transformed: ${c.name.split(" // ")[1]!.trim()}`);
  const kind = c.token ? "token" : isLand(c) ? "land" : (infoOf(book, c)?.typeLine ?? c.typeLine ?? "").split(" — ")[0];
  const text = opts.text && !c.token ? faceText(infoOf(book, c), c).replace(/\s*\n\s*/g, " ").slice(0, 300) : "";
  return `- ${cardId(c.iid)} ${c.name.slice(0, 80)} (${kind}) ${bits.join(", ")}${text ? ` — ${text}` : ""}`;
};

/** The board this turn, from the AI's side of the table. */
export function turnBrief(g: PracticeGame, book: CardBook, sinceLast: string[]): string {
  const me = g.sides.opp;
  const them = g.sides.you;
  const sources = availableMana(g, "opp", book);
  const hand = me.hand.map((c) => {
    const info = infoOf(book, c);
    if (isLand(c)) return `- ${cardId(c.iid)} ${c.name} (land)${g.landPlayed ? "" : " — you can play it"}`;
    const can = castable(g, "opp", c, book, "hand");
    const counter = counterOf(info) ? " — counterspell: leave its mana untapped and the app casts it on the player's turn" : "";
    const land = canPlayAsLand(c) ? ` — or play it as your land (its back face)${g.landPlayed ? ", but your land drop is used" : ""}` : "";
    return `- ${cardId(c.iid)} ${c.name} ${info?.manaCost ?? ""} (${(info?.typeLine ?? "").split(" — ")[0]}) — ${can ? "you can pay for it now" : "can't pay for it yet"}${counter}${land}`;
  });
  const command = me.command.map((c) => {
    const info = infoOf(book, c);
    const can = castable(g, "opp", c, book, "command");
    return `- ${cardId(c.iid)} ${c.name} ${info?.manaCost ?? ""}${g.tax.opp ? ` +{${2 * g.tax.opp}} tax` : ""} — ${can ? "you can pay for it now" : "can't pay for it yet"}`;
  });
  const field = (cards: PlayCard[], text: boolean) => (cards.length ? cards.map((c) => describe(g, book, c, { text })).join("\n") : "(nothing)");
  const grave = (cards: PlayCard[]) => (cards.length ? cards.slice(-8).map((c) => c.name).join(", ") : "empty");
  return [
    `Turn ${g.turn}: your turn. Life: you ${me.life}, the player ${them.life}.` +
      (g.commanderGame ? ` Commander damage taken: you ${g.cmdDamage.opp}, the player ${g.cmdDamage.you}.` : ""),
    `Your library: ${me.library.length} cards. The player has ${them.hand.length} cards in hand and ${them.library.length} in library.`,
    `Land drop: ${g.landPlayed ? "already used this turn" : "available"}.`,
    `YOUR MANA RIGHT NOW: ${manaSummary(sources)}.${lifeFor(g, "opp", book).length ? ` You may also pay 2 life for each {${lifeFor(g, "opp", book).join("}/{")}}: the app does it when your mana runs short, keeping your life above what the player's creatures could hit for.` : ""}`,
    sinceLast.length ? `SINCE YOUR LAST TURN:\n${sinceLast.map((t) => `- ${t}`).join("\n")}` : "",
    `YOUR HAND:\n${hand.join("\n") || "(empty)"}`,
    command.length ? `YOUR COMMAND ZONE:\n${command.join("\n")}` : "",
    `YOUR BATTLEFIELD:\n${field(me.battlefield, false)}`,
    `THE PLAYER'S BATTLEFIELD:\n${field(them.battlefield, true)}`,
    `GRAVEYARDS: yours: ${grave(me.graveyard)}. The player's: ${grave(them.graveyard)}.`,
    `Plan your turn.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What happened since the AI's last turn: the player's turn, from the log
    (the AI's own turn-start line excluded). */
export function sinceLastTurn(g: PracticeGame): string[] {
  const texts = g.log.map((l) => l.text);
  const at = texts.lastIndexOf(`Turn ${g.turn - 1} — your turn.`);
  return texts
    .slice(at >= 0 ? at : Math.max(0, texts.length - 15))
    .filter((t) => t !== `Turn ${g.turn} — the opponent's turn.`)
    .slice(-20);
}

const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);

function cleanEffect(raw: unknown): Effect | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (!EFFECT_TYPES.includes(e.type as EffectType)) return null;
  return {
    type: e.type as EffectType,
    target: text(e.target, 20),
    player: e.player === "ai" || e.player === "player" ? e.player : null,
    amount: int(e.amount, -99, 99),
    name: text(e.name, 80),
    power: int(e.power, -20, 99),
    toughness: int(e.toughness, -20, 99),
    keywords: Array.isArray(e.keywords) ? e.keywords.filter((k): k is string => typeof k === "string").slice(0, 6).map((k) => k.slice(0, 30)) : [],
    to: e.to === "battlefield" || e.to === "hand" ? e.to : null,
    tapped: bool(e.tapped),
    text: text(e.text, 200),
  };
}

function cleanAction(raw: unknown): PlanAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a.kind !== "land" && a.kind !== "cast" && a.kind !== "activate") return null;
  const card = text(a.card, 20);
  if (!card || !/^c\d+$/.test(card)) return null;
  return {
    kind: a.kind,
    card,
    x: int(a.x, 0, 30),
    tap_card: bool(a.tap_card),
    sacrifice_card: bool(a.sacrifice_card),
    mana: text(a.mana, 40),
    life: int(a.life, 0, 20),
    effects: (Array.isArray(a.effects) ? a.effects : []).map(cleanEffect).filter((e): e is Effect => !!e).slice(0, 12),
  };
}

/** The model's plan, bounded: known shapes only, at most 12 actions a phase. */
export function cleanPlan(raw: unknown): TurnPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const actions = (v: unknown) => (Array.isArray(v) ? v : []).map(cleanAction).filter((a): a is PlanAction => !!a).slice(0, 12);
  return {
    main: actions(p.main),
    attack: (Array.isArray(p.attack) ? p.attack : []).filter((x): x is string => typeof x === "string" && /^c\d+$/.test(x)).slice(0, 30),
    after_combat: actions(p.after_combat),
    say: (text(p.say, 120) ?? "").trim(),
  };
}
