// Mana for the AI's side: what it can make right now, and paying a cost from
// it. Colours are paid first (each from the source with the fewest other
// uses), then the generic part. A source that makes two ({C}{C}) gives both
// to the same payment; what's left over is lost, which is close enough.

import type { PlaytestState } from "../playtest";
import { infoOf, isCreature, isSick, manaOutput } from "./cards";
import type { CardBook } from "./types";

export interface Cost {
  generic: number;
  /** One entry per coloured pip: the colours that pay it. */
  pips: string[][];
  /** Phyrexian pips: a colour, or 2 life. */
  phyrexian: string[];
  /** How many X. */
  xCount: number;
}

export function parseCost(manaCost: string | null | undefined): Cost {
  const cost: Cost = { generic: 0, pips: [], phyrexian: [], xCount: 0 };
  // A split or modal card: the front face's cost.
  const front = (manaCost ?? "").split(" // ")[0]!;
  for (const m of front.matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1]!.toUpperCase();
    if (/^\d+$/.test(sym)) cost.generic += Number(sym);
    else if (sym === "X") cost.xCount++;
    else if (/^[WUBRGC]$/.test(sym)) cost.pips.push([sym]);
    else if (/^[WUBRG]\/P$/.test(sym)) cost.phyrexian.push(sym[0]!);
    else if (/^2\/[WUBRG]$/.test(sym)) cost.pips.push([sym[2]!, "2"]);
    else if (/^[WUBRGC]\/[WUBRGC]$/.test(sym)) cost.pips.push([sym[0]!, sym[2]!]);
    else if (sym === "S") cost.generic++;
  }
  return cost;
}

export const totalOf = (cost: Cost, x = 0) => cost.generic + cost.pips.length + cost.phyrexian.length + cost.xCount * x;

export interface Source {
  /** The permanent; negative for a unit of floating mana (poolSources). */
  iid: number;
  name: string;
  colors: string[];
  amount: number;
  /** Used up when it's used (Lotus Petal). */
  sacrifice?: boolean;
}

/** Untapped permanents that can tap for mana now (creatures not summoning sick). */
export function manaSources(side: PlaytestState, book: CardBook, turn: number, exclude: number[] = []): Source[] {
  const out: Source[] = [];
  for (const c of side.battlefield) {
    if (c.tapped || exclude.includes(c.iid)) continue;
    // A Treasure is one mana of any colour, used up when it's spent.
    if (c.token) {
      if (c.token.kind === "artifact" && /^treasure$/i.test(c.name)) out.push({ iid: c.iid, name: c.name, colors: ["W", "U", "B", "R", "G"], amount: 1, sacrifice: true });
      continue;
    }
    const info = infoOf(book, c);
    const made = manaOutput(info, c.typeLine);
    if (!made) continue;
    if (isCreature(book, c) && isSick(book, c, turn)) continue;
    // Lion's Eye Diamond costs the hand: not a source to pay with.
    if (made.sacrifice && /discard your hand/i.test(info?.oracleText ?? "")) continue;
    out.push({ iid: c.iid, name: c.name, colors: made.colors, amount: made.amount, sacrifice: made.sacrifice || undefined });
  }
  return out;
}

/** Floating mana as sources: unit i is iid -(i + 1). */
export const poolSources = (pool: string[] | undefined): Source[] =>
  (pool ?? []).map((c, i) => ({ iid: -(i + 1), name: "floating mana", colors: [c], amount: 1 }));

export const manaTotal = (sources: Source[]) => sources.reduce((n, s) => n + s.amount, 0);

/** The sources to tap to pay a cost, and the life it costs; null when it
    can't be paid. Generic "2" in a {2/W} pip pays with any two. */
export function payCost(cost: Cost, sources: Source[], opts: { x?: number; life?: number } = {}): { tap: number[]; life: number } | null {
  const units = sources.flatMap((s) => Array.from({ length: s.amount }, () => ({ iid: s.iid, colors: s.colors, sacrifice: !!s.sacrifice })));
  const used = new Set<number>();
  const take = (i: number) => used.add(i);
  const pick = (ok: (colors: string[]) => boolean) => {
    // Floating mana first (it's gone at the end of the phase), then a unit
    // of a source already tapped for this payment, then the one that can
    // do the fewest other things; a source used up by using it last.
    let best = -1;
    let bestScore = Infinity;
    units.forEach((u, i) => {
      if (used.has(i) || !ok(u.colors)) return;
      const tappedAlready = u.iid < 0 || [...used].some((j) => units[j]!.iid === u.iid);
      const score = (u.iid < 0 ? -100 : 0) + (tappedAlready ? 0 : 100) + (u.sacrifice ? 50 : 0) + u.colors.length;
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    });
    return best;
  };
  let generic = cost.generic + cost.xCount * Math.max(0, opts.x ?? 0);
  // Fewest options first.
  const pips = [...cost.pips].sort((a, b) => a.length - b.length);
  for (const pip of pips) {
    const colors = pip.filter((c) => c !== "2");
    const i = pick((have) => have.some((c) => colors.includes(c)));
    if (i >= 0) take(i);
    else if (pip.includes("2")) generic += 2;
    else return null;
  }
  let life = opts.life ?? 0;
  for (const c of cost.phyrexian) {
    const i = pick((have) => have.includes(c));
    if (i >= 0) take(i);
    else life += 2;
  }
  for (let n = 0; n < generic; n++) {
    const i = pick(() => true);
    if (i < 0) return null;
    take(i);
  }
  return { tap: [...new Set([...used].map((i) => units[i]!.iid))], life };
}

/** "5 mana: G G U C C" — for the AI's brief. */
export function manaSummary(sources: Source[]): string {
  if (!sources.length) return "no mana";
  const parts = sources.map((s) => {
    const kind = s.amount > 1 ? `${s.amount}×${s.colors.join("/")}` : s.colors.join("/");
    return s.iid < 0 ? `${kind} floating` : s.sacrifice ? `${kind} (${s.name}, used up)` : kind;
  });
  return `${manaTotal(sources)} mana: ${parts.join(", ")}`;
}
