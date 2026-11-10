import { describe, expect, it } from "vitest";
import { reviewPrompt } from "./review";
import { readSaved, type SavedGame } from "./save";
import type { PracticeGame } from "./types";

const side = (o: Record<string, unknown> = {}) => ({ library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [], life: 40, ...o });
const game = (o: Partial<PracticeGame> = {}): PracticeGame =>
  ({ turn: 5, active: "you", winner: null, commanderGame: true, cmdDamage: { you: 0, opp: 7 }, log: [], sides: { you: side(), opp: side() }, ...o }) as unknown as PracticeGame;
const NOW = 1_800_000_000_000;
const save = (o: Partial<SavedGame> = {}): string =>
  JSON.stringify({ v: 1, at: NOW - 60_000, as: "main", option: null, setup: { id: "g1", commanderGame: true, book: {}, you: { label: "Mine", cards: [], commander: null }, opp: { label: "Foe", detail: "", cards: [], commander: null } }, game: game(), ...o });

describe("a saved game", () => {
  it("is read back as it was kept", () => {
    expect(readSaved(save(), NOW)).toMatchObject({ as: "main", setup: { id: "g1" }, game: { turn: 5 } });
    expect(readSaved(save({ as: "ai" }), NOW)?.as).toBe("ai");
  });

  it("isn't offered when it's a week old, finished, or not a game", () => {
    expect(readSaved(save({ at: NOW - 8 * 24 * 60 * 60 * 1000 }), NOW)).toBeNull();
    expect(readSaved(save({ game: game({ winner: "you" }) }), NOW)).toBeNull();
    expect(readSaved(save({ v: 2 as unknown as 1 }), NOW)).toBeNull();
    expect(readSaved(save({ as: "combat" as unknown as "main" }), NOW)).toBeNull();
    for (const bad of [null, "", "not json", "{}", '{"v":1}', "[]"]) expect(readSaved(bad, NOW)).toBeNull();
  });
});

describe("the review's prompt", () => {
  const card = (name: string) => ({ iid: 1, name, imageUri: "", typeLine: null });
  const input = (g: PracticeGame, bot = false) => ({
    deckName: "Kefka Storm",
    format: "commander",
    commander: "Kefka, Court Mage",
    cards: [
      { name: "Sol Ring", quantity: 1, typeLine: "Artifact" },
      { name: "Island", quantity: 12, typeLine: "Basic Land — Island" },
    ],
    opponent: "Edgar Markov — Average deck · EDHREC",
    bot,
    game: g,
  });

  it("has the list, who won and when, the final board, and the log with who did what", () => {
    const g = game({
      winner: "opp",
      turn: 9,
      log: [
        { seat: "you", text: "You play Island." },
        { seat: "opp", text: "The opponent casts Edgar Markov." },
        { seat: null, text: "You're out of life. The opponent wins." },
      ],
      sides: { you: side({ life: 0, battlefield: [card("Sol Ring")], hand: [card("Counterspell")] }), opp: side({ life: 31, battlefield: [card("Edgar Markov")], hand: [card("Secret")] }) },
    } as unknown as Partial<PracticeGame>);
    const text = reviewPrompt(input(g));
    expect(text).toContain("THE PLAYER'S DECK: Kefka Storm (commander, commander: Kefka, Court Mage)");
    expect(text).toContain("1 Sol Ring (Artifact)\n12 Island (Basic Land)");
    expect(text).toContain("RESULT: the player LOST on turn 9. Life at the end: player 0, opponent 31. Commander damage: to the player 0, to the opponent 7.");
    expect(text).toContain("THE PLAYER AT THE END: battlefield: Sol Ring. Hand: Counterspell.");
    // The opponent's hand is a count: the review is about the player's deck.
    expect(text).toContain("THE OPPONENT AT THE END: battlefield: Edgar Markov. Cards in hand: 1.");
    expect(text).not.toContain("Secret");
    expect(text).toContain("[player] You play Island.\n[opponent] The opponent casts Edgar Markov.\nYou're out of life. The opponent wins.");
  });

  it("says when the opponent was the basic bot", () => {
    expect(reviewPrompt(input(game({ winner: "you" }), true))).toContain("played by a basic bot");
    expect(reviewPrompt(input(game({ winner: "you" }), false))).not.toContain("basic bot");
  });

  it("keeps a long game's start and end", () => {
    const log = Array.from({ length: 400 }, (_, i) => ({ seat: "you" as const, text: `line ${i}` }));
    const text = reviewPrompt(input(game({ winner: "you", log } as unknown as Partial<PracticeGame>)));
    expect(text).toContain("[player] line 0");
    expect(text).toContain("[player] line 399");
    expect(text).toContain("… (140 lines left out) …");
    expect(text).not.toContain("line 100\n");
  });
});
