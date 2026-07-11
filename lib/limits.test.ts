import { describe, expect, it } from "vitest";
import { FREE_AI_PER_DAY, aiRemaining, isPro, utcDay } from "./limits";

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
    expect(aiRemaining({ tier: "free", aiDay: "2026-07-11", aiCount: 3 }, now)).toBe(1);
    expect(aiRemaining({ tier: "free", aiDay: "2026-07-11", aiCount: 9 }, now)).toBe(0);
  });

  it("is unlimited (null) for pro", () => {
    expect(aiRemaining({ tier: "pro", aiDay: "2026-07-11", aiCount: 99 }, now)).toBeNull();
    expect(isPro({ tier: "pro" })).toBe(true);
    expect(isPro({ tier: "free" })).toBe(false);
    expect(isPro(null)).toBe(false);
  });
});
