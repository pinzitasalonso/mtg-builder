import { describe, expect, it } from "vitest";
import { ownedNameSet } from "./collection-client";
import { buildCollectionBlock, parseCollection } from "./research";

describe("ownedNameSet", () => {
  it("lowercases names for case-insensitive lookup", () => {
    const set = ownedNameSet([
      { name: "Sol Ring", quantity: 1 },
      { name: "LIGHTNING BOLT", quantity: 4 },
    ]);
    expect(set.has("sol ring")).toBe(true);
    expect(set.has("lightning bolt")).toBe(true);
    expect(set.has("counterspell")).toBe(false);
  });
});

describe("parseCollection", () => {
  it("keeps non-empty trimmed strings and drops junk", () => {
    expect(parseCollection(["Sol Ring", "  Mana Crypt ", "", 5, null])).toEqual([
      "Sol Ring",
      "Mana Crypt",
    ]);
  });

  it("returns an empty list for non-arrays", () => {
    expect(parseCollection(undefined)).toEqual([]);
    expect(parseCollection("Sol Ring")).toEqual([]);
  });
});

describe("buildCollectionBlock", () => {
  it("is empty when nothing is owned", () => {
    expect(buildCollectionBlock([])).toBe("");
  });

  it("lists owned cards and tells the model they're owned", () => {
    const block = buildCollectionBlock(["Sol Ring", "Mana Crypt"]);
    expect(block).toContain("OWNS");
    expect(block).toContain("Sol Ring");
    expect(block).toContain("Mana Crypt");
    expect(block).toContain("2 owned");
  });
});
