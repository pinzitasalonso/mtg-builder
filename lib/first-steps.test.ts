import { describe, expect, it } from "vitest";
import { FIRST_STEPS, allTried, stepsHeading } from "./first-steps";
import { FREE_AI_PER_DAY, FREE_PRACTICE_PER_DAY, FREE_SCANS_PER_DAY } from "./limits";

describe("the free plan's three daily things", () => {
  it("says how many of each a day, from the limits' own numbers", () => {
    const daily = Object.fromEntries(FIRST_STEPS.map((s) => [s.id, s.daily]));
    expect(daily.coach).toBe(`${FREE_AI_PER_DAY} question${FREE_AI_PER_DAY === 1 ? "" : "s"} a day`);
    expect(daily.match).toBe(`${FREE_PRACTICE_PER_DAY} match${FREE_PRACTICE_PER_DAY === 1 ? "" : "es"} a day`);
    expect(daily.score).toBe(`${FREE_SCANS_PER_DAY} scan${FREE_SCANS_PER_DAY === 1 ? "" : "s"} a day`);
  });

  // What people read never says "AI" or "bot": the coach, a smart opponent.
  it("is worded the way the rest of the app is", () => {
    for (const s of FIRST_STEPS) expect(`${s.title} ${s.text} ${s.daily}`).not.toMatch(/\bAI\b|\bbot\b/i);
    expect(stepsHeading()).not.toMatch(/\bAI\b|\bbot\b/i);
  });

  it("heads the block with how often, when the three limits agree", () => {
    expect(stepsHeading([2, 2, 2])).toBe("Three things to try, twice a day each.");
    expect(stepsHeading([1, 1, 1])).toBe("Three things to try, once a day each.");
    expect(stepsHeading([3, 3, 3])).toBe("Three things to try, 3 times a day each.");
    expect(stepsHeading([2, 3, 2])).toBe("Three things to try, free every day.");
  });

  it("is done once all three are tried", () => {
    expect(allTried({ coach: true, match: true, score: true })).toBe(true);
    expect(allTried({ coach: true, match: false, score: true })).toBe(false);
  });
});
