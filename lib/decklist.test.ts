import { describe, expect, it } from "vitest";
import { parseDecklist, parseDecklistBoards } from "./decklist";

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

  it("strips set / collector-number suffixes, keeping them as the printing", () => {
    expect(parseDecklist("1 Sol Ring (C21) 263")).toEqual([{ name: "Sol Ring", qty: 1, printing: { set: "c21", number: "263" } }]);
    // A set code with no number isn't a printing that can be looked up.
    expect(parseDecklist("1 Sol Ring (C21)")).toEqual([{ name: "Sol Ring", qty: 1 }]);
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
  it("strips bracketed set codes and tags, foil markers and MTGO's SB: prefix", () => {
    expect(parseDecklist("1 Sol Ring [CMR]\n1x Arcane Signet (CMR) 297 *F*\n1 Swords to Plowshares *F*\n1 Cultivate [Ramp]\nSB: 2 Duress")).toEqual([
      { name: "Sol Ring", qty: 1 },
      { name: "Arcane Signet", qty: 1, printing: { set: "cmr", number: "297" } },
      { name: "Swords to Plowshares", qty: 1 },
      { name: "Cultivate", qty: 1 },
      { name: "Duress", qty: 2 },
    ]);
  });
});

describe("parseDecklistBoards", () => {
  it("reads a Moxfield-style export: headings are sections, not cards", () => {
    const { deck, pool } = parseDecklistBoards("Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Sol Ring\n30 Mountain\n\nSideboard\n1 Goblin King\n\nMaybeboard (2)\n1 Skullclamp\n1 Shock");
    expect(deck.map((e) => e.name)).toEqual(["Krenko, Mob Boss", "Sol Ring", "Mountain"]);
    expect(pool.map((e) => e.name)).toEqual(["Goblin King", "Skullclamp", "Shock"]);
  });
  it("reads Spellpool's own export: the pool after // Pool", () => {
    const { deck, pool } = parseDecklistBoards("1 Sol Ring\n1 Arcane Signet\n\n// Pool\n1 Mind Stone");
    expect(deck.map((e) => e.name)).toEqual(["Sol Ring", "Arcane Signet"]);
    expect(pool.map((e) => e.name)).toEqual(["Mind Stone"]);
  });
  it("puts MTGO's SB: lines in the pool", () => {
    const { deck, pool } = parseDecklistBoards("4 Lightning Bolt\nSB: 2 Duress");
    expect(deck).toEqual([{ name: "Lightning Bolt", qty: 4 }]);
    expect(pool).toEqual([{ name: "Duress", qty: 2 }]);
  });
  it("keeps one-word card names as cards", () => {
    const { deck } = parseDecklistBoards("Counterspell\nOpt\n1 Commander's Sphere");
    expect(deck.map((e) => e.name)).toEqual(["Counterspell", "Opt", "Commander's Sphere"]);
  });
});

describe("parseDecklist with headings", () => {
  it("skips section headings and merges every board", () => {
    expect(parseDecklist("Deck\n2 Island\nSideboard\n1 Island").map((e) => [e.name, e.qty])).toEqual([["Island", 3]]);
  });
});
