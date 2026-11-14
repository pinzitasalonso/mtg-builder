// Instants and sorceries the AI's built-in planner can cast on its own:
// tutors, board wipes, and spells that draw. Each reader takes a card only
// when its whole text is something the planner can carry out with the
// effect vocabulary (lib/practice/types.ts Effect), so a card that does
// more is left alone, as before.

import { searchOnCast, type Search } from "./cards";
import type { CardInfo } from "./types";

const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const num = (w: string) => NUMBERS[w.toLowerCase()] ?? Number(w);

const isSpell = (info: CardInfo | undefined) => /\b(Instant|Sorcery)\b/.test((info?.typeLine ?? "").split(" // ")[0]!);

/** The text's sentences, without reminder text or full stops. */
function sentences(info: CardInfo | undefined): string[] {
  return (info?.oracleText ?? "")
    .split("\n//\n")[0]!
    .replace(/\([^)]*\)/g, "")
    .split(/\n|(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter(Boolean);
}

/** A tutor: "Search your library for a card, put that card into your
    hand, then shuffle" (Demonic Tutor), or onto the top (Vampiric Tutor,
    Mystical Tutor, Worldly Tutor, Enlightened Tutor, Imperial Seal), and
    perhaps "You lose N life". */
export interface Tutor {
  search: Search;
  lose: number;
}
export function tutorOf(info: CardInfo | undefined): Tutor | null {
  if (!isSpell(info)) return null;
  const [first, ...rest] = sentences(info);
  if (!first || !/^search your library for /i.test(first)) return null;
  let lose = 0;
  for (const s of rest) {
    const m = /^you lose (\d+) life$/i.exec(s);
    if (!m) return null;
    lose += Number(m[1]);
  }
  const search = searchOnCast(info);
  if (!search || search.count !== 1 || search.to[0]!.zone === "battlefield") return null;
  return { search, lose };
}

/** A board wipe: "Destroy all creatures" (Wrath of God, Damnation, Day of
    Judgment, Supreme Verdict), "~ deals N damage to each creature"
    (Pyroclasm), "All creatures get -N/-N until end of turn", and Toxic
    Deluge's X, paid in life. */
export interface Wipe {
  kind: "destroy" | "damage" | "shrink";
  /** Damage or -N/-N; null for Toxic Deluge's X, chosen as it's cast. */
  amount: number | null;
}
export function wipeOf(info: CardInfo | undefined): Wipe | null {
  if (!isSpell(info)) return null;
  let wipe: Wipe | null = null;
  let payX = false;
  for (const s of sentences(info)) {
    if (/^they can't be regenerated$|^this spell can't be countered$/i.test(s)) continue;
    if (/^as an additional cost to cast this spell, pay x life$/i.test(s)) {
      payX = true;
      continue;
    }
    let m: RegExpExecArray | null;
    if (!wipe && /^destroy all creatures$/i.test(s)) wipe = { kind: "destroy", amount: 0 };
    else if (!wipe && (m = /^\S.* deals (\d+) damage to each creature$/i.exec(s))) wipe = { kind: "damage", amount: Number(m[1]) };
    else if (!wipe && (m = /^all creatures get -(\d+|x)\/-\1 until end of turn$/i.exec(s))) wipe = { kind: "shrink", amount: m[1]!.toLowerCase() === "x" ? null : Number(m[1]) };
    else return null;
  }
  if (!wipe || (wipe.amount === null) !== payX) return null;
  return wipe;
}

/** A spell that draws and maybe costs life, with a scry before it that the
    planner skips: "Draw two cards", "You draw two cards and lose 2 life"
    (Night's Whisper), "Target player draws two cards and loses 2 life"
    (Sign in Blood, on itself), "Scry 1. Draw a card" (Opt), "Scry 2, then
    draw two cards. You lose 2 life" (Read the Bones). */
export interface DrawSpell {
  draw: number;
  lose: number;
}
export function drawSpellOf(info: CardInfo | undefined): DrawSpell | null {
  if (!isSpell(info)) return null;
  let draw = 0;
  let lose = 0;
  for (const s of sentences(info)) {
    let m: RegExpExecArray | null;
    if ((m = /^(?:scry \d+, then )?(?:you )?draw (a|one|two|three|four) cards?(?: and (?:you )?lose (\d+) life)?$/i.exec(s))) {
      draw += num(m[1]!);
      lose += Number(m[2] ?? 0);
    } else if ((m = /^target player draws (a|one|two|three) cards? and loses (\d+) life$/i.exec(s))) {
      draw += num(m[1]!);
      lose += Number(m[2]);
    } else if ((m = /^you lose (\d+) life$/i.exec(s))) lose += Number(m[1]);
    else if (/^scry \d+$/i.test(s)) continue;
    else return null;
  }
  return draw ? { draw, lose } : null;
}
