import { describe, expect, it } from "vitest";
import { hypergeometric, hypergeometricAtLeast, shuffled } from "./probability";

describe("hypergeometric", () => {
  it("matches a known small case", () => {
    // Urn: 10 items, 4 successes, draw 3, exactly 2 successes:
    // C(4,2)*C(6,1)/C(10,3) = 6*6/120 = 0.3
    expect(hypergeometric(10, 4, 3, 2)).toBeCloseTo(0.3, 10);
  });

  it("sums to 1 over all k", () => {
    let total = 0;
    for (let k = 0; k <= 7; k++) total += hypergeometric(99, 36, 7, k);
    expect(total).toBeCloseTo(1, 10);
  });

  it("returns 0 for impossible draws", () => {
    expect(hypergeometric(10, 4, 3, 5)).toBe(0); // more successes than drawn
    expect(hypergeometric(10, 4, 8, 0)).toBe(0); // can't avoid all successes
  });

  it("handles deck-sized inputs without overflow", () => {
    const p = hypergeometric(99, 36, 7, 3);
    expect(p).toBeGreaterThan(0.2);
    expect(p).toBeLessThan(0.4);
  });
});

describe("hypergeometricAtLeast", () => {
  it("complements the exact distribution", () => {
    const atLeast2 = hypergeometricAtLeast(10, 4, 3, 2);
    const exact = hypergeometric(10, 4, 3, 2) + hypergeometric(10, 4, 3, 3);
    expect(atLeast2).toBeCloseTo(exact, 10);
  });

  it("is 1 when k = 0", () => {
    expect(hypergeometricAtLeast(99, 36, 7, 0)).toBeCloseTo(1, 10);
  });
});

describe("shuffled", () => {
  it("preserves the multiset and does not mutate", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffled(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
