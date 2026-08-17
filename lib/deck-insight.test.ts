import { describe, expect, it } from "vitest";
import {
  BRACKET_NUMBER,
  countGameChangers,
  cubeBuckets,
  nameKey,
  suggestedBracket,
  type InsightCard,
} from "./deck-insight";

const card = (over: Partial<InsightCard> = {}): InsightCard => ({
  name: "Sol Ring",
  typeLine: "Artifact",
  role: null,
  quantity: 1,
  board: "deck",
  ...over,
});

describe("suggestedBracket", () => {
  // Ported from CommanderBracket.suggested — these are the Swift thresholds,
  // and this test is what makes a divergence a failure rather than a bug
  // report about the two apps disagreeing on one deck.
  it("matches the iOS ladder", () => {
    expect(suggestedBracket(0)).toBe("core");
    expect(suggestedBracket(1)).toBe("upgraded");
    expect(suggestedBracket(3)).toBe("upgraded");
    expect(suggestedBracket(4)).toBe("optimized");
    expect(suggestedBracket(12)).toBe("optimized");
  });

  it("counts a two-card combo as an upgrade on its own", () => {
    expect(suggestedBracket(0, true)).toBe("upgraded");
    // ...but never outranks the game-changer count.
    expect(suggestedBracket(4, true)).toBe("optimized");
  });

  // Exhibition and cEDH are declarations about how you intend to play. No count
  // of cards establishes either, so nothing here may return them.
  it("never infers a self-declared bracket", () => {
    for (let n = 0; n <= 20; n++) {
      for (const combo of [false, true]) {
        const b = suggestedBracket(n, combo);
        expect(b).not.toBe("exhibition");
        expect(b).not.toBe("cedh");
      }
    }
    expect(BRACKET_NUMBER.core).toBe(2);
  });
});

describe("countGameChangers", () => {
  const keys = new Set([nameKey("Rhystic Study"), nameKey("Mana Crypt")]);

  it("counts distinct decklist cards only", () => {
    const cards = [
      card({ name: "Rhystic Study" }),
      card({ name: "Mana Crypt" }),
      card({ name: "Llanowar Elves" }),
    ];
    expect(countGameChangers(cards, keys)).toBe(2);
  });

  // A Game Changer you are CONSIDERING is not one you are playing.
  it("ignores the pool", () => {
    expect(countGameChangers([card({ name: "Rhystic Study", board: "pool" })], keys)).toBe(0);
  });

  it("keys case- and space-insensitively", () => {
    expect(countGameChangers([card({ name: "  rhystic   STUDY " })], keys)).toBe(1);
  });

  it("is zero when the list hasn't loaded", () => {
    expect(countGameChangers([card({ name: "Rhystic Study" })], new Set())).toBe(0);
  });
});

describe("cubeBuckets", () => {
  const by = (bs: ReturnType<typeof cubeBuckets>, id: string) => bs.find((b) => b.id === id)!;

  it("splits lands from spells by role or type line", () => {
    const bs = cubeBuckets([
      card({ name: "Mountain", typeLine: "Basic Land — Mountain", quantity: 12 }),
      card({ name: "Ancient Tomb", typeLine: "Land", role: "land" }),
      // Tagged a land despite an artifact type line — the tag wins.
      card({ name: "Odd One", typeLine: "Artifact", role: "land" }),
      card({ name: "Sol Ring", typeLine: "Artifact", role: "ramp" }),
    ]);
    expect(by(bs, "lands").count).toBe(14); // 12 + 1 + 1
    expect(by(bs, "spells").count).toBe(1);
  });

  it("counts copies rather than rows", () => {
    const bs = cubeBuckets([card({ name: "Mountain", typeLine: "Basic Land — Mountain", quantity: 35 })]);
    expect(by(bs, "lands").count).toBe(35);
  });

  it("counts the three tagged core roles for real", () => {
    const bs = cubeBuckets([
      card({ name: "Sol Ring", role: "ramp" }),
      card({ name: "Arcane Signet", role: "ramp" }),
      card({ name: "Rhystic Study", role: "draw" }),
      card({ name: "Swords to Plowshares", role: "removal" }),
    ]);
    expect(by(bs, "ramp").count).toBe(2);
    expect(by(bs, "draw").count).toBe(1);
    expect(by(bs, "removal").count).toBe(1);
  });

  // The other five categories are the deckbuilder's own and nothing here can
  // name them, so untagged and non-core cards stay one bucket.
  it("keeps everything else together, untagged included", () => {
    const bs = cubeBuckets([
      card({ name: "Wincon", role: "wincon" }),
      card({ name: "Utility Thing", role: "utility" }),
      card({ name: "Untagged Thing", role: null }),
      card({ name: "Sol Ring", role: "ramp" }),
    ]);
    expect(by(bs, "rest").count).toBe(3);
    expect(by(bs, "rest").entries.map((e) => e.name)).toEqual([
      "Untagged Thing",
      "Utility Thing",
      "Wincon",
    ]);
  });

  it("ignores the pool and survives an empty deck", () => {
    expect(by(cubeBuckets([card({ board: "pool" })]), "spells").count).toBe(0);
    expect(cubeBuckets([]).every((b) => b.count === 0)).toBe(true);
    // The shape's targets are still reported, so an empty deck reads as
    // "0 of 35" rather than as no shape at all.
    expect(by(cubeBuckets([]), "lands").target).toBe(35);
  });
});

// The art lookup lives in components/mtg.tsx, but the RULE it encodes is the
// same "+"-joined commander field the rest of this file reasons about, so the
// two shouldn't drift. Duplicated as a pure function rather than importing a
// .tsx component into a node test.
describe("commander art name", () => {
  const artName = (commander?: string | null): string | undefined => {
    const first = (commander ?? "").split("+")[0].trim();
    return first || undefined;
  };

  // A pair is one field. Asked for whole, Scryfall 404s and the deck loses the
  // art it should have had.
  it("takes the first commander of a partner pair", () => {
    expect(artName("Rograkh, Son of Rohgahh + Silas Renn, Seeker Adept")).toBe("Rograkh, Son of Rohgahh");
    expect(artName("Krenko, Mob Boss")).toBe("Krenko, Mob Boss");
  });

  // No commander means no art to find. Call sites used to fall back to the
  // DECK's name, so a Standard deck called "Jeskai Control" was looked up as a
  // card — a guaranteed 404 for every such deck, on every page load.
  it("returns nothing when there is no commander", () => {
    expect(artName(null)).toBeUndefined();
    expect(artName(undefined)).toBeUndefined();
    expect(artName("")).toBeUndefined();
    expect(artName("   ")).toBeUndefined();
    expect(artName(" + ")).toBeUndefined();
  });
});
