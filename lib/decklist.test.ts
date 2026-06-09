import { describe, expect, it } from "vitest";
import { parseDecklist } from "./decklist";

describe("parseDecklist", () => {
  it("parses '{qty} {name}' lines", () => {
    expect(parseDecklist("3 Plains\n1 Sol Ring")).toEqual([
      { name: "Plains", qty: 3 },
      { name: "Sol Ring", qty: 1 },
    ]);
  });

  it("defaults bare names to qty 1", () => {
    expect(parseDecklist("Lightning Bolt")).toEqual([{ name: "Lightning Bolt", qty: 1 }]);
  });

  it("accepts the '4x Name' variant", () => {
    expect(parseDecklist("4x Counterspell")).toEqual([{ name: "Counterspell", qty: 4 }]);
  });

  it("strips set / collector-number suffixes", () => {
    expect(parseDecklist("1 Sol Ring (C21) 263")).toEqual([{ name: "Sol Ring", qty: 1 }]);
  });

  it("merges repeated names case-insensitively, preserving first-seen order", () => {
    expect(parseDecklist("2 plains\n1 Island\n3 Plains")).toEqual([
      { name: "plains", qty: 5 },
      { name: "Island", qty: 1 },
    ]);
  });

  it("skips blank lines and whitespace", () => {
    expect(parseDecklist("\n  \n1 Plains\n\n")).toEqual([{ name: "Plains", qty: 1 }]);
  });

  it("returns [] for empty input", () => {
    expect(parseDecklist("")).toEqual([]);
  });

  it("skips comments and section headers", () => {
    expect(parseDecklist("// Pool\n# note\nSIDEBOARD:\n1 Plains")).toEqual([{ name: "Plains", qty: 1 }]);
  });

  it("keeps card names that start with a number-like word intact", () => {
    // No leading count — the whole line is the name.
    expect(parseDecklist("Door to Nothingness")).toEqual([{ name: "Door to Nothingness", qty: 1 }]);
  });
});
