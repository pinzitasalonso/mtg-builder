import { describe, expect, it } from "vitest";
import { isRealBrew, pickPublicBrews, type BrewCandidate } from "./public-brews";

const ART = "https://cards.scryfall.io/normal/front/a/b/x.jpg";
let n = 0;
function brew(o: Partial<BrewCandidate> = {}): BrewCandidate {
  n += 1;
  return {
    name: `Brew ${String.fromCharCode(64 + (n % 26) + 1)}x`,
    format: "commander",
    commander: "Toph, the First Metalbender",
    cover: ART,
    deckCount: 100,
    score: null,
    createdAt: new Date(2026, 9, n),
    ...o,
  };
}

describe("isRealBrew", () => {
  it("takes a finished commander deck", () => {
    expect(isRealBrew(brew({ name: "Toph Oppression" }))).toBe(true);
    expect(isRealBrew(brew({ name: "assassins", deckCount: 107 }))).toBe(true);
    expect(isRealBrew(brew({ name: "a fine list", deckCount: 96 }))).toBe(true);
  });

  it("leaves out a stub, an overflowing pile, and a commander deck without its commander", () => {
    expect(isRealBrew(brew({ name: "Kwia", deckCount: 1 }))).toBe(false);
    expect(isRealBrew(brew({ name: "Grix", deckCount: 37 }))).toBe(false);
    expect(isRealBrew(brew({ name: "Yes", deckCount: 1715 }))).toBe(false);
    expect(isRealBrew(brew({ name: "aloy", commander: null }))).toBe(false);
    expect(isRealBrew(brew({ name: "Yawgfather", cover: null }))).toBe(false);
  });

  it("leaves out throwaway names", () => {
    for (const name of ["?", "a", "Test Doran", "Test Pool", "Kai deck 1", "  "]) {
      expect(isRealBrew(brew({ name }))).toBe(false);
    }
  });

  it("judges a 60-card format by its own size, with no commander needed", () => {
    expect(isRealBrew(brew({ name: "strixhaven gb", format: "legacy", commander: null, cover: null, deckCount: 60 }))).toBe(true);
    expect(isRealBrew(brew({ name: "Life gain go brrr", format: "modern", commander: null, cover: null, deckCount: 1 }))).toBe(false);
  });
});

describe("pickPublicBrews", () => {
  it("puts scanned decks first by Deck Score, then the newest", () => {
    const old = brew({ name: "Old", createdAt: new Date(2026, 8, 1) });
    const fresh = brew({ name: "Fresh", createdAt: new Date(2026, 9, 20) });
    const good = brew({ name: "Good", score: 4.81, createdAt: new Date(2026, 8, 2) });
    const better = brew({ name: "Better", score: 5.19, createdAt: new Date(2026, 8, 3) });
    expect(pickPublicBrews([old, fresh, good, better]).map((d) => d.name)).toEqual(["Better", "Good", "Fresh", "Old"]);
  });

  it("shows one copy of the same deck, and at most the limit", () => {
    const copies = [brew({ name: "Kwia" }), brew({ name: "kwia " })];
    expect(pickPublicBrews(copies)).toHaveLength(1);
    const many = Array.from({ length: 20 }, (_, i) => brew({ name: `Brew number ${i}x` }));
    expect(pickPublicBrews(many, 12)).toHaveLength(12);
  });
});
