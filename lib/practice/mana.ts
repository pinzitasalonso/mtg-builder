// Mana for the AI's side: what it can make right now, and paying a cost from
// it. Colours are paid first (each from the source with the fewest other
// uses), then the generic part. A source that makes two ({C}{C}) gives both
// to the same payment; what's left over is lost, which is close enough.
// A source that hurts (Ancient Tomb) is used after the ones that don't.

import type { PlayCard, PlaytestState } from "../playtest";
import { infoOf, isCreature, isSick, manaOutput } from "./cards";
import { doublesTreasures } from "./treasure";
import type { CardBook, CardInfo } from "./types";

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
  /** Not tapped: used once a turn (Vivi's {0} ability). */
  once?: boolean;
  /** Also tapped when it's used (the land paying Selvala's {G}). */
  also?: number[];
  /** Makes all its mana at once: what the payment doesn't use floats. */
  float?: boolean;
  /** The life using it costs (Ancient Tomb: 2). */
  pain?: number;
}

/** A card's colours, from its mana cost. */
export const colorsOfCost = (info: CardInfo | undefined): string[] => [...new Set([...(info?.manaCost ?? "").split(" // ")[0]!.matchAll(/[WUBRG]/g)].map((m) => m[0]))];

/** Untapped permanents that can tap for mana now (creatures not summoning
    sick). Each card's own conditions are checked: Mox Opal needs three
    artifacts, Mox Amber a legendary creature or planeswalker (and gives its
    colours), Chrome Mox the card exiled with it, Springleaf Drum a creature
    to tap. Jeweled Lotus counts only with `commander` (the mana is for the
    commander). */
export function manaSources(side: PlaytestState, book: CardBook, turn: number, exclude: number[] = [], opts: { commander?: boolean } = {}): Source[] {
  const out: Source[] = [];
  const typeOf = (c: PlayCard) => (c.token ? (c.typeLine ?? "") : (infoOf(book, c)?.typeLine ?? c.typeLine ?? "").split(" // ")[0]!);
  const isArtifact = (c: PlayCard) => (c.token ? c.token.kind === "artifact" : /\bArtifact\b/.test(typeOf(c)));
  const count = (what: string) =>
    side.battlefield.filter((c) => (what === "creature" ? isCreature(book, c) : what === "artifact" ? isArtifact(c) : new RegExp(`\\b${what}\\b`, "i").test(typeOf(c)))).length;
  const drums: PlayCard[] = [];
  const goldspan = side.battlefield.some((c) => doublesTreasures(book, c));
  for (const c of side.battlefield) {
    if (c.tapped || exclude.includes(c.iid)) continue;
    // A Treasure is one mana of any colour (two with Goldspan Dragon), used
    // up when it's spent.
    if (c.token) {
      if (c.token.kind === "artifact" && /^treasure$/i.test(c.name)) out.push({ iid: c.iid, name: c.name, colors: ["W", "U", "B", "R", "G"], amount: goldspan ? 2 : 1, sacrifice: true });
      continue;
    }
    const info = infoOf(book, c);
    const made = manaOutput(info, c.typeLine, !!c.flipped);
    if (!made) continue;
    if (isCreature(book, c) && isSick(book, c, turn)) continue;
    if (made.commanderOnly && !opts.commander) continue;
    if (made.metalcraft && count("artifact") < 3) continue;
    let colors = made.colors;
    if (made.from === "legends") {
      const legends = side.battlefield.filter((x) => /\bLegendary\b/.test(typeOf(x)) && /\b(Creature|Planeswalker)\b/.test(typeOf(x)));
      colors = [...new Set(legends.flatMap((x) => colorsOfCost(infoOf(book, x))))];
    } else if (made.from === "imprint") colors = c.imprint ?? [];
    if (!colors.length) continue;
    const amount = made.per ? count(made.per) - (made.input ?? 0) : made.amount;
    if (amount <= 0) continue;
    if (made.tapCreature) {
      drums.push(c);
      continue;
    }
    out.push({ iid: c.iid, name: c.name, colors, amount, sacrifice: made.sacrifice || undefined, pain: made.pain });
  }
  // Springleaf Drum: an untapped creature of yours is tapped with it (one
  // that makes no mana itself, and a new one for each Drum).
  const taken = new Set<number>();
  for (const drum of drums) {
    const helper = side.battlefield.find((c) => !c.tapped && !exclude.includes(c.iid) && isCreature(book, c) && !taken.has(c.iid) && !out.some((s) => s.iid === c.iid));
    if (!helper) continue;
    taken.add(helper.iid);
    out.push({ iid: drum.iid, name: drum.name, colors: ["W", "U", "B", "R", "G"], amount: 1, also: [helper.iid] });
  }
  return out;
}

