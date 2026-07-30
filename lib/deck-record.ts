// A deck's play record, as submitted by a client editing it by hand.
//
// The /record endpoint increments (one finished game, reported by the tracker).
// This is the other direction: the owner correcting the totals, so the numbers
// arrive as a SET. That means they arrive unvalidated, and the one incoherent
// state a two-field editor invites is more wins than games played — which makes
// every win rate in both clients wrong. So it's clamped here rather than
// trusted.

export interface DeckRecord {
  gamesPlayed: number;
  gamesWon: number;
}

// A non-negative whole number, or `fallback` when the value isn't one.
function count(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

// Resolve a submitted record against what's already stored. Either field may be
// absent — a client that only edits wins keeps the stored games-played.
export function clampDeckRecord(
  submitted: { gamesPlayed?: unknown; gamesWon?: unknown },
  stored: DeckRecord
): DeckRecord {
  const gamesPlayed = count(
    submitted.gamesPlayed ?? stored.gamesPlayed,
    stored.gamesPlayed
  );
  const gamesWon = count(submitted.gamesWon ?? stored.gamesWon, stored.gamesWon);
  return { gamesPlayed, gamesWon: Math.min(gamesWon, gamesPlayed) };
}
