import { describe, expect, it } from "vitest";
import { AI_LIMIT_MSG, FREE_AI_PER_DAY, FREE_SCANS_PER_DAY, PRACTICE_LIMIT_MSG, SCAN_LIMIT_MSG, aiRemaining, isLimitMessage, isPro, scansRemaining, utcDay } from "./limits";

describe("utcDay", () => {
  it("stamps the UTC calendar day", () => {
    expect(utcDay(new Date("2026-07-11T23:59:59Z"))).toBe("2026-07-11");
    expect(utcDay(new Date("2026-07-12T00:00:01Z"))).toBe("2026-07-12");
  });
});

describe("aiRemaining", () => {
  const now = new Date("2026-07-11T10:00:00Z");

  it("gives free users the full budget on a fresh day", () => {
    expect(aiRemaining({ tier: "free", aiDay: null, aiCount: 0 }, now)).toBe(FREE_AI_PER_DAY);
    // Yesterday's meter is stale — it doesn't carry over.
    expect(aiRemaining({ tier: "free", aiDay: "2026-07-10", aiCount: 4 }, now)).toBe(FREE_AI_PER_DAY);
  });

  it("counts down today's uses and floors at zero", () => {
    expect(aiRemaining({ tier: "free", aiDay: "2026-07-11", aiCount: FREE_AI_PER_DAY - 1 }, now)).toBe(1);
    expect(aiRemaining({ tier: "free", aiDay: "2026-07-11", aiCount: FREE_AI_PER_DAY }, now)).toBe(0);
    expect(aiRemaining({ tier: "free", aiDay: "2026-07-11", aiCount: 9 }, now)).toBe(0);
  });

  it("is unlimited (null) for pro", () => {
    expect(aiRemaining({ tier: "pro", aiDay: "2026-07-11", aiCount: 99 }, now)).toBeNull();
    expect(isPro({ tier: "pro" })).toBe(true);
    expect(isPro({ tier: "free" })).toBe(false);
    expect(isPro(null)).toBe(false);
  });
});

describe("scansRemaining", () => {
  const now = new Date("2026-07-11T10:00:00Z");

  it("gives free users the day's scans, and pro unlimited", () => {
    expect(scansRemaining({ tier: "free", scanDay: null, scanCount: 0 }, now)).toBe(FREE_SCANS_PER_DAY);
    expect(scansRemaining({ tier: "free", scanDay: "2026-07-10", scanCount: 1 }, now)).toBe(FREE_SCANS_PER_DAY);
    expect(scansRemaining({ tier: "free", scanDay: "2026-07-11", scanCount: FREE_SCANS_PER_DAY - 1 }, now)).toBe(1);
    expect(scansRemaining({ tier: "free", scanDay: "2026-07-11", scanCount: FREE_SCANS_PER_DAY }, now)).toBe(0);
    expect(scansRemaining({ tier: "pro", scanDay: "2026-07-11", scanCount: 9 }, now)).toBeNull();
  });
});

describe("isLimitMessage", () => {
  it("knows the three limit messages", () => {
    for (const m of [AI_LIMIT_MSG, PRACTICE_LIMIT_MSG, SCAN_LIMIT_MSG]) expect(isLimitMessage(m)).toBe(true);
  });

  // A page loaded before a deploy that changed the numbers gets the server's
  // new wording, and must still offer the way to Pro.
  it("knows them with other numbers too", () => {
    expect(isLimitMessage("You've used today's free coach question. It's back at midnight UTC. Spellpool Pro has no daily limit.")).toBe(true);
    expect(isLimitMessage("You've used today's 5 free deck scans. They're back at midnight UTC. Spellpool Pro makes scans unlimited.")).toBe(true);
    expect(isLimitMessage("You've played today's 3 free practice matches. They're back at midnight UTC. Spellpool Pro makes them unlimited.")).toBe(true);
  });

  it("leaves other errors alone", () => {
    expect(isLimitMessage("The coach is unavailable right now.")).toBe(false);
    expect(isLimitMessage("")).toBe(false);
    expect(isLimitMessage(null)).toBe(false);
  });
});
