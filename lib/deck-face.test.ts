import { describe, expect, it } from "vitest";
import { deckFace } from "./deck-face";

const card = (name: string, typeLine: string, manaCost: string | null = null, board = "deck") => ({ name, typeLine, manaCost, board, imageUri: `https://cards.scryfall.io/normal/front/a/b/${name}.jpg` });

describe("deckFace", () => {
  const list = [
    card("Annul", "Instant", "{U}"),
    card("Island", "Basic Land — Island"),
    card("Dream Beavers", "Creature — Beaver", "{2}{U}"),
    card("Kaito, Bane of Nightmares", "Legendary Planeswalker — Kaito", "{2}{U}{B}"),
    card("The Ooze", "Legendary Artifact", "{2}"),
    card("Sheoldred", "Legendary Creature — Phyrexian Praetor", "{2}{B}{B}", "pool"),
  ];

  it("is the commander when the deck names one and holds it", () => {
    expect(deckFace("Dream Beavers", list)?.name).toBe("Dream Beavers");
    expect(deckFace("Dream Beavers + Annul", list)?.name).toBe("Dream Beavers");
    // Named, but not among the cards: nothing stored to show.
    expect(deckFace("Atraxa, Praetors' Voice", list)).toBeNull();
  });

  it("without a commander, is a legendary creature or planeswalker of the decklist", () => {
    // Not the pool's Sheoldred, not the land, not the cheap instant.
    expect(deckFace(null, list)?.name).toBe("Kaito, Bane of Nightmares");
  });

  it("then a creature, then the dearest spell, whatever order the cards come in", () => {
    const plain = [card("Shoot the Sheriff", "Instant", "{1}{B}"), card("Deep-Cavern Bat", "Creature — Bat", "{1}{B}"), card("Enduring Curiosity", "Enchantment Creature — Cat Glimmer", "{2}{U}{U}")];
    expect(deckFace("", plain)?.name).toBe("Enduring Curiosity");
    expect(deckFace("", [...plain].reverse())?.name).toBe("Enduring Curiosity");
    expect(deckFace("", [card("Annul", "Instant", "{U}"), card("Go for the Throat", "Instant", "{1}{B}")])?.name).toBe("Go for the Throat");
  });

  it("is nothing for a deck of lands, or none at all", () => {
    expect(deckFace(null, [card("Island", "Basic Land — Island")])).toBeNull();
    expect(deckFace(null, [])).toBeNull();
  });
});
