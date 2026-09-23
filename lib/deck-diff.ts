// Deck versions: what a snapshot holds, and the difference between two lists.
// Pure, so the comparison the versions panel shows is testable.

import { normalizeCardKey } from "./scryfall";

export type Board = "pool" | "deck";

export interface VersionCard {
  name: string;
  quantity: number;
  board: Board;
  scryfallId?: string;
}

export interface VersionSummary {
  id: number;
  label: string | null;
  createdAt: string;
  deckCount: number;
  poolCount: number;
}

export interface DeckDiff {
  added: { name: string; quantity: number }[];
  removed: { name: string; quantity: number }[];
  changed: { name: string; from: number; to: number }[];
  /** Cards present in both with the same count. */
  unchanged: number;
}

/** Copies per name on one board, merging rows that share a name. */
function countsOn(cards: VersionCard[], board: Board): Map<string, { name: string; quantity: number }> {
  const m = new Map<string, { name: string; quantity: number }>();
  for (const c of cards) {
    if (c.board !== board) continue;
    const k = normalizeCardKey(c.name);
    const prev = m.get(k);
    if (prev) prev.quantity += c.quantity;
    else m.set(k, { name: c.name, quantity: c.quantity });
  }
  return m;
}

/** What changed on a board between `before` (a saved version) and `after` (now). */
export function diffDecklists(before: VersionCard[], after: VersionCard[], board: Board = "deck"): DeckDiff {
  const a = countsOn(before, board);
  const b = countsOn(after, board);
  const diff: DeckDiff = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const [k, now] of b) {
    const was = a.get(k);
    if (!was) diff.added.push({ name: now.name, quantity: now.quantity });
    else if (was.quantity !== now.quantity) diff.changed.push({ name: now.name, from: was.quantity, to: now.quantity });
    else diff.unchanged++;
  }
  for (const [k, was] of a) if (!b.has(k)) diff.removed.push({ name: was.name, quantity: was.quantity });
  const byName = (x: { name: string }, y: { name: string }) => x.name.localeCompare(y.name);
  diff.added.sort(byName);
  diff.removed.sort(byName);
  diff.changed.sort(byName);
  return diff;
}

export const isEmptyDiff = (d: DeckDiff) => d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;
