import { describe, it, expect } from "vitest";
import { classify, type ScoredCard } from "./deck-score-classify";
import { goldfish, toSimCard } from "./goldfish";

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

  it("reads a token engine with a haste lord as a real clock", () => {
    const deck: ScoredCard[] = [
      ...lands(34),
      ...Array.from({ length: 40 }, (_, i) => card(`Goblin ${i}`, { typeLine: "Creature — Goblin", manaCost: "{1}{R}", manaValue: 2, power: 2 })),
      ...Array.from({ length: 4 }, (_, i) => card(`Warchief ${i}`, { typeLine: "Creature — Goblin", oracleText: "Goblins you control have haste.", manaCost: "{1}{R}{R}", manaValue: 3, power: 2 })),
      ...Array.from({ length: 21 }, (_, i) => card(`Filler ${i}`, { typeLine: "Instant", oracleText: "Counter target spell.", manaCost: "{1}{U}", manaValue: 2, power: null })),
      card("Krenko", { isCommander: true, typeLine: "Legendary Creature — Goblin", oracleText: "{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.", manaCost: "{2}{R}{R}", manaValue: 4, power: 3 }),
    ];
    const r = goldfish(classify(deck).reads, [], { hands: 120 });
    const slow = goldfish(classify(beatdown()).reads, [], { hands: 120 });
    expect(r.fundamentalTurn).toBeLessThan(slow.fundamentalTurn);
    expect(r.fundamentalTurn).toBeLessThanOrEqual(7);
  });

  it("reads a deathtouch-poison commander as a ten-counter clock", () => {
    const deck: ScoredCard[] = [
      ...lands(36),
      ...Array.from({ length: 40 }, (_, i) => card(`Snake ${i}`, { typeLine: "Creature — Snake", keywords: ["Deathtouch"], oracleText: "Deathtouch", manaCost: "{1}{G}", manaValue: 2, power: 1 })),
      ...Array.from({ length: 23 }, (_, i) => card(`Filler ${i}`, { typeLine: "Instant", oracleText: "Counter target spell.", manaCost: "{1}{U}", manaValue: 2, power: null })),
      card("Fynn", { isCommander: true, typeLine: "Legendary Creature — Human Warrior", keywords: ["Deathtouch"], oracleText: "Deathtouch\nWhenever a creature you control with deathtouch deals combat damage to a player, that player gets two poison counters.", manaCost: "{1}{G}", manaValue: 2, power: 1 }),
    ];
    const r = goldfish(classify(deck).reads, [], { hands: 120 });
    expect(r.fundamentalTurn).toBeLessThanOrEqual(6);
  });

  it("reads a repeatable mana sink as an outlet, and a mana rock as not one", () => {
    const reads = classify([
      ...lands(36),
      card("Kinnan", { isCommander: true, oracleText: "Whenever you tap a nonland permanent for mana, add one mana of any type that permanent produced.\n{5}{G}{U}: Look at the top five cards of your library. You may put a non-Human creature card from among them onto the battlefield.", manaCost: "{G}{U}", manaValue: 2 }),
      card("Walking Ballista", { typeLine: "Artifact Creature — Construct", oracleText: "This creature enters with X +1/+1 counters on it.\n{4}: Put a +1/+1 counter on this creature.\nRemove a +1/+1 counter from this creature: It deals 1 damage to any target.", manaCost: "{X}{X}", manaValue: 0, power: 0 }),
      card("Mind Stone", { typeLine: "Artifact", oracleText: "{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card.", manaCost: "{2}", manaValue: 2, power: null }),
      card("Stroke of Genius", { typeLine: "Instant", oracleText: "Target player draws X cards.", manaCost: "{X}{2}{U}", manaValue: 3, power: null }),
    ]).reads;
    const sim = Object.fromEntries(reads.map((r) => [r.card.name, toSimCard(r)]));
    expect(sim["Kinnan"]!.sink).toBe(true);
    expect(sim["Kinnan"]!.doubler).toBe("nonland");
    expect(sim["Walking Ballista"]!.sink).toBe(true);
    expect(sim["Stroke of Genius"]!.sink).toBe(true);
    expect(sim["Mind Stone"]!.sink).toBe(false);
  });

  it("refuses to goldfish a list that is not a deck", () => {
    const r = goldfish(classify([card("A"), card("B")]).reads, []);
    expect(r.hands).toBe(0);
    expect(r.fundamentalTurn).toBe(14);
  });
});