/** Floating mana as sources: unit i is iid -(i + 1). A unit is a colour
    letter, or several ("UR": either, from Vivi). */
export const poolSources = (pool: string[] | undefined): Source[] =>
  (pool ?? []).map((c, i) => ({ iid: -(i + 1), name: "floating mana", colors: c.split(""), amount: 1 }));

export const manaTotal = (sources: Source[]) => sources.reduce((n, s) => n + s.amount, 0);

/** The sources to tap to pay a cost, and the life it costs; null when it
    can't be paid. Generic "2" in a {2/W} pip pays with any two. With
    `lifeFor` (K'rrik: ["B"]), a pip of those colours may be paid with 2 life
    instead: mana first, and life for as few pips as the payment needs. */
export interface Payment {
  tap: number[];
  life: number;
  /** Units used of each source, by iid. */
  used: Record<number, number>;
  /** The life the sources themselves cost (Ancient Tomb). */
  pain: number;
}

export function payCost(cost: Cost, sources: Source[], opts: { x?: number; life?: number; lifeFor?: string[] } = {}): Payment | null {
  const lifeFor = opts.lifeFor ?? [];
  const eligible = lifeFor.length ? cost.pips.filter((p) => p.some((c) => lifeFor.includes(c))).length : 0;
  for (let n = 0; n <= eligible; n++) {
    const paid = payWith(cost, sources, opts, lifeFor, n);
    if (paid) return paid;
  }
  return null;
}

/** One try: `byLife` of the pips `lifeFor` covers are paid with life first;
    any of them mana can't pay is paid with life too. */
function payWith(cost: Cost, sources: Source[], opts: { x?: number; life?: number }, lifeFor: string[], byLife: number): Payment | null {
  const units = sources.flatMap((s) => Array.from({ length: s.amount }, () => ({ iid: s.iid, colors: s.colors, sacrifice: !!s.sacrifice, pain: s.pain ?? 0 })));
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
      const score = (u.iid < 0 ? -100 : 0) + (tappedAlready ? 0 : 100) + (u.sacrifice ? 50 : 0) + (u.pain && !tappedAlready ? 30 : 0) + u.colors.length;
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    });
    return best;
  };
  let generic = cost.generic + cost.xCount * Math.max(0, opts.x ?? 0);
  let life = opts.life ?? 0;
  // Fewest options first.
  const pips = [...cost.pips].sort((a, b) => a.length - b.length);
  let toLife = byLife;
  for (const pip of pips) {
    const colors = pip.filter((c) => c !== "2");
    const lifeOk = pip.some((c) => lifeFor.includes(c));
    if (lifeOk && toLife > 0) {
      toLife--;
      life += 2;
      continue;
    }
    const i = pick((have) => have.some((c) => colors.includes(c)));
    if (i >= 0) take(i);
    else if (pip.includes("2")) generic += 2;
    else if (lifeOk) life += 2;
    else return null;
  }
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
  const counts: Record<number, number> = {};
  for (const i of used) counts[units[i]!.iid] = (counts[units[i]!.iid] ?? 0) + 1;
  const tap = [...new Set([...used].map((i) => units[i]!.iid))];
  const pain = tap.reduce((n, iid) => n + (sources.find((x) => x.iid === iid)?.pain ?? 0), 0);
  return { tap, life, used: counts, pain };
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
