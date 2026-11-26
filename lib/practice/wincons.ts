// Ways to win other than damage, read from the card text, for both sides:
// Thassa's Oracle's devotion check, drawing from an empty library with
// Laboratory Maniac or Jace, Wielder of Mysteries out, and the spells that
// empty a library for them (Demonic Consultation, Tainted Pact). Also the
// planner's spells for a storm turn: rituals and burn.

import type { PlayCard } from "../playtest";
import { faceText, infoOf, ownText } from "./cards";
import type { CardBook, CardInfo, PracticeGame, Seat } from "./types";

const sentences = (text: string) =>
  ownText(text)
    .split(/\n|(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter(Boolean);

/** "… If X is greater than or equal to the number of cards in your
    library, you win the game", X being your devotion to blue. */
export const oracleWinOf = (book: CardBook, card: PlayCard) =>
  !card.token && /where x is your devotion to blue\b[\s\S]*if x is greater than or equal to the number of cards in your library, you win the game/i.test(faceText(infoOf(book, card), card));

/** "If you would draw a card while your library has no cards in it, you
    win the game instead" (Laboratory Maniac, Jace, Wielder of Mysteries). */
export const emptyDrawWinsOf = (book: CardBook, card: PlayCard) =>
  !card.token && /if you would draw a card while your library has no cards in it, you win the game instead/i.test(faceText(infoOf(book, card), card));

/** Devotion to a colour: its pips (hybrid ones too) in the mana costs of a
    seat's permanents. */
export function devotion(g: PracticeGame, seat: Seat, color: string, book: CardBook): number {
  let n = 0;
  for (const c of g.sides[seat].battlefield) {
    if (c.token) continue;
    const cost = (infoOf(book, c)?.manaCost ?? "").split(" // ")[c.flipped ? 1 : 0] ?? "";
    for (const m of cost.matchAll(/\{([^}]+)\}/g)) if (m[1]!.toUpperCase().split("/").includes(color)) n++;
  }
  return n;
}

/** A spell that can empty its caster's library: Demonic Consultation
    ("Choose a card name. Exile the top six cards…") and Tainted Pact. */
export function libraryExilerOf(info: CardInfo | undefined): "consultation" | "pact" | null {
  const text = (info?.oracleText ?? "").split("\n//\n")[0]!;
  if (/^choose a card name\. exile the top six cards of your library, then reveal cards from the top of your library until you reveal a card with the chosen name\. put that card into your hand and exile all other cards revealed this way\.$/i.test(text.trim())) return "consultation";
  if (/^exile the top card of your library\. you may put that card into your hand unless it has the same name as another card exiled this way\. repeat this process until you put a card into your hand or you exile two cards with the same name, whichever comes first\.$/i.test(text.trim())) return "pact";
  return null;
}

/** Rain of Filth: "Until end of turn, lands you control gain 'Sacrifice
    this land: Add {B}.'" The colour each land gives as it's sacrificed. All
    in: a card for the turn the game is won. */
export function landsForManaOf(info: CardInfo | undefined): string | null {
  const m = /^until end of turn, lands you control gain "sacrifice this land: add \{([WUBRGC])\}\."$/i.exec((info?.oracleText ?? "").split("\n//\n")[0]!.trim());
  return m ? m[1]!.toUpperCase() : null;
}

/** A ritual: its whole text is "Add {R}{R}{R}." (a splice line allowed):
    the mana it adds, one letter a unit. */
export function ritualOf(info: CardInfo | undefined): string[] | null {
  if (!/\b(Instant|Sorcery)\b/.test((info?.typeLine ?? "").split(" // ")[0]!)) return null;
  const lines = sentences(info?.oracleText ?? "");
  const rest = lines.filter((s) => !/^splice onto arcane\b/i.test(s));
  if (rest.length !== 1) return null;
  const m = /^add ((?:\{[WUBRGC]\})+)$/i.exec(rest[0]!);
  return m ? [...m[1]!.matchAll(/\{([WUBRGC])\}/gi)].map((x) => x[1]!.toUpperCase()) : null;
}

/** An instant or sorcery that gives its caster another turn: "Take an
    extra turn after this one" (Temporal Mastery), "Target player takes an
    extra turn after this one" (Time Warp, on its caster). What else the
    card says is left to its caster. */
export const extraTurnOf = (info: CardInfo | undefined) =>
  /\b(Instant|Sorcery)\b/.test((info?.typeLine ?? "").split(" // ")[0]!) && sentences(info?.oracleText ?? "").some((s) => /^(?:target player takes|take) an extra turn after this one$/i.test(s));

/** An extra turn that ends the game for its caster: "At the beginning of
    that turn's end step, you lose the game" (Final Fortune, Last Chance,
    Warrior's Oath). */
export const extraTurnLosesOf = (info: CardInfo | undefined) => extraTurnOf(info) && sentences(info?.oracleText ?? "").some((s) => /^at the beginning of that turn's end step, you lose the game$/i.test(s));

/** Ad Nauseam: "Reveal the top card of your library and put that card into
    your hand. You lose life equal to its mana value. You may repeat this
    process any number of times." */
export const adNauseamOf = (info: CardInfo | undefined) =>
  /^reveal the top card of your library and put that card into your hand\. you lose life equal to its mana value\. you may repeat this process any number of times\.?$/i.test(ownText(info?.oracleText ?? "").trim());

/** Jeska's Will's other mode: "Exile the top three cards of your library.
    You may play them this turn." With a commander out its caster gets
    both modes. How many cards, or 0. */
export function impulseOf(info: CardInfo | undefined): number {
  const lines = sentences(info?.oracleText ?? "");
  if (!lines.some((s) => /^if you control a commander as you cast this spell, you may choose both instead$/i.test(s))) return 0;
  const i = lines.findIndex((s) => /^• exile the top (two|three|four) cards of your library$/i.test(s));
  if (i < 0 || !/^you may play them this turn$/i.test(lines[i + 1] ?? "")) return 0;
  return { two: 2, three: 3, four: 4 }[/top (\w+) cards/i.exec(lines[i]!)![1]!.toLowerCase()] ?? 0;
}

/** A spell that asks for a sacrifice as it's cast: "As an additional cost
    to cast this spell, sacrifice a creature" (Culling the Weak, Diabolic
    Intent, Infernal Plunge). What it wants, in the card's words. */
export function sacrificeCostOf(info: CardInfo | undefined): string | null {
  for (const s of sentences(info?.oracleText ?? "")) {
    const m = /^as an additional cost to cast this spell, sacrifice an? ([a-z]+(?: or [a-z]+)?)$/i.exec(s);
    if (m) return m[1]!.toLowerCase();
  }
  return null;
}

/** The mana a ritual adds as it resolves, for the table as it stands:
    Dark Ritual's three, Culling the Weak's four (its sacrifice is its
    cost), Rite of Flame's two and one more for each in a graveyard, Cabal
    Ritual's three or (with seven cards in the graveyard) five, and Jeska's
    Will's {R} for each card in the other player's hand. Null for a spell
    that isn't a ritual. */
export function ritualMana(info: CardInfo | undefined, at: { graveyard: number; ritesInGraveyards: number; foeHand: number }): string[] | null {
  if (!/\b(Instant|Sorcery)\b/.test((info?.typeLine ?? "").split(" // ")[0]!)) return null;
  const units = (run: string) => [...run.matchAll(/\{([WUBRGC])\}/gi)].map((x) => x[1]!.toUpperCase());
  const lines = sentences(info?.oracleText ?? "").filter((s) => !/^splice onto arcane\b/i.test(s) && !/^as an additional cost to cast this spell, sacrifice an? [a-z ]+$/i.test(s));
  let m: RegExpExecArray | null;
  if (lines.length === 1 && (m = /^add ((?:\{[WUBRGC]\})+)$/i.exec(lines[0]!))) return units(m[1]!);
  if (lines.length === 1 && (m = /^add ((?:\{[WUBRGC]\})+), then add (\{[WUBRGC]\}) for each card named [^.]+ in each graveyard$/i.exec(lines[0]!))) return [...units(m[1]!), ...Array<string>(at.ritesInGraveyards).fill(units(m[2]!)[0]!)];
  if (lines.length === 2 && (m = /^add ((?:\{[WUBRGC]\})+)$/i.exec(lines[0]!))) {
    const more = /^threshold — add ((?:\{[WUBRGC]\})+) instead if (?:there are )?seven or more cards (?:are )?in your graveyard$/i.exec(lines[1]!);
    if (more) return units(at.graveyard >= 7 ? more[1]! : m[1]!);
  }
  // Jeska's Will: the mana mode (the other one, and both with a commander, are its caster's to play).
  const mode = lines.find((s) => /^• add (\{[WUBRGC]\}) for each card in target opponent's hand$/i.test(s));
  if (mode && lines.some((s) => /^choose one\b/i.test(s))) return Array<string>(at.foeHand).fill(units(mode)[0]!);
  return null;
}

/** Storm: "When you cast this spell, copy it for each spell cast before
    it this turn" (Grapeshot, Brain Freeze). */
export const hasStorm = (info: CardInfo | undefined) => /^storm\b/im.test((info?.oracleText ?? "").split("\n//\n")[0]!);

/** Burn that can go at a player: "Lightning Bolt deals 3 damage to any
    target", "… to target player", "… to each opponent". A storm line is
    allowed (Grapeshot): the copies are the engine's. */
export function burnOf(info: CardInfo | undefined): number {
  if (!/\b(Instant|Sorcery)\b/.test((info?.typeLine ?? "").split(" // ")[0]!)) return 0;
  const lines = sentences(info?.oracleText ?? "").filter((s) => !/^storm$/i.test(s));
  if (lines.length !== 1) return 0;
  const m = /^\S.* deals (\d+) damage to (any target|target player|target opponent|each opponent|target player or planeswalker|target opponent or planeswalker)$/i.exec(lines[0]!);
  return m ? Number(m[1]) : 0;
}
