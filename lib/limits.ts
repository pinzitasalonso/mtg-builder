// Plan limits — the pure half (no Prisma import, so tests stay hermetic;
// the DB-touching helpers live in lib/limits-db.ts). Tiers live on
// User.tier: "free" is the default; "pro" (Spellpool Pro) lifts every
// cap.

export const FREE_DECK_LIMIT = 5;
export const FREE_AI_PER_DAY = 4;
// Deck scans — the Score plus the AI's written analysis — are dearer than a
// chat turn, so they have their own meter: one a day free, unlimited on Pro.
export const FREE_SCANS_PER_DAY = 1;

// The free plan's refusals, shown as sent by both clients. `proOnSale` is
// whether Pro can be bought right now — the web paywall is switched on (see
// proOnSale in lib/revenuecat.ts). Until then Pro is "coming soon". After,
// the web puts its own Get Pro beside the message, so it doesn't say where.
function proLifts(proOnSale: boolean, what: string): string {
  return proOnSale ? `Spellpool Pro ${what}.` : `Spellpool Pro, coming soon, ${what}.`;
}
export const deckLimitMsg = (proOnSale: boolean) =>
  `The free plan holds ${FREE_DECK_LIMIT} decks — delete one to make room. ${proLifts(proOnSale, "lifts the limit")}`;
export const aiLimitMsg = (proOnSale: boolean) =>
  `You've used your ${FREE_AI_PER_DAY} free AI asks for today — they reset at midnight UTC. ${proLifts(proOnSale, "lifts the limit")}`;
export const scanLimitMsg = (proOnSale: boolean) =>
  `You've used today's free deck scan — it resets at midnight UTC. ${proLifts(proOnSale, "makes scans unlimited")}`;

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
