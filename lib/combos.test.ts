import { describe, expect, it } from "vitest";
import { normalizeCombos } from "./combos";

const combo = (pieces: string[], over: Record<string, unknown> = {}) => ({
  id: pieces.join("-"),
  uses: pieces.map((name) => ({ card: { name } })),
  produces: [{ feature: { name: "Win the game" } }],
  description: "Do the thing.\nThen win.",
  manaNeeded: "{U}{B}",
  ...over,
});

describe("normalizeCombos", () => {
  it("reads pieces, payoff, cost and steps", () => {
    const { combos } = normalizeCombos({
      results: { included: [combo(["Thassa's Oracle", "Demonic Consultation"])] },
    });
    expect(combos).toHaveLength(1);
    expect(combos[0].pieces).toEqual(["Thassa's Oracle", "Demonic Consultation"]);
    expect(combos[0].produces).toEqual(["Win the game"]);
    expect(combos[0].manaNeeded).toBe("{U}{B}");
    expect(combos[0].steps).toContain("Then win.");
  });

  // Brackets 1 and 2 allow no two-card infinite combo at all, so this flag
  // moves a deck to at least 3 on its own — it is a rule, not a curiosity.
  it("flags a two-card combo", () => {
    expect(normalizeCombos({ results: { included: [combo(["A", "B"])] } }).hasTwoCardCombo).toBe(true);
    expect(normalizeCombos({ results: { included: [combo(["A", "B", "C"])] } }).hasTwoCardCombo).toBe(false);
    // Any two-card line among several is enough.
    expect(
      normalizeCombos({ results: { included: [combo(["A", "B", "C"]), combo(["D", "E"])] } }).hasTwoCardCombo
    ).toBe(true);
  });

  it("drops a combo with no named pieces rather than showing a blank row", () => {
    const { combos } = normalizeCombos({
      results: { included: [combo([]), { id: 9, uses: [{ card: {} }] }, combo(["A", "B"])] },
    });
    expect(combos).toHaveLength(1);
  });

  it("fills in for the fields Spellbook may omit", () => {
    const { combos } = normalizeCombos({
      results: { included: [{ id: 3, uses: [{ card: { name: "Sol Ring" } }] }] },
    });
    expect(combos[0].produces).toEqual([]);
    expect(combos[0].manaNeeded).toBe("");
    expect(combos[0].steps).toBe("");
  });

  // Every failure path lands here, and an empty list is also what a deck with
  // no combos looks like — so this must never throw.
  it("survives a shape it did not expect", () => {
    for (const body of [null, undefined, {}, { results: {} }, { results: { included: "nope" } }]) {
      expect(normalizeCombos(body)).toEqual({ combos: [], hasTwoCardCombo: false });
    }
  });
});
