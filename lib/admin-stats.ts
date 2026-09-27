/* The admin page's numbers, worked out from one row per account. Pure (no
   database), so the maths is tested on its own; the route gathers the rows. */

export interface AccountRow {
  id: number;
  email: string;
  name: string | null;
  createdAt: string;
  tier: string;
  /** Email confirmed, or signed up with Apple/Google (which vouch for it). */
  verified: boolean;
  /** How they sign in: "password", "google", "apple". */
  signIn: string[];
  decks: number;
  /** Decks with a full list on the deck board (60+ cards). */
  builtDecks: number;
  /** Cards on the deck boards of all their decks. */
  cards: number;
  /** Different cards in their collection. */
  collection: number;
  /** Questions asked of the assistant. Counted from its server-side thread,
   *  so from when it moved there (27 Sep 2026); older chats weren't kept. */
  aiQuestions: number;
  aiQuestions7d: number;
  scans: number;
  versions: number;
  games: number;
  /** Their latest sign-in, question, new deck or added card. */
  lastActive: string;
}

export interface FunnelStep {
  label: string;
  count: number;
}

export interface AdminSummary {
  accounts: number;
  pro: number;
  active: { d1: number; d7: number; d30: number };
  /** New accounts per UTC day, the last 30 days, oldest first. */
  signups: { day: string; count: number }[];
  /** Accounts that got at least this far. */
  funnel: FunnelStep[];
  ai: {
    total: number;
    last7d: number;
    /** Accounts that asked at least once in the last 7 days. */
    askers7d: number;
  };
}

const DAY = 86_400_000;

export function lastNDays(n: number, now = Date.now()): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) days.push(new Date(now - i * DAY).toISOString().slice(0, 10));
  return days;
}

export function summarize(rows: AccountRow[], now = Date.now()): AdminSummary {
  const within = (iso: string, days: number) => now - new Date(iso).getTime() < days * DAY;
  const days = lastNDays(30, now);
  const perDay = new Map(days.map((d) => [d, 0]));
  for (const r of rows) {
    const d = r.createdAt.slice(0, 10);
    if (perDay.has(d)) perDay.set(d, perDay.get(d)! + 1);
  }
  const count = (f: (r: AccountRow) => boolean) => rows.filter(f).length;
  return {
    accounts: rows.length,
    pro: count((r) => r.tier === "pro"),
    active: { d1: count((r) => within(r.lastActive, 1)), d7: count((r) => within(r.lastActive, 7)), d30: count((r) => within(r.lastActive, 30)) },
    signups: days.map((day) => ({ day, count: perDay.get(day)! })),
    ai: {
      total: rows.reduce((n, r) => n + r.aiQuestions, 0),
      last7d: rows.reduce((n, r) => n + r.aiQuestions7d, 0),
      askers7d: count((r) => r.aiQuestions7d > 0),
    },
    funnel: [
      { label: "Signed up", count: rows.length },
      { label: "Verified", count: count((r) => r.verified) },
      { label: "Made a deck", count: count((r) => r.decks > 0) },
      { label: "Built a full deck", count: count((r) => r.builtDecks > 0) },
      { label: "Asked the AI", count: count((r) => r.aiQuestions > 0) },
      { label: "Scanned a deck", count: count((r) => r.scans > 0) },
    ],
  };
}

/** The latest of several ISO/Date moments (nulls skipped). */
export function latest(...ts: (Date | string | null | undefined)[]): string {
  let best = 0;
  for (const t of ts) {
    if (!t) continue;
    const v = new Date(t).getTime();
    if (v > best) best = v;
  }
  return new Date(best).toISOString();
}
