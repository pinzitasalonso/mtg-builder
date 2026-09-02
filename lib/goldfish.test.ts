import { describe, it, expect } from "vitest";
import { classify, type ScoredCard } from "./deck-score-classify";
import { goldfish } from "./goldfish";

function card(name: string, over: Partial<ScoredCard> = {}): ScoredCard {
  return {
    name, typeLine: "Creature — Beast", oracleText: "", manaCost: "{3}", manaValue: 3, quantity: 1,
    power: 3, toughness: 3, keywords: [], producedMana: [], isCommander: false, ...over,
  };
}
const forest = (i: number) => card(`Forest ${i}`, { typeLine: "Basic Land — Forest", oracleText: "({T}: Add {G}.)", manaCost: null, manaValue: 0, power: null, producedMana: ["G"] });
const lands = (n: number) => Array.from({ length: n }, (_, i) => forest(i));

/** Thirty-six lands and sixty-three three-mana 3/3s: the slowest honest deck. */
function beatdown(): ScoredCard[] {
  return [...lands(36), ...Array.from({ length: 63 }, (_, i) => card(`Bear ${i}`)), card("Boss", { isCommander: true, power: 4, manaCost: "{4}", manaValue: 4 })];
}

describe("goldfish", () => {
  it("is deterministic for the same list", () => {
    const reads = classify(beatdown()).reads;
    const a = goldfish(reads, [], { hands: 60 });
    const b = goldfish(reads, [], { hands: 60 });
    expect(a.fundamentalTurn).toBe(b.fundamentalTurn);
    expect(a.wonByTurn).toEqual(b.wonByTurn);
  });

  it("reads a pile of bears as a battlecruiser clock", () => {
    const r = goldfish(classify(beatdown()).reads, [], { hands: 120 });
    expect(r.fundamentalTurn).toBeGreaterThanOrEqual(7);
    expect(r.fundamentalTurn).toBeLessThanOrEqual(11);
    expect(r.combatWins).toBeGreaterThan(0);
    expect(r.comboWins).toBe(0);
  });

  it("reads a tutored two-card combo with fast mana as turns faster", () => {
    const deck: ScoredCard[] = [
      ...lands(32),
      card("Sol Ring", { typeLine: "Artifact", oracleText: "{T}: Add {C}{C}.", manaCost: "{1}", manaValue: 1, power: null }),
      card("Mana Crypt", { typeLine: "Artifact", oracleText: "{T}: Add {C}{C}.", manaCost: "{0}", manaValue: 0, power: null }),
      card("Thassa's Oracle", { power: 1, manaCost: "{U}{U}", manaValue: 2 }),
      card("Demonic Consultation", { typeLine: "Instant", oracleText: "Choose a card name. Exile the top six cards of your library.", manaCost: "{B}", manaValue: 1, power: null }),
      ...Array.from({ length: 14 }, (_, i) => card(`Tutor ${i}`, { typeLine: "Sorcery", oracleText: "Search your library for a card, put that card into your hand, then shuffle.", manaCost: "{B}", manaValue: 1, power: null })),
      ...Array.from({ length: 10 }, (_, i) => card(`Cantrip ${i}`, { typeLine: "Instant", oracleText: "Draw two cards.", manaCost: "{U}", manaValue: 1, power: null })),
      ...Array.from({ length: 40 }, (_, i) => card(`Filler ${i}`, { typeLine: "Instant", oracleText: "Counter target spell.", manaCost: "{1}{U}", manaValue: 2, power: null })),
    ];
    const lines = [{ pieces: ["Thassa's Oracle", "Demonic Consultation"], manaNeeded: 0, lethal: true }];
    const r = goldfish(classify(deck).reads, lines, { hands: 120 });
    expect(r.comboWins).toBeGreaterThan(r.combatWins);
    // Sixteen live cards in ninety-nine, ten cantrips: two live by turn 6 in half the hands.
    expect(r.fundamentalTurn).toBeLessThanOrEqual(7);
    const slow = goldfish(classify(beatdown()).reads, [], { hands: 120 });
    expect(r.fundamentalTurn).toBeLessThan(slow.fundamentalTurn);
  });

  it("refuses to goldfish a list that is not a deck", () => {
    const r = goldfish(classify([card("A"), card("B")]).reads, []);
    expect(r.hands).toBe(0);
    expect(r.fundamentalTurn).toBe(14);
  });
});
