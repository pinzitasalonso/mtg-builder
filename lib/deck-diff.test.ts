import { describe, expect, it } from "vitest";
import { diffDecklists, isEmptyDiff, type VersionCard } from "./deck-diff";

const c = (name: string, quantity: number, board: "deck" | "pool" = "deck"): VersionCard => ({ name, quantity, board });

describe("diffDecklists", () => {
  it("reports adds, removes and count changes, sorted by name", () => {
    const before = [c("Sol Ring", 1), c("Mountain", 30), c("Goblin Guide", 4), c("Shock", 2)];
    const after = [c("Sol Ring", 1), c("Mountain", 28), c("Lightning Bolt", 4), c("Shock", 2)];
    const d = diffDecklists(before, after);
    expect(d.added).toEqual([{ name: "Lightning Bolt", quantity: 4 }]);
    expect(d.removed).toEqual([{ name: "Goblin Guide", quantity: 4 }]);
    expect(d.changed).toEqual([{ name: "Mountain", from: 30, to: 28 }]);
    expect(d.unchanged).toBe(2);
    expect(isEmptyDiff(d)).toBe(false);
  });

  it("only looks at the board asked for, and matches names case-insensitively", () => {
    const before = [c("Sol Ring", 1), c("Counterspell", 1, "pool")];
    const after = [c("sol ring", 1), c("Counterspell", 1, "deck")];
    const deck = diffDecklists(before, after, "deck");
    expect(deck.added).toEqual([{ name: "Counterspell", quantity: 1 }]);
    expect(deck.unchanged).toBe(1);
    const pool = diffDecklists(before, after, "pool");
    expect(pool.removed).toEqual([{ name: "Counterspell", quantity: 1 }]);
  });

  it("merges rows that share a name before comparing", () => {
    const before = [c("Mountain", 10), c("Mountain", 10)];
    const after = [c("Mountain", 20)];
    expect(isEmptyDiff(diffDecklists(before, after))).toBe(true);
  });
});
