import { describe, expect, it } from "vitest";
import { latest, summarize, type AccountRow } from "./admin-stats";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const row = (o: Partial<AccountRow>): AccountRow => ({
  id: 1, email: "a@x.com", name: null, createdAt: "2026-09-27T08:00:00Z", tier: "free", verified: true, signIn: ["password"],
  decks: 0, builtDecks: 0, cards: 0, collection: 0, aiQuestions: 0, aiQuestions7d: 0, scans: 0, versions: 0, games: 0,
  lastActive: "2026-09-27T09:00:00Z", ...o,
});

describe("summarize", () => {
  const s = summarize(
    [
      row({ id: 1, tier: "pro", decks: 2, builtDecks: 1, aiQuestions: 3, aiQuestions7d: 2, scans: 1 }),
      row({ id: 2, verified: false, createdAt: "2026-09-20T10:00:00Z", lastActive: "2026-09-22T10:00:00Z", decks: 1 }),
      row({ id: 3, createdAt: "2026-06-01T10:00:00Z", lastActive: "2026-06-02T10:00:00Z", aiQuestions: 1 }),
    ],
    NOW
  );
  it("counts accounts, pro and activity windows", () => {
    expect(s.accounts).toBe(3);
    expect(s.pro).toBe(1);
    expect(s.active).toEqual({ d1: 1, d7: 2, d30: 2 });
    // #2 joined 7 days ago and came back 5 days ago: returning.
    expect(s.returning7d).toBe(1);
    expect(s.signups7d).toBe(1);
    expect(s.signupsPrev7d).toBe(1);
  });
  it("buckets signups into the last 30 days, oldest first", () => {
    expect(s.signups).toHaveLength(30);
    expect(s.signups[29]).toEqual({ day: "2026-09-27", count: 1 });
    expect(s.signups.find((d) => d.day === "2026-09-20")?.count).toBe(1);
    expect(s.signups.reduce((n, d) => n + d.count, 0)).toBe(2); // June is out of range
  });
  it("totals the AI questions", () => {
    expect(s.ai).toEqual({ total: 4, last7d: 2, askers7d: 1 });
  });
  it("walks the funnel", () => {
    expect(s.funnel.map((f) => f.count)).toEqual([3, 2, 2, 1, 2, 1]);
  });
});

describe("latest", () => {
  it("picks the newest moment and skips nulls", () => {
    expect(latest(null, "2026-01-01T00:00:00Z", new Date("2026-03-01T00:00:00Z"), undefined)).toBe("2026-03-01T00:00:00.000Z");
  });
});
