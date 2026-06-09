import { describe, expect, it } from "vitest";
import { mapPool } from "./async";

describe("mapPool", () => {
  it("preserves input order in the output", async () => {
    const out = await mapPool([3, 1, 2], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n * 10));
      return n * 10;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it("never runs more than `limit` tasks at once", async () => {
    let running = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("handles an empty input", async () => {
    expect(await mapPool([], 4, async (x) => x)).toEqual([]);
  });

  it("handles limit larger than the input", async () => {
    expect(await mapPool([1, 2], 99, async (x) => x + 1)).toEqual([2, 3]);
  });
});
