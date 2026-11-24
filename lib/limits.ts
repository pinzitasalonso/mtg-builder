// Plan limits — the pure half (no Prisma import, so tests stay hermetic;
// the DB-touching helpers live in lib/limits-db.ts). Tiers live on
// User.tier: "free" is the default; "pro" (Spellpool Pro, on the web through
// Stripe and in the iOS app) lifts every cap. Decks have no cap on any plan.

// Typed as numbers, not as the literal 2: the copy that says "question" or
// "questions" compares them with 1.
export const FREE_AI_PER_DAY: number = 2;
// Deck scans — the Score plus the AI's written analysis — are dearer than a
// chat turn, so they have their own meter: two a day free, unlimited on Pro.
export const FREE_SCANS_PER_DAY: number = 2;
// Practice games against the AI: two a day free, unlimited on Pro. Each
// game allows this many AI turns, after which the opponent plays on its
// built-in planner.
export const FREE_PRACTICE_PER_DAY: number = 2;
export const PRACTICE_AI_TURNS = 40;

// Decks need an account: a signed-out visitor used to get a public deck that
// anybody could edit.
export const SIGN_IN_FOR_DECKS_MSG = "Sign in to create a deck — it's free.";

/* "today's free coach question" or "today's 2 free coach questions": the
   limit messages follow the numbers above. */
function todays(n: number, one: string, many: string): string {
  return n === 1 ? `today's free ${one}` : `today's ${n} free ${many}`;
}
const BACK = (n: number) => (n === 1 ? "It's back" : "They're back");
export const AI_LIMIT_MSG =
  `You've used ${todays(FREE_AI_PER_DAY, "coach question", "coach questions")}. ${BACK(FREE_AI_PER_DAY)} at midnight UTC. Spellpool Pro has no daily limit.`;
export const PRACTICE_LIMIT_MSG =
  `You've played ${todays(FREE_PRACTICE_PER_DAY, "practice match", "practice matches")}. ${BACK(FREE_PRACTICE_PER_DAY)} at midnight UTC. Spellpool Pro makes them unlimited.`;
export const SCAN_LIMIT_MSG =
  `You've used ${todays(FREE_SCANS_PER_DAY, "deck scan", "deck scans")}. ${BACK(FREE_SCANS_PER_DAY)} at midnight UTC. Spellpool Pro makes scans unlimited.`;

/* Is this text one of the three "you've reached today's free limit"
   messages? The screens that show a route's error use it to put the way to
   Spellpool Pro beside the message. */
export function isLimitMessage(text: string | null | undefined): boolean {
  if (!text) return false;
  if (text === AI_LIMIT_MSG || text === PRACTICE_LIMIT_MSG || text === SCAN_LIMIT_MSG) return true;
  // The same messages with other numbers: a page loaded before a deploy that
  // changed the free limits still gets the server's new wording, and must
  // still show the way to Pro beside it.
  return /^You've (used|played) today's .*free .* at midnight UTC\. Spellpool Pro /.test(text);
}

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
