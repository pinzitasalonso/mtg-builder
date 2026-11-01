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
}

/** Card info by lowercased name. */
export type CardBook = Record<string, CardInfo>;

export interface LogLine {
  seat: Seat | null;
  text: string;
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
