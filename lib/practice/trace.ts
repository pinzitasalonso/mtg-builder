// What the opponent did in a real match, turn by turn, kept to learn from.
//
// The benchmark (calibration/practice) says how fast the built-in planner
// is against nobody. It can't say what the smart opponent does in a
// player's match: what the model planned with the hand it had, and what
// the table then played. This is that record. The turn route writes a row
// each time it plans a turn, the result route writes the table's closing
// log, and the admin page reads a match back as text.

import { availableMana, castable } from "./game";
import { manaSummary } from "./mana";
import type { CardBook, PracticeGame } from "./types";

/** One of the opponent's turns, as it began. */
export interface TurnTrace {
  life: { opp: number; you: number };
  mana: string;
  /** Its hand; `*` marks a card it could pay for. */
  hand: string[];
  field: string[];
  graveyard: number;
  library: number;
  yourField: string[];
  /** The table's log since its turn before began: that turn as it was
      played, then the player's turn. */
  since: string[];
  /** The built-in planner's turn, in words. */
  line?: string;
  /** The model's plan, in words, with what it said and its actions as it
      wrote them. */
  plan?: string;
  say?: string;
  raw?: string;
  /** Why the planner played instead of the model, as the player was told,
      and what the API said (never shown to the player). */
  note?: string;
  error?: string;
  /** "end": how the match ended. */
  result?: string;
}

const OPP_TURN = /^Turn \d+ — the opponent's turn\.$/;
const YOUR_TURN = /^Turn \d+ — your turn\.$/;
const MOVE = /^The opponent (casts|activates|goes for a combo|sacrifices .+ to |equips )/;
const cut = (lines: string[]) => lines.slice(-70).map((t) => t.slice(0, 220));

/** The log since the opponent's turn before this one began. */
export function sinceLastOwnTurn(g: PracticeGame): string[] {
  const texts = g.log.map((l) => l.text);
  let now = texts.length;
  for (let i = texts.length - 1; i >= 0; i--) {
    if (OPP_TURN.test(texts[i]!)) {
      now = i;
      break;
    }
  }
  let from = Math.max(0, now - 40);
  for (let i = now - 1; i >= 0; i--) {
    if (OPP_TURN.test(texts[i]!)) {
      from = i;
      break;
    }
  }
  return cut(texts.slice(from, now));
}

/** The opponent's turn as it begins. */
export function turnTrace(g: PracticeGame, book: CardBook): TurnTrace {
  const me = g.sides.opp;
  return {
    life: { opp: me.life, you: g.sides.you.life },
    mana: manaSummary(availableMana(g, "opp", book)),
    hand: me.hand.map((c) => c.name + (castable(g, "opp", c, book, "hand") ? "*" : "")),
    field: me.battlefield.map((c) => c.name + (c.tapped ? " (tapped)" : "")),
    graveyard: me.graveyard.length,
    library: me.library.length,
    yourField: g.sides.you.battlefield.map((c) => c.name),
    since: sinceLastOwnTurn(g),
  };
}

/** A client's closing log, as a row: text lines only, cut to size. */
export function endTrace(log: unknown, result: string): TurnTrace | null {
  if (!Array.isArray(log)) return null;
  const lines = log.filter((l): l is string => typeof l === "string");
  if (!lines.length) return null;
  return { life: { opp: 0, you: 0 }, mana: "", hand: [], field: [], graveyard: 0, library: 0, yourField: [], since: cut(lines), result };
}

/** What the opponent did on the turn a `since` begins with: its spells,
    abilities and combos, up to the player's turn. */
export function movesIn(since: string[]): number {
  let n = 0;
  for (const t of since.slice(1)) {
    if (YOUR_TURN.test(t)) break;
    if (MOVE.test(t)) n++;
  }
  return n;
}

export interface TraceRow {
  turn: number;
  source: string;
  data: TurnTrace;
}

/** A match's numbers: the opponent's turns the server planned, how many of
    them cast nothing, and who planned them. Row i's turn is judged by row
    i + 1's `since` (or the closing log), which is where it was played. */
export function traceStats(rows: TraceRow[]): { turns: number; idle: number; known: number; bySource: Record<string, number> } {
  const turns = rows.filter((r) => r.source !== "end");
  const bySource: Record<string, number> = {};
  let idle = 0;
  let known = 0;
  turns.forEach((r) => {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    const next = rows[rows.indexOf(r) + 1];
    if (!next || !OPP_TURN.test(next.data.since[0] ?? "")) return;
    known++;
    if (!movesIn(next.data.since)) idle++;
  });
  return { turns: turns.length, idle, known, bySource };
}

/** A match as text, to read (and to paste to whoever is tuning the opponent). */
export function traceText(head: { label: string; bot: boolean; result: string | null; endTurn: number | null; createdAt: Date }, rows: TraceRow[]): string {
  const stats = traceStats(rows);
  const out: string[] = [
    `Practice match against ${head.label}${head.bot ? " (basic opponent)" : ""}, ${head.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    head.result ? `Result: the player ${head.result} on turn ${head.endTurn ?? "?"}.` : "Result: not finished (or not reported).",
    `Opponent turns planned by the server: ${stats.turns} (${Object.entries(stats.bySource).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}). Turns with no spell, ability or combo: ${stats.idle} of ${stats.known}.`,
    "",
  ];
  for (const r of rows) {
    const d = r.data;
    if (r.source === "end") {
      out.push(`=== How it ended (${d.result ?? "?"}) ===`, ...d.since.map((t) => `   ${t}`), "");
      continue;
    }
    out.push(
      `=== Turn ${r.turn} · planned by: ${r.source} · life ${d.life.opp} (player ${d.life.you}) · ${d.mana} · library ${d.library} · graveyard ${d.graveyard} ===`,
      `hand: ${d.hand.join(", ") || "(empty)"}`,
      `in play: ${d.field.join(", ") || "nothing"}`,
      `the player has: ${d.yourField.join(", ") || "nothing"}`,
      ...(d.line ? [`the app's line: ${d.line}`] : []),
      ...(d.plan !== undefined ? [`the model's plan: ${d.plan || "nothing"}${d.say ? ` — "${d.say}"` : ""}`] : []),
      ...(d.raw ? [`its actions: ${d.raw}`] : []),
      ...(d.note ? [`note: ${d.note}`] : []),
      ...(d.error ? [`the API said: ${d.error}`] : []),
      "since its turn before:",
      ...d.since.map((t) => `   ${t}`),
      ""
    );
  }
  return out.join("\n");
}

/** How long a match's turns are kept. */
export const TRACE_DAYS = 45;
