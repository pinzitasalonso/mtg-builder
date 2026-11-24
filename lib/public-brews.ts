// The home page's "Decks the pool is talking about": the ownerless decks
// (made before decks needed an account) cut down to the finished ones.
// Most of that pool is abandoned starts — a commander and nothing else —,
// tests and copies of the same deck, so only a deck that looks like a real
// brew is shown, best first.

import { formatSpec } from "@/lib/deck-prompts";

export const PUBLIC_BREWS_SHOWN = 12;

export interface BrewCandidate {
  name: string;
  format: string;
  commander: string | null;
  /** The commander's art (null when the commander isn't in the decklist). */
  cover: string | null;
  /** Cards in the decklist, summed by quantity. */
  deckCount: number;
  /** The last Deck Score, when the deck was scanned. */
  score: number | null;
  createdAt: Date;
}

// Names people give a deck they are only trying things with.
const THROWAWAY_NAME = /^\W*$|^\w?$|\btest\b|\bdeck \d+$/i;

/** Whether a public deck looks finished enough to show off. */
export function isRealBrew(d: BrewCandidate): boolean {
  const spec = formatSpec(d.format);
  // A full decklist: at least 95% of the format's size, and not a pile of
  // a thousand cards either.
  if (d.deckCount < Math.ceil(spec.deckSize * 0.95) || d.deckCount > Math.floor(spec.deckSize * 1.1)) return false;
  if (THROWAWAY_NAME.test(d.name.trim())) return false;
  // A commander deck names its commander, and the commander is in the list
  // (its art is the tile's picture).
  if (spec.usesCommander && (!d.commander?.trim() || !d.cover)) return false;
  return true;
}

const key = (d: BrewCandidate) => `${d.name.trim().toLowerCase()}|${(d.commander ?? "").trim().toLowerCase()}`;

/**
 * The decks to show: real brews only, one of each name and commander, the
 * scanned ones first by Deck Score, then the newest. At most `limit`.
 */
export function pickPublicBrews<T extends BrewCandidate>(decks: T[], limit = PUBLIC_BREWS_SHOWN): T[] {
  const ranked = decks.filter(isRealBrew).sort((a, b) => {
    if ((a.score ?? -1) !== (b.score ?? -1)) return (b.score ?? -1) - (a.score ?? -1);
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  const seen = new Set<string>();
  const out: T[] = [];
  for (const d of ranked) {
    if (seen.has(key(d))) continue;
    seen.add(key(d));
    out.push(d);
    if (out.length === limit) break;
  }
  return out;
}
