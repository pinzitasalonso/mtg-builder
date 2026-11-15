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

/** Burn that can go at a player: "Lightning Bolt deals 3 damage to any
    target", "… to target player", "… to each opponent". */
export function burnOf(info: CardInfo | undefined): number {
  if (!/\b(Instant|Sorcery)\b/.test((info?.typeLine ?? "").split(" // ")[0]!)) return 0;
  const lines = sentences(info?.oracleText ?? "");
  if (lines.length !== 1) return 0;
  const m = /^\S.* deals (\d+) damage to (any target|target player|target opponent|each opponent|target player or planeswalker|target opponent or planeswalker)$/i.exec(lines[0]!);
  return m ? Number(m[1]) : 0;
}
