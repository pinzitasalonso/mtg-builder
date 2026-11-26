// What changes damage as it's dealt: the red multipliers. Read whole
// sentences from each permanent on the battlefield, for both sides:
// - Torbran: "If a red source you control would deal damage to an opponent
//   or a permanent an opponent controls, it deals that much damage plus 2
//   instead."
// - Fiery Emancipation, City on Fire: triple, any target.
// - Furnace of Rath, Dictate of the Twin Gods: double, any source.
// - Twinflame Tyrant: double, to opponents. Solphim: double noncombat, to
//   opponents. Angrath's Marauders: double. Gratuitous Violence: double, a
//   creature's.
// - Ojer Axonil: a red source's noncombat damage to an opponent is at
//   least Ojer's power.
// - Fiendish Duo: double, any source, to its controller's opponents.
// The controller orders them as suits them: Ojer first, then +2, then the
// multipliers.

import type { PlayCard } from "../playtest";
import { faceText, infoOf, isCreature, ownText, stats } from "./cards";
import { colorsOfCost } from "./mana";
import type { CardBook, PracticeGame, Seat } from "./types";

export interface DamageRule {
  /** Whose sources: the controller's ("you"), or every source ("any"). */
  who: "you" | "any";
  /** Damage to anyone, or only to an opponent and their permanents. */
  to: "any" | "opponents";
  times?: number;
  plus?: number;
  red?: boolean;
  creature?: boolean;
  noncombat?: boolean;
  /** Ojer Axonil: at least this much, and only to a player. */
  atLeast?: number;
  playersOnly?: boolean;
  /** Fiendish Duo: "an opponent" is its controller's, whoever the source is. */
  foesOfController?: boolean;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function damageRuleOf(book: CardBook, card: PlayCard): DamageRule | null {
  if (card.token) return null;
  const name = card.name.split(" // ")[0]!;
  const short = name.split(",")[0]!;
  for (const raw of ownText(faceText(infoOf(book, card), card)).split("\n")) {
    const s = raw.trim().replace(/\.$/, "");
    let m = /^if a (red )?(source|creature) you control would deal (noncombat )?damage to (an opponent or a permanent an opponent controls|a permanent or player), it deals (double|triple) that damage(?: to that (?:permanent or player|player or permanent))? instead$/i.exec(s);
    if (m) {
      return {
        who: "you",
        to: /opponent/i.test(m[4]!) ? "opponents" : "any",
        times: m[5]!.toLowerCase() === "triple" ? 3 : 2,
        ...(m[1] ? { red: true } : {}),
        ...(m[2]!.toLowerCase() === "creature" ? { creature: true } : {}),
        ...(m[3] ? { noncombat: true } : {}),
      };
    }
    if (/^if a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead$/i.test(s)) return { who: "any", to: "any", times: 2 };
    // Fiendish Duo: any source, to its controller's opponents (the players).
    if (/^if a source would deal damage to an opponent, it deals double that damage to that player instead$/i.test(s)) return { who: "any", to: "any", times: 2, playersOnly: true, foesOfController: true };
    if (/^if a red source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead$/i.test(s)) return { who: "you", to: "opponents", plus: 2, red: true };
    m = new RegExp(`^if a red source you control would deal an amount of noncombat damage less than (?:${esc(name)}|${esc(short)})'s power to an opponent, that source deals damage equal to (?:${esc(name)}|${esc(short)})'s power instead$`, "i").exec(s);
    if (m) return { who: "you", to: "opponents", red: true, noncombat: true, playersOnly: true, atLeast: Math.max(0, stats(book, card).power) };
  }
  return null;
}

/** Red: a red pip in its mana cost (a token's colour isn't known). */
const isRed = (book: CardBook, src: PlayCard | null) => !!src && !src.token && colorsOfCost(infoOf(book, src)).includes("R");

/** The damage a source of `from`'s deals to `to` (the player, or with
    `permanent` a permanent they control), after every multiplier on the
    battlefield. */
export function scaleDamage(g: PracticeGame, book: CardBook, from: Seat, src: PlayCard | null, to: Seat, amount: number, combat = false, permanent = false): number {
  if (amount <= 0) return amount;
  // Protection from everything (The One Ring, the turn it's cast): no damage to that player.
  if (!permanent && g.shield?.[to]) return 0;
  const rules = (["you", "opp"] as Seat[]).flatMap((s) => g.sides[s].battlefield.flatMap((c) => {
    const r = damageRuleOf(book, c);
    return r ? [{ r, s }] : [];
  }));
  if (!rules.length) return amount;
  const applies = ({ r, s }: { r: DamageRule; s: Seat }) =>
    (r.who === "any" || s === from) &&
    (r.to === "any" || to !== from) &&
    (!r.red || isRed(book, src)) &&
    (!r.creature || (!!src && isCreature(book, src))) &&
    (!r.noncombat || !combat) &&
    (!r.playersOnly || !permanent) &&
    (!r.foesOfController || to !== s);
  let n = amount;
  for (const x of rules) if (x.r.atLeast !== undefined && applies(x)) n = Math.max(n, x.r.atLeast);
  for (const x of rules) if (x.r.plus && applies(x)) n += x.r.plus;
  for (const x of rules) if (x.r.times && applies(x)) n *= x.r.times;
  return n;
}
