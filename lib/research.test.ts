import { describe, expect, it } from "vitest";
import { buildCollectionFirstBlock, isCollectionBuild, parseCollection } from "./research";

// Skipping research is a latency win on one flow and a quality regression on
// every other, so these pin the decision against the payload shape each real
// caller sends rather than against an abstraction of it.
describe("isCollectionBuild", () => {
  it("matches the iOS suggest-a-deck flow, which omits currentDeck entirely", () => {
    // NewDeckView sends `currentDeck: nil`; JSONEncoder drops the key.
    expect(isCollectionBuild(undefined, ["Sol Ring", "Llanowar Elves"])).toBe(true);
    // A client that serialises the nil explicitly must behave identically.
    expect(isCollectionBuild(null, ["Sol Ring"])).toBe(true);
  });

  it("does NOT match the deck assistant on a brand-new empty deck", () => {
    // The regression this guards: AskAIView always sends the object, so an
    // empty deck must still get research. Testing emptiness would break this.
    const emptyDeck = { commander: null, cards: [] };
    expect(isCollectionBuild(emptyDeck, ["Sol Ring", "Counterspell"])).toBe(false);
  });

  it("does NOT match the deck assistant on a populated deck", () => {
    const deck = { commander: "Drana, Liberator of Malakir", cards: [{ name: "Sol Ring", quantity: 1 }] };
    expect(isCollectionBuild(deck, ["Sol Ring"])).toBe(false);
  });

  it("does NOT match a build with no collection to lean on", () => {
    // The "describe it" door with use == .free sends an empty array. There's
    // nothing to ground the answer in, so research still earns its latency.
    expect(isCollectionBuild(undefined, [])).toBe(false);
    expect(isCollectionBuild(null, [])).toBe(false);
  });

  it("treats a collection that parses to nothing as no collection", () => {
    // Junk in the array must not flip the decision on its own.
    expect(isCollectionBuild(undefined, parseCollection(["", "   "]))).toBe(false);
    expect(isCollectionBuild(undefined, parseCollection(["  Sol Ring  "]))).toBe(true);
  });
});

describe("buildCollectionFirstBlock", () => {
  it("frames the skip as deliberate, not as a retrieval failure", () => {
    const block = buildCollectionFirstBlock();
    // "could be retrieved" is the failure wording; a chosen skip must not
    // borrow it, or the model reads its grounding as degraded and hedges.
    expect(block).not.toContain("could be retrieved");
    expect(block).toContain("player's own collection");
  });
});
