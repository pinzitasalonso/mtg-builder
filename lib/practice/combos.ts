// The opponent's combos in a practice match.
//
// A cEDH deck doesn't win by attacking: it assembles a few cards and the
// game ends. The table can't play a loop out card by card (it doesn't know
// what "untap, repeat" does), so a combo is something the opponent
// DECLARES, and the table checks what it can: every piece is where
// Commander Spellbook says it must be, and its mana can be paid. Then the
// player gets a stop to answer (destroy a piece, counter a spell), and if
// the pieces are still there, the table carries out what the combo makes:
// a win ends the game, endless mana fills the opponent's pool, anything
// else is said in the log.
//
// The list comes from Spellbook once, when the match starts
// (app/api/practice/start), for the deck the opponent pilots.

import type { ComboLine } from "@/lib/combos";

export interface DeckCombo {
  /** Spellbook's id: what a plan's combo action names. */
  id: string;
  pieces: { name: string; zones: string[] }[];
  produces: string[];
  manaNeeded: string;
  steps: string;
  prerequisites: string;
}

/** What a combo amounts to at this table. */
export type ComboOutcome = "win" | "mill" | "mana" | "other";

const WINS = /^win the game$|\binfinite (?:damage|lifeloss|life loss|combat damage|combat phases|turns)\b|\beach opponent loses\b|\binfinite creature tokens with haste\b|\binfinite hasty\b/i;
// Milling the opponents out. ("Infinite self-mill" is the deck's own library.)
const MILLS = /^(?:near-)?infinite mill$|\bexile (?:all )?opponents'? librar/i;
const MANA = /\binfinite\b.*\bmana\b/i;

export function comboOutcome(produces: string[]): ComboOutcome {
  if (produces.some((p) => WINS.test(p))) return "win";
  if (produces.some((p) => MILLS.test(p))) return "mill";
  if (produces.some((p) => MANA.test(p))) return "mana";
  return "other";
}

/** The result worth saying first: the win, else the mana, else the first. */
export function comboHeadline(c: Pick<DeckCombo, "produces">): string {
  return c.produces.find((p) => WINS.test(p)) ?? c.produces.find((p) => MILLS.test(p)) ?? c.produces.find((p) => MANA.test(p)) ?? c.produces[0] ?? "a combo";
}

const RANK: Record<ComboOutcome, number> = { win: 0, mill: 1, mana: 2, other: 3 };
/** A deck can have dozens: this many are kept, the ones that win first. */
export const MAX_COMBOS = 24;

/** Spellbook's lines as the table keeps them: the ones that end the game
    first, the ones with fewest pieces before the long ones. */
export function deckCombos(lines: ComboLine[]): DeckCombo[] {
  return lines
    .filter((l) => l.pieces.length >= 1 && l.pieces.length <= 6)
    .map((l) => ({
      id: l.id,
      pieces: l.pieces.map((name) => ({ name, zones: l.zones?.[name]?.length ? l.zones[name]! : ["B"] })),
      produces: l.produces.slice(0, 12),
      manaNeeded: l.manaNeeded,
      steps: l.steps.slice(0, 900),
      prerequisites: (l.prerequisites ?? "").slice(0, 300),
    }))
    .sort((a, b) => RANK[comboOutcome(a.produces)] - RANK[comboOutcome(b.produces)] || a.pieces.length - b.pieces.length)
    .slice(0, MAX_COMBOS);
}

/** Combos as they come back from a stored game or the browser: only things
    with a combo's shape, their text cut short. */
export function asCombos(v: unknown): DeckCombo[] {
  if (!Array.isArray(v)) return [];
  const text = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");
  return v
    .filter((c): c is DeckCombo => !!c && typeof c === "object" && typeof (c as DeckCombo).id === "string" && Array.isArray((c as DeckCombo).pieces))
    .slice(0, MAX_COMBOS)
    .map((c) => ({
      id: c.id.slice(0, 40),
      pieces: c.pieces
        .filter((p) => !!p && typeof p.name === "string")
        .slice(0, 6)
        .map((p) => ({ name: p.name.slice(0, 200), zones: (Array.isArray(p.zones) ? p.zones : ["B"]).filter((z) => typeof z === "string" && /^[BHGECL]$/.test(z)) })),
      produces: (Array.isArray(c.produces) ? c.produces : []).filter((p): p is string => typeof p === "string").slice(0, 12).map((p) => p.slice(0, 120)),
      manaNeeded: text(c.manaNeeded, 80),
      steps: text(c.steps, 900),
      prerequisites: text(c.prerequisites, 300),
    }));
}
