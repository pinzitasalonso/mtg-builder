import { describe, expect, it } from "vitest";
import { buildDecksBlock, deckRef, rewriteDeckLinks, type AssistantDeck } from "./assistant";

const deck = (over: Partial<AssistantDeck>): AssistantDeck => ({
  publicId: "abc123", name: "Kaito", format: "commander", commander: "Kaito, Bane of Nightmares",
  deck: [{ name: "Sol Ring", quantity: 1 }, { name: "Island", quantity: 30 }], pool: [], ...over,
});

describe("buildDecksBlock", () => {
  it("lists each deck with its link, format, count and cards, sorted by name", () => {
    const block = buildDecksBlock([deck({ name: "Zur", publicId: "z1", deck: [] }), deck({})]);
    expect(block.indexOf("### Kaito")).toBeLessThan(block.indexOf("### Zur"));
    expect(block).toContain("[Kaito](/deck/abc123)");
    expect(block).toContain("Commander: Kaito, Bane of Nightmares · 31/100 cards in the deck");
    expect(block).toContain("Deck: Sol Ring; 30 Island");
    expect(block).toContain("Deck: (empty)");
  });

  it("caps a long pool", () => {
    const pool = Array.from({ length: 70 }, (_, i) => ({ name: `Card ${i}`, quantity: 1 }));
    expect(buildDecksBlock([deck({ pool })])).toContain("…and 10 more");
  });
});

describe("deck links", () => {
  it("turns an in-app deck link into a deck token and strips other links to their label", () => {
    const md = "Try [Kaito](/deck/abc123) or [this](https://example.com/x) with [[Sol Ring]].";
    const out = rewriteDeckLinks(md);
    expect(out).toBe("Try [[@deck:abc123|Kaito]] or this with [[Sol Ring]].");
    expect(deckRef("@deck:abc123|Kaito")).toEqual({ id: "abc123", label: "Kaito" });
    expect(deckRef("Sol Ring")).toBeNull();
  });
});
