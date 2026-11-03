// Types for a practice game against the AI (docs/practice-vs-ai.md).

import type { PlaytestState } from "../playtest";

/** "you" is the player at the screen; "opp" is the AI. */
export type Seat = "you" | "opp";
export const other = (s: Seat): Seat => (s === "you" ? "opp" : "you");

/** What a card is, from Scryfall: the same for every copy. */
export interface CardInfo {
  name: string;
  imageUri: string;
  typeLine: string | null;
  manaCost: string | null;
  manaValue: number;
  oracleText: string | null;
  power: number | null;
  toughness: number | null;
  /** Scryfall's keyword list: "Flying", "Trample", "Haste"… */
  keywords: string[];
  /** Colours of mana it can add (W U B R G C), from Scryfall. */
  producedMana: string[];
  /** A transforming card's back face: its stats, when it has them. */
  back?: { power: number | null; toughness: number | null };
}

/** Card info by lowercased name. */
export type CardBook = Record<string, CardInfo>;

export interface LogLine {
  seat: Seat | null;
  text: string;
  /** The card a cast (or counter) line is about: the table shows the last
      few as "Last played", like the stack. */
  card?: { iid: number; name: string; imageUri: string };
}

export interface Combat {
  attacker: Seat;
  /** Attacking creatures, by iid. */
  attackers: number[];
  /** Attacker iid → its blockers, in damage order. */
  blocks: Record<number, number[]>;
  /** "attack" while blocks are being chosen; "blocked" once they're set. */
  stage: "attack" | "blocked";
}

export interface PracticeGame {
  sides: Record<Seat, PlaytestState>;
  /** Counts every player's turn: 1 is the first player's first turn. */
  turn: number;
  active: Seat;
  first: Seat;
  landPlayed: boolean;
  combat: Combat | null;
  log: LogLine[];
  winner: Seat | null;
  /** Commander combat damage each seat has taken. */
  cmdDamage: Record<Seat, number>;
  /** Times each seat has cast its commander from the command zone. */
  tax: Record<Seat, number>;
  commanderGame: boolean;
  /** The next free iid, for tokens. */
  nextIid: number;
  /** Mana added by a spell or ability (a ritual), spent before any source
      is tapped and emptied at the end of each phase: one colour letter a
      unit (W U B R G C). Missing in games started before it existed. */
  pool?: Record<Seat, string[]>;
  /** A choice the player has to make before the game goes on (Kefka's
      discard, a sacrifice). */
  choice?: Choice | null;
}

/** What the player picks: a card from their hand to discard, or one of
    their permanents to sacrifice. */
export interface Choice {
  kind: "discard" | "sacrifice";
  /** The card asking, for the prompt. */
  source: string;
  /** Who controls it. */
  by: Seat;
  /** A discard: the cards already discarded the same way (the AI's), whose
      card types count with yours for the draw after. */
  discarded?: string[];
  /** A sacrifice: what kind of permanent ("permanent", "creature"). */
  what?: string;
}

// ── The AI's plan, as the model writes it (and the fallback planner). ──
// Cards are named by their id in the brief ("c10023"); players are "ai" (the
// opponent) and "player" (you). Every field is present; unused ones are null.

export type EffectType =
  | "damage"
  | "life"
  | "destroy"
  | "exile"
  | "bounce"
  | "tap"
  | "untap"
  | "draw"
  | "discard"
  | "mill"
  | "token"
  | "counters"
  | "pump"
  | "search"
  | "mana"
  | "note";

export interface Effect {
  type: EffectType;
  /** A card id ("c123"), or "ai" / "player" for damage. */
  target: string | null;
  player: "ai" | "player" | null;
  amount: number | null;
  /** Token or searched card name. */
  name: string | null;
  power: number | null;
  toughness: number | null;
  keywords: string[];
  to: "battlefield" | "hand" | null;
  tapped: boolean | null;
  text: string | null;
}

export interface PlanAction {
  kind: "land" | "cast" | "activate";
  card: string;
  /** X, for a spell with X in its cost. */
  x: number | null;
  /** Activate: the ability's costs. */
  tap_card: boolean | null;
  sacrifice_card: boolean | null;
  mana: string | null;
  life: number | null;
  effects: Effect[];
}

export interface TurnPlan {
  main: PlanAction[];
  attack: string[];
  after_combat: PlanAction[];
  say: string;
}
