// The game as a browser sends it (a practice game lives in the browser):
// checked to have a game's shape, and its text cut to a card's size, before
// any of it reaches a prompt.

import type { PracticeGame } from "./types";

const ZONES = ["library", "hand", "battlefield", "graveyard", "exile", "command"] as const;
// A double-faced card's full name and type line fit well inside this.
const MAX_TEXT = 300;
const MAX_LOG_LINES = 200;

/** The game the browser sent, if it has the shape of one. */
export function asGame(v: unknown): PracticeGame | null {
  const g = v as PracticeGame | null;
  if (!g || typeof g !== "object" || typeof g.turn !== "number" || !g.sides) return null;
  for (const seat of ["you", "opp"] as const) {
    const side = g.sides[seat];
    if (!side || typeof side.life !== "number") return null;
    for (const z of ZONES) {
      if (!Array.isArray(side[z]) || side[z].length > 400) return null;
      // Card names and type lines go into the prompt: no longer than a card's.
      for (const c of side[z]) {
        if (!c || typeof c !== "object" || typeof c.name !== "string" || c.name.length > MAX_TEXT) return null;
        if (c.typeLine != null && (typeof c.typeLine !== "string" || c.typeLine.length > MAX_TEXT)) return null;
      }
    }
  }
  // The log is the browser's: only its last lines are read, each cut short.
  g.log = (Array.isArray(g.log) ? g.log : [])
    .filter((l) => !!l && typeof l === "object" && typeof l.text === "string")
    .slice(-MAX_LOG_LINES)
    .map((l) => ({ ...l, text: l.text.slice(0, MAX_TEXT) }));
  return g;
}
