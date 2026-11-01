import { afterEach, describe, expect, it, vi } from "vitest";
import { edhrecSlug, fetchAverageDeck, parseAverageDeck } from "./edhrec";

describe("edhrecSlug", () => {
  it("names a commander's page as EDHREC does", () => {
    expect(edhrecSlug("Atraxa, Praetors' Voice")).toBe("atraxa-praetors-voice");
    expect(edhrecSlug("K'rrik, Son of Yawgmoth")).toBe("krrik-son-of-yawgmoth");
    expect(edhrecSlug("Lim-Dûl the Necromancer")).toBe("lim-dul-the-necromancer");
    expect(edhrecSlug("Esika, God of the Tree // The Prismatic Bridge")).toBe("esika-god-of-the-tree");
  });
  it("puts partners in alphabetical order", () => {
    expect(edhrecSlug("Tymna the Weaver + Kraum, Ludevic's Opus")).toBe("kraum-ludevics-opus-tymna-the-weaver");
  });
});

const page = (cards: Record<string, [string, number][]>, extra: object = {}) => ({
  deck: { commander: ["K'rrik, Son of Yawgmoth"], cards },
  bracket_counts: { "2": 38, "3": 13, "5": 0, x: 4 },
  container: { json_dict: { card: { num_decks: 303 } } },
  ...extra,
});
const fullDeck = { Land: [["Swamp", 24] as [string, number], ["Cabal Coffers", 1] as [string, number]], Creature: Array.from({ length: 74 }, (_, i) => [`Card ${i}`, 1] as [string, number]) };

describe("parseAverageDeck", () => {
  it("reads the commander, the 99, the deck count and the brackets", () => {
    const d = parseAverageDeck(page(fullDeck))!;
    expect(d.commanders).toEqual(["K'rrik, Son of Yawgmoth"]);
    expect(d.cards.reduce((n, c) => n + c.quantity, 0)).toBe(99);
    expect(d.cards[0]).toEqual({ name: "Swamp", quantity: 24 });
    expect(d.decks).toBe(303);
    expect(d.bracketCounts).toEqual({ 2: 38, 3: 13 });
  });
  it("has no deck for an empty bracket or a broken page", () => {
    expect(parseAverageDeck(page({}))).toBeNull();
    expect(parseAverageDeck(page(fullDeck, { deck: { commander: [], cards: fullDeck } }))).toBeNull();
    expect(parseAverageDeck(null)).toBeNull();
    expect(parseAverageDeck({ deck: { commander: "x", cards: "y" } })).toBeNull();
  });
});

describe("fetchAverageDeck", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("asks for the bracket's page, and remembers a missing one", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith("/cedh.json") ? new Response("no", { status: 403 }) : Response.json(page(fullDeck))
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAverageDeck("Test Commander Alpha", "cedh")).toBeNull();
    expect(await fetchAverageDeck("Test Commander Alpha", "cedh")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://json.edhrec.com/pages/average-decks/test-commander-alpha/cedh.json");
    const d = await fetchAverageDeck("Test Commander Alpha");
    expect(d?.decks).toBe(303);
    expect(fetchMock.mock.calls[1]![0]).toBe("https://json.edhrec.com/pages/average-decks/test-commander-alpha.json");
  });
});
