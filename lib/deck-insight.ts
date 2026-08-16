// Bracket and 8x8 counting for a decklist — the two readings the iOS deck's
// Stats tab shows that the web had no answer for.
//
// Both are computed on the CLIENT from cards it already holds, exactly as iOS
// does, rather than served. The only thing that has to come from anywhere is
// the Game Changer name list, which is a Scryfall query behind
// /api/gamechangers.
//
// The Swift originals are CommanderBracket.swift and DeckStatsView's `buckets`.
// Two implementations of one rule is a real cost, so where the numbers are
// arbitrary they are named constants here and the divergence is a test failure
// away from being noticed rather than a bug a player reports.

/** A card as both the bracket and the 8x8 count need it. */
export interface InsightCard {
  name: string;
  typeLine: string | null;
  role: string | null;
  quantity: number;
  board: string;
}

/** Same key the rest of the app matches names by. */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// ---------------------------------------------------------------------------
// Bracket
// ---------------------------------------------------------------------------

export type Bracket = "exhibition" | "core" | "upgraded" | "optimized" | "cedh";

export const BRACKET_LABEL: Record<Bracket, string> = {
  exhibition: "Exhibition",
  core: "Core",
  upgraded: "Upgraded",
  optimized: "Optimized",
  cedh: "cEDH",
};

export const BRACKET_NUMBER: Record<Bracket, number> = {
  exhibition: 1,
  core: 2,
  upgraded: 3,
  optimized: 4,
  cedh: 5,
};

/**
 * The bracket a list adds up to.
 *
 * Ported from `CommanderBracket.suggested`. Exhibition and cEDH are absent on
 * purpose: both are things a player DECLARES about how they intend to play,
 * and no count of cards can establish either.
 */
export function suggestedBracket(gameChangers: number, twoCardCombo = false): Bracket {
  if (gameChangers >= 4) return "optimized";
  if (gameChangers >= 1 || twoCardCombo) return "upgraded";
  return "core";
}

/**
 * How many DISTINCT Game Changers are on the decklist.
 *
 * Distinct, not copies — the bracket counts cards, and in a singleton format
 * the two only differ for basic lands. The pool is excluded: a Game Changer
 * you are considering is not one you are playing.
 */
export function countGameChangers(cards: InsightCard[], gameChangerKeys: Set<string>): number {
  const seen = new Set<string>();
  for (const card of cards) {
    if (card.board !== "deck") continue;
    const key = nameKey(card.name);
    if (gameChangerKeys.has(key)) seen.add(key);
  }
  return seen.size;
}

// ---------------------------------------------------------------------------
// 8x8 counting
// ---------------------------------------------------------------------------

export interface CubeBucket {
  id: string;
  label: string;
  /** The shape's suggested count. NOT a grade — see the note below. */
  target: number;
  hint?: string;
  count: number;
  entries: { name: string; quantity: number }[];
}

/** A land by its tagged role, or failing that by its type line. */
const isLandCard = (c: InsightCard): boolean =>
  c.role === "land" || /\bLand\b/.test((c.typeLine ?? "").split("—")[0] ?? "");

/**
 * The 8x8 shape: eight categories of eight cards plus thirty-five lands.
 *
 * These REPORT distance from a shape, they do not grade a deck. The framework's
 * authors are explicit that it is a starting point rather than a rule — "maybe
 * one category has 6 and another 9" — and anything rendering this is on the
 * hook for not turning it into a score.
 *
 * Three of the core four (Ramp, Draw, Removal) are roles the app tags per card,
 * so they are counted for real. The fourth, "Personal", is whatever the
 * commander wants, and the other four categories are the deckbuilder's own.
 * Nothing here can name those, so the leftovers stay ONE bucket rather than
 * being split into invented ones.
 */
export function cubeBuckets(cards: InsightCard[]): CubeBucket[] {
  const rows = cards.filter((c) => c.board === "deck");
  const lands = rows.filter(isLandCard);
  const spells = rows.filter((c) => !isLandCard(c));
  const core = new Set(["ramp", "draw", "removal"]);
  const rest = spells.filter((c) => !c.role || !core.has(c.role));

  const make = (id: string, label: string, target: number, rs: InsightCard[], hint?: string): CubeBucket => {
    const entries = rs
      .map((c) => ({ name: c.name, quantity: Math.max(1, c.quantity) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      id,
      label,
      target,
      hint,
      // Copies, not rows: thirty-five lands means thirty-five cards.
      count: entries.reduce((n, e) => n + e.quantity, 0),
      entries,
    };
  };

  return [
    make("lands", "Lands", 35, lands),
    make("spells", "Spells", 64, spells),
    make("ramp", "Ramp", 8, spells.filter((c) => c.role === "ramp")),
    make("draw", "Draw", 8, spells.filter((c) => c.role === "draw")),
    make("removal", "Removal", 8, spells.filter((c) => c.role === "removal")),
    make("rest", "Everything else", 40, rest, "five packages"),
  ];
}
