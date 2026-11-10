// A practice game in progress, kept in the browser so a reload or a closed
// tab doesn't lose it (for a free account that was also the day's game).
// One per deck. Not every moment of a game can be picked up again (the
// opponent's turn is one long flow), so what's kept is the last steady
// point: your mulligan, your turn as you left it, or the start of the
// opponent's turn, which is played again from there.

import type { OpponentOption } from "./opponents";
import type { CardBook, PracticeGame } from "./types";

export interface SavedSetup {
  id: string;
  bot?: boolean;
  commanderGame: boolean;
  book: CardBook;
  you: { label: string; cards: unknown[]; commander: string | null };
  opp: { label: string; detail: string; cards: unknown[]; commander: string | null };
}

export interface SavedGame<S extends SavedSetup = SavedSetup> {
  v: 1;
  /** When it was saved (ms). */
  at: number;
  setup: S;
  game: PracticeGame;
  /** Where to pick it up. */
  as: "mulligan" | "main" | "ai";
  option: OpponentOption | null;
}

const KEY = (deckId: string) => `sp-practice:${deckId}`;
/** A game left for a week isn't offered again. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** What was read from storage, if it is a game that can be picked up. */
export function readSaved<S extends SavedSetup>(raw: string | null, now = Date.now()): SavedGame<S> | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as SavedGame<S> | null;
    if (!s || s.v !== 1 || typeof s.at !== "number" || now - s.at > MAX_AGE_MS) return null;
    if (!s.setup?.id || !s.setup.book || !s.game?.sides?.you || !s.game.sides.opp || s.game.winner) return null;
    if (s.as !== "mulligan" && s.as !== "main" && s.as !== "ai") return null;
    return s;
  } catch {
    return null;
  }
}

export function loadSaved<S extends SavedSetup>(deckId: string): SavedGame<S> | null {
  try {
    return readSaved<S>(window.localStorage.getItem(KEY(deckId)));
  } catch {
    return null;
  }
}

/** Keep the game. Storage that's full or switched off loses nothing but the resume. */
export function storeSaved(deckId: string, save: Omit<SavedGame, "v" | "at">): void {
  try {
    window.localStorage.setItem(KEY(deckId), JSON.stringify({ v: 1, at: Date.now(), ...save }));
  } catch {
    /* no room, or no storage */
  }
}

export function clearSaved(deckId: string): void {
  try {
    window.localStorage.removeItem(KEY(deckId));
  } catch {
    /* no storage */
  }
}
