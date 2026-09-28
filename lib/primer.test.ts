import { describe, expect, it } from "vitest";
import { primerPrompt } from "./primer";

const deck = {
  name: "Krenko goblins",
  format: "commander",
  commander: "Krenko, Mob Boss",
  cards: [
    { name: "Krenko, Mob Boss", quantity: 1, manaCost: "{2}{R}{R}", typeLine: "Legendary Creature — Goblin Warrior", oracleText: "{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.", role: null },
    { name: "Mountain", quantity: 30, manaCost: null, typeLine: "Basic Land — Mountain", oracleText: "", role: "land" },
  ],
  combos: [{ id: "1", pieces: ["Krenko, Mob Boss", "Thornbite Staff"], produces: ["Infinite goblins"], manaNeeded: "", steps: "" }],
  scan: null,
  current: null,
  ask: "",
};

describe("primerPrompt", () => {
  it("carries the deck, its cards with their text, and its combos", () => {
    const p = primerPrompt(deck);
    expect(p).toContain("DECK: Krenko goblins · commander · commander Krenko, Mob Boss · 31 cards");
    expect(p).toContain("30x Mountain");
    expect(p).toContain(":: {T}: Create X 1/1 red Goblin");
    expect(p).toContain("Krenko, Mob Boss + Thornbite Staff → Infinite goblins");
  });
  it("keeps the current primer and the player's ask when there are some", () => {
    const p = primerPrompt({ ...deck, current: "## Plan\nGo wide.", ask: "shorter" });
    expect(p).toContain("THE PRIMER IT HAS NOW");
    expect(p).toContain("Go wide.");
    expect(p).toContain("THE PLAYER ASKS: shorter");
  });
  it("trims long rules text", () => {
    const long = { ...deck, cards: [{ ...deck.cards[0], oracleText: "x".repeat(500) }] };
    expect(primerPrompt(long)).toContain("x".repeat(220) + "…");
  });
});
