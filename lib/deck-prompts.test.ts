import { describe, expect, it } from "vitest";
import { buildPrompt, formatSpec } from "./deck-prompts";

const commanderPrompt = (over = {}) =>
  buildPrompt({ format: "commander", use: "free", ...over });

describe("formatSpec", () => {
  it("knows which formats have a commander and how big a deck is", () => {
    expect(formatSpec("commander")).toEqual({ label: "Commander", usesCommander: true, deckSize: 100 });
    // Brawl is a commander format at 60 cards — the one that breaks the
    // "commander means 100" shortcut.
    expect(formatSpec("brawl")).toEqual({ label: "Brawl", usesCommander: true, deckSize: 60 });
    expect(formatSpec("modern").usesCommander).toBe(false);
  });

  it("treats anything unknown as a plain 60-card format", () => {
    expect(formatSpec("nonsense").deckSize).toBe(60);
    expect(formatSpec("nonsense").usesCommander).toBe(false);
  });
});

describe("buildPrompt", () => {
  it("always demands a bare decklist and states the size", () => {
    const p = commanderPrompt();
    expect(p).toContain("Output ONLY the decklist");
    expect(p).toContain("100-card");
    expect(p).toContain("Never number the lines themselves");
  });

  // Each of these was a bad deck someone actually got.
  it("carries the rules that were earned the hard way", () => {
    const p = commanderPrompt();
    // A deck with no mana base and 35 cards.
    expect(p).toContain("mana base");
    expect(p).toContain("[[Mountain]]");
    // A 101-card deck: two commanders leading 99 others.
    expect(p).toContain("COUNTS toward that total");
    expect(p).toContain("a partner pair leads 98");
    // Asked for RogSi, got Kess.
    expect(p).toContain("PARTNER PAIR");
    // Asked for RogSi, got Tevesh + Kraum.
    expect(p).toContain("The name IS the request");
  });

  // "[[A + B]]" resolves to nothing on Scryfall — each name needs its own
  // brackets or the commander silently fails to resolve.
  it("brackets each name of a partner pair separately", () => {
    const p = commanderPrompt({ commander: "Rograkh, Son of Rohgahh + Silas Renn, Seeker Adept" });
    expect(p).toContain("[[Rograkh, Son of Rohgahh]] + [[Silas Renn, Seeker Adept]]");
    expect(p).not.toContain("[[Rograkh, Son of Rohgahh + Silas Renn, Seeker Adept]]");
    expect(p).toContain("my commanders");
    expect(p).toContain("put them on the FIRST line");
  });

  it("uses the singular for one commander", () => {
    const p = commanderPrompt({ commander: "Krenko, Mob Boss" });
    expect(p).toContain("my commander [[Krenko, Mob Boss]]");
    expect(p).toContain("put it on the FIRST line");
    // With a commander named, it must not also be told to choose one.
    expect(p).not.toContain("First choose the best commander");
  });

  it("only asks the model to choose when no commander was given", () => {
    expect(commanderPrompt()).toContain("First choose the best commander");
    expect(commanderPrompt({ commander: "  " })).toContain("First choose the best commander");
  });

  it("excludes commanders the player already builds around", () => {
    const p = commanderPrompt({ excludedCommanders: ["Atraxa", "Krenko"] });
    expect(p).toContain("do not choose any of: Atraxa, Krenko");
    // Nothing to say when there are none.
    expect(commanderPrompt()).not.toContain("do not choose any of");
  });

  it("changes the collection rule with the setting", () => {
    expect(commanderPrompt({ use: "only" })).toContain("Never include a card I don't own");
    expect(commanderPrompt({ use: "favor" })).toContain("as many cards from my collection as possible");
    expect(commanderPrompt({ use: "free" })).toContain("doesn't constrain you here");
  });

  it("passes the player's brief through", () => {
    expect(commanderPrompt({ describe: "RogSi turbo cedh" })).toContain("What I'm after: RogSi turbo cedh");
    expect(commanderPrompt()).not.toContain("What I'm after");
  });

  // A 60-card format has 4-ofs, a sideboard rule and no commander line at all.
  it("writes a different brief for a 60-card format", () => {
    const p = buildPrompt({ format: "modern", use: "free" });
    expect(p).toContain("up to 4 copies");
    expect(p).toContain("60-card main deck");
    expect(p).toContain("No sideboard");
    expect(p).not.toContain("Commander:");
    expect(p).not.toContain("color identity");
  });

  // Brawl is a commander format, so it takes the commander rules at 60 cards.
  it("gives brawl the commander rules at its own size", () => {
    const p = buildPrompt({ format: "brawl", use: "free" });
    expect(p).toContain("Commander:");
    expect(p).toContain("60-card deck");
    expect(p).toContain("a partner pair leads 58");
  });
});
