// The built-in planner playing a deck by itself, against a player who does
// nothing: how fast a list wins with no one in its way, and which turns it
// gives away. The practice benchmark (calibration/practice) replays seeded
// games with it, and reads the logs.
//
// A turn here is the turn the table plays (components/deck/PracticeTable
// runAi), without its pauses: the plan, a new plan while the turn brings
// new cards, the attack (no blocks), and the end step.

import { aiMulligan, fallbackPlan } from "./ai";
import type { DeckCombo } from "./combos";
import { aiEndStep, aiGraveyardCasts, applyAction, availableMana, castable, declareAttackers, endTurn, newGame, parseCardId, resolveCombat, setBlocks, type DeckCard } from "./game";
import { manaSummary } from "./mana";
import type { CardBook, PracticeGame } from "./types";

/** A deck to replay: its cards, its commander(s) and the combos Spellbook lists for it. */
export interface SelfplayDeck {
  cards: DeckCard[];
  commander: string | null;
  book: CardBook;
  combos: DeckCombo[];
}

/** One of the opponent's turns, as the benchmark reads it. */
export interface SelfplayTurn {
  /** Its own turn count: 1 is its first. */
  n: number;
  lands: number;
  /** Its hand as the turn starts; `*` marks a card it could pay for. */
  hand: string[];
  /** Its battlefield as the turn starts, and the mana it could pay with. */
  field: string[];
  mana: string;
  /** Spells cast, abilities used and combos declared. */
  moves: number;
  log: string[];
}

export interface SelfplayGame {
  seed: number;
  opening: string[];
  mulligans: number;
  /** The opponent's turn it won on; null when it hadn't by the last turn. */
  wonOn: number | null;
  /** How it ended, from the log's last lines. */
  how: string;
  turns: SelfplayTurn[];
}

/** A small seeded generator, so a seed is the same game every time. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

const ISLAND = { name: "Island", imageUri: "", typeLine: "Basic Land — Island", manaCost: null, manaValue: 0, oracleText: "", power: null, toughness: null, keywords: [], producedMana: ["U"] };

/** The opponent's turn, played out by the built-in planner. */
export function planTurn(g0: PracticeGame, book: CardBook, combos: DeckCombo[]): PracticeGame {
  let g = g0;
  const stamp = (x: PracticeGame) => `${x.sides.opp.hand.map((c) => c.iid).join()}|${x.sides.opp.battlefield.map((c) => `${c.iid}${c.tapped ? "t" : ""}`).join()}|${x.sides.you.library.length}`;
  let attack: string[] = [];
  for (let round = 0; round < 4 && !g.winner; round++) {
    const plan = fallbackPlan(g, book, "opp", {}, combos);
    if (round && !plan.main.length) break;
    attack = plan.attack;
    const before = stamp(g);
    for (const a of plan.main) {
      // A combo is announced, then (with no answer) carried out.
      if (a.kind === "combo") g = applyAction(applyAction(g, "opp", a, book, { stage: "pay", combos }).game, "opp", a, book, { stage: "resolve", combos }).game;
      else g = applyAction(g, "opp", a, book, { combos }).game;
      if (g.winner) return g;
    }
    if (stamp(g) === before) break;
  }
  const attackers = attack.map(parseCardId).filter((n): n is number => n !== null);
  if (attackers.length) {
    const declared = declareAttackers(g, "opp", attackers, book);
    if (declared.combat) g = resolveCombat(setBlocks(declared, {}, book), book);
  }
  if (g.winner) return g;
  for (const a of aiGraveyardCasts(g, book)) g = applyAction(g, "opp", a, book, { combos }).game;
  return g.winner ? g : aiEndStep(g, book);
}

/** One game: the deck against a player who only plays nothing, for
    `turns` of the deck's own turns. The player goes first, so the deck
    draws on its first turn. `Math.random` is the seed's for the game. */
