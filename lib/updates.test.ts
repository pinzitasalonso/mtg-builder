import { describe, expect, it } from "vitest";
import { UPDATES, byArea, weekLabel } from "./updates";

// The public log is written by hand, and once a week by a scheduled
// session: these are the rules a test can hold it to (AGENTS.md has all of them).
describe("What's new", () => {
  it("has a Monday for every week, newest first, each week once", () => {
    const weeks = UPDATES.map((u) => u.week);
    for (const w of weeks) {
      expect(w).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${w}T00:00:00Z`).getUTCDay(), `${w} is a Monday`).toBe(1);
    }
    expect(weeks).toEqual([...weeks].sort().reverse());
    expect(new Set(weeks).size).toBe(weeks.length);
  });

  it("keeps a week short: a title, and one to eight lines of one or two sentences", () => {
    for (const u of UPDATES) {
      expect(u.title.length, u.week).toBeGreaterThan(3);
      expect(u.title.length, u.week).toBeLessThanOrEqual(60);
      expect(u.items.length, u.week).toBeGreaterThanOrEqual(1);
      expect(u.items.length, u.week).toBeLessThanOrEqual(8);
      for (const item of u.items) {
        expect(item.text.length, item.text).toBeLessThanOrEqual(220);
        expect(item.text, item.text).toMatch(/[.!?]$/);
      }
    }
  });

  // What people read never says "AI", and the log is public: nothing about
  // who uses the site, what it earns, or how it's run.
  it("is written the way the rest of the site is, with nothing private", () => {
    for (const u of UPDATES) {
      for (const text of [u.title, ...u.items.map((i) => i.text)]) {
        expect(text, text).not.toMatch(/\bAI\b|\bbots?\b|\bLLM\b|\bGPT\b|Claude|Anthropic/i);
        expect(text, text).not.toMatch(/@|https?:\/\/|\baccounts? (?:signed|made)\b|\busers?\b|revenue|admin|\bPR\b|#\d+/i);
        expect(text, text).not.toMatch(/iOS|iPhone app|App Store|Dial\b/);
      }
    }
  });

  it("labels a week and groups its lines by area", () => {
    expect(weekLabel("2026-11-23")).toBe("Week of 23 November 2026");
    expect(weekLabel("2026-09-07")).toBe("Week of 7 September 2026");
    expect(
      byArea([
        { area: "Decks", text: "a." },
        { area: "Playtest", text: "b." },
        { area: "Decks", text: "c." },
      ])
    ).toEqual([
      { area: "Decks", texts: ["a.", "c."] },
      { area: "Playtest", texts: ["b."] },
    ]);
  });
});
