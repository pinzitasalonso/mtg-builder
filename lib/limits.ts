// Plan limits — the pure half (no Prisma import, so tests stay hermetic;
// the DB-touching helpers live in lib/limits-db.ts). Tiers live on
// User.tier: "free" is the default; "pro" (the future paid tier) lifts
// every cap.

export const FREE_DECK_LIMIT = 5;
export const FREE_AI_PER_DAY = 4;
// Deck scans — the Score plus the AI's written analysis — are dearer than a
// chat turn, so they have their own meter: one a day free, unlimited on Pro.
export const FREE_SCANS_PER_DAY = 1;

export const DECK_LIMIT_MSG =
  `The free plan holds ${FREE_DECK_LIMIT} decks — delete one to make room. Spellpool Pro (in the iOS app) lifts the limit.`;
export const AI_LIMIT_MSG =
  `You've used your ${FREE_AI_PER_DAY} free AI asks for today — they reset at midnight UTC. Spellpool Pro (in the iOS app) lifts the limit.`;
export const SCAN_LIMIT_MSG =
  `You've used today's free deck scan — it resets at midnight UTC. Spellpool Pro (in the iOS app) makes scans unlimited.`;

export interface TierFields {
  tier?: string | null;
  aiDay?: string | null;
  aiCount?: number | null;
  scanDay?: string | null;
  scanCount?: number | null;
}

export function isPro(user: TierFields | null | undefined): boolean {
  return user?.tier === "pro";
}

/* The UTC day stamp the AI meter is keyed by. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/* AI calls the user has left today; null means unlimited (pro). */
export function aiRemaining(user: TierFields, now: Date = new Date()): number | null {
  if (isPro(user)) return null;
  const used = user.aiDay === utcDay(now) ? user.aiCount ?? 0 : 0;
  return Math.max(0, FREE_AI_PER_DAY - used);
}

/* Deck scans the user has left today; null means unlimited (pro). */
export function scansRemaining(user: TierFields, now: Date = new Date()): number | null {
  if (isPro(user)) return null;
  const used = user.scanDay === utcDay(now) ? user.scanCount ?? 0 : 0;
  return Math.max(0, FREE_SCANS_PER_DAY - used);
}