export function selfplay(deck: SelfplayDeck, seed: number, turns = 10): SelfplayGame {
  const random = Math.random;
  const next = seeded(seed);
  Math.random = next;
  try {
    const shuffle = <T,>(a: T[]) => {
      const o = [...a];
      for (let i = o.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [o[i], o[j]] = [o[j]!, o[i]!];
      }
      return o;
    };
    const book: CardBook = { ...deck.book, island: ISLAND };
    let g = newGame({
      you: { cards: Array<DeckCard>(60).fill({ name: "Island", imageUri: "", typeLine: ISLAND.typeLine }), commander: null },
      opp: { cards: deck.cards, commander: deck.commander },
      commanderGame: !!deck.commander,
      first: "you",
      shuffle,
    });
    const opp = aiMulligan(g.sides.opp, book);
    g = { ...g, sides: { ...g.sides, opp } };
    const out: SelfplayGame = { seed, opening: opp.hand.map((c) => c.name), mulligans: opp.mulligans, wonOn: null, how: "", turns: [] };
    // The player's first turn: nothing.
    g = endTurn(g, book);
    for (let n = 1; n <= turns && !g.winner; n++) {
      // An extra turn of its own counts as a turn.
      if (g.active !== "opp") g = endTurn(g, book);
      if (g.winner) break;
      // The game's log is capped: each turn starts a fresh one here.
      g = { ...g, log: [] };
      const turn: SelfplayTurn = {
        n,
        lands: g.sides.opp.battlefield.filter((c) => /\bLand\b/.test(c.typeLine ?? "")).length,
        hand: g.sides.opp.hand.map((c) => c.name + (castable(g, "opp", c, book, "hand") ? "*" : "")),
        field: g.sides.opp.battlefield.map((c) => c.name),
        mana: manaSummary(availableMana(g, "opp", book)),
        moves: 0,
        log: [],
      };
      g = planTurn(g, book, deck.combos);
      if (!g.winner) g = endTurn(g, book, deck.combos);
      turn.log = g.log.filter((l) => l.seat !== "you").map((l) => l.text);
      turn.moves = turn.log.filter((t) => /^The opponent (casts|activates|goes for a combo|sacrifices .+ to )/.test(t)).length;
      out.turns.push(turn);
      if (g.winner === "opp") out.wonOn = n;
    }
    if (g.winner === "opp" && out.wonOn === null) out.wonOn = out.turns.length;
    out.how = g.winner ? (g.log.slice(-3).map((l) => l.text).find((t) => /wins|out of life|loses the game/i.test(t)) ?? `${g.winner} wins`) : "no winner";
    return out;
  } finally {
    Math.random = random;
  }
}

/** A list's numbers over many games. */
export interface SelfplayReport {
  games: number;
  /** Games won by each of its turns: wonBy[4] is "by its turn 4". */
  wonBy: Record<number, number>;
  /** The turn half its games are won by; null when fewer than half are. */
  median: number | null;
  /** Of its first five turns, the share with no spell, ability or combo. */
  idle: number;
  /** Games it lost (to itself: Final Fortune, an empty library). */
  lost: number;
}

export function report(games: SelfplayGame[], turns = 10): SelfplayReport {
  const wonBy: Record<number, number> = {};
  for (let n = 1; n <= turns; n++) wonBy[n] = games.filter((g) => g.wonOn !== null && g.wonOn <= n).length;
  const half = Math.ceil(games.length / 2);
  const median = Object.keys(wonBy).map(Number).find((n) => wonBy[n]! >= half) ?? null;
  const early = games.flatMap((g) => g.turns.filter((t) => t.n <= 5 && (g.wonOn === null || t.n <= g.wonOn)));
  return {
    games: games.length,
    wonBy,
    median,
    idle: early.length ? early.filter((t) => !t.moves).length / early.length : 0,
    lost: games.filter((g) => g.wonOn === null && /you win|loses the game/i.test(g.how)).length,
  };
}
