import { describe, expect, it } from "vitest";
import { deckDescription, formatName } from "./deck-meta-text";

describe("deck metadata", () => {
  it("describes a deck in one sentence with its colors, format and commander", () => {
    expect(
      deckDescription({ publicId: "x", name: "Kaito", format: "commander", commander: "Kaito, Bane of Nightmares", count: 100, colors: "UB", highlights: ["Rhystic Study", "Sol Ring"] })
    ).toBe(
      "A 100-card blue-black Commander deck led by Kaito, Bane of Nightmares, built on Spellpool. Featuring Rhystic Study, Sol Ring. See the list, curve, combos and Deck Score."
    );
    expect(deckDescription({ publicId: "x", name: "Affinity", format: "modern", commander: null, count: 60, colors: "", highlights: [] })).toBe(
      "A 60-card colorless Modern deck, built on Spellpool. See the list, curve, combos and Deck Score."
    );
  });
  it("names formats properly", () => {
    expect(formatName("pauper")).toBe("Pauper");
    expect(formatName("brawl")).toBe("Brawl");
  });
});

import { LANDING_FAQ } from "./landing";
describe("landing FAQ", () => {
  it("spells out the free plan's limits", () => {
    const free = LANDING_FAQ.find((f) => f.q === "Is Spellpool free?")!;
    expect(free.a).toMatch(/holds \d+ decks, with \d+ AI questions and \d+ deck scan a day/);
  });
});
