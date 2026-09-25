import { describe, expect, it } from "vitest";
import { canBeCommander, fitsIdentity, isBackground } from "./format";

describe("canBeCommander", () => {
  it("takes legendary creatures, and cards that say so", () => {
    expect(canBeCommander("Legendary Creature — Goblin Warrior")).toBe(true);
    expect(canBeCommander("Legendary Planeswalker — Teferi", "Teferi, Temporal Archmage can be your commander.")).toBe(true);
    expect(canBeCommander("Legendary Creature — Human Wizard // Legendary Planeswalker — Jace")).toBe(true);
  });
  it("refuses a non-legendary creature, and non-creature legends", () => {
    expect(canBeCommander("Creature — Avatar")).toBe(false); // Avatar of Burgeoning Echoes
    expect(canBeCommander("Legendary Artifact")).toBe(false);
    expect(canBeCommander("Legendary Enchantment — Background")).toBe(false);
    expect(isBackground("Legendary Enchantment — Background")).toBe(true);
  });
});

describe("fitsIdentity", () => {
  it("checks every colour of the card against the commander's", () => {
    expect(fitsIdentity("UB", "UBR")).toBe(true);
    expect(fitsIdentity("G", "UB")).toBe(false);
    expect(fitsIdentity("", "R")).toBe(true);
    expect(fitsIdentity(null, "R")).toBe(true);
  });
});
