import { describe, expect, it } from "vitest";
import { clampDeckRecord } from "./deck-record";

const stored = { gamesPlayed: 10, gamesWon: 4 };

describe("clampDeckRecord", () => {
  it("takes both numbers when they're coherent", () => {
    expect(clampDeckRecord({ gamesPlayed: 7, gamesWon: 3 }, stored)).toEqual({
      gamesPlayed: 7,
      gamesWon: 3,
    });
  });

  it("keeps the stored value for a field the client didn't send", () => {
    // The iOS steppers edit wins and losses separately, so a request can carry
    // one without the other.
    expect(clampDeckRecord({ gamesWon: 9 }, stored)).toEqual({
      gamesPlayed: 10,
      gamesWon: 9,
    });
    expect(clampDeckRecord({ gamesPlayed: 12 }, stored)).toEqual({
      gamesPlayed: 12,
      gamesWon: 4,
    });
  });

  it("never lets wins exceed games played", () => {
    // The one incoherent state a two-field editor invites, and it makes every
    // win rate in both clients wrong.
    expect(clampDeckRecord({ gamesPlayed: 3, gamesWon: 8 }, stored)).toEqual({
      gamesPlayed: 3,
      gamesWon: 3,
    });
  });

  it("floors negatives at zero", () => {
    expect(clampDeckRecord({ gamesPlayed: -5, gamesWon: -2 }, stored)).toEqual({
      gamesPlayed: 0,
      gamesWon: 0,
    });
  });

  it("truncates fractions rather than storing them", () => {
    expect(clampDeckRecord({ gamesPlayed: 6.9, gamesWon: 2.4 }, stored)).toEqual({
      gamesPlayed: 6,
      gamesWon: 2,
    });
  });

  it("falls back to the stored numbers on junk", () => {
    // A zero must still be a zero, though — the reset button sends exactly
    // that, and it has to survive the junk guard.
    expect(clampDeckRecord({ gamesPlayed: "nope", gamesWon: null }, stored)).toEqual({
      gamesPlayed: 10,
      gamesWon: 4,
    });
    expect(clampDeckRecord({ gamesPlayed: 0, gamesWon: 0 }, stored)).toEqual({
      gamesPlayed: 0,
      gamesWon: 0,
    });
  });
});
