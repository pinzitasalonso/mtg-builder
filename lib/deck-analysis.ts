// The written half of a deck scan: what the AI says about the deck, in a
// fixed shape both clients render.
//
// The Score is counted; this is judged. The model gets the decklist, the
// Score's working (every axis, its facts and the cards it counted), the combo
// lines, and whatever the player wrote in the notes box, and writes the
// document a good pilot would hand you: what the deck is, how it wins, what
// to keep, which cards matter, what beats it. It also makes the two
// judgement calls the rubric leaves to a reader — the fundamental turn and
// commander dependency — within the bounds lib/deck-score-report enforces,
// with a reason for each that the working shows.
//
// Pure: the prompt and the schema live here, the API call lives in the route,
// so this can be tested without a network.

import type { DeckScoreReport, Judgement } from "./deck-score-report";
import type { ComboLineInput, ScoredCard } from "./deck-score-classify";

export interface AnalysisDocument {
  overview: string;
  strategy: string[];
  mulligan: string[];
  keyCards: { name: string; why: string }[];
  tips: string[];
  weaknesses: { critical: string[]; minor: string[] };
  axes: { key: "consistency" | "resilience" | "interaction" | "speed"; note: string }[];
}

/** What the model returns: the document plus the two judgement calls. */
export interface AnalysisOutput {
  analysis: AnalysisDocument;
  judgement: {
    fundamentalTurn: number;
    turnReason: string;
    commanderDependency: "none" | "moderate" | "high";
    dependencyReason: string;
  };
}

/** The stored scan: the Score (judgement applied) and the document. */
export interface DeckScan {
  score: DeckScoreReport;
  analysis: AnalysisDocument | null;
  notes: string | null;
  scannedAt: string;
}

export const MAX_NOTES_CHARS = 1500;

const AXIS_KEYS = ["consistency", "resilience", "interaction", "speed"];

/** JSON schema for structured output — strict, no extra keys. */
export const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["analysis", "judgement"],
  properties: {
    analysis: {
      type: "object",
      additionalProperties: false,
      required: ["overview", "strategy", "mulligan", "keyCards", "tips", "weaknesses", "axes"],
      properties: {
        overview: { type: "string" },
        strategy: { type: "array", items: { type: "string" } },
        mulligan: { type: "array", items: { type: "string" } },
        keyCards: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "why"],
            properties: { name: { type: "string" }, why: { type: "string" } },
          },
        },
        tips: { type: "array", items: { type: "string" } },
        weaknesses: {
          type: "object",
          additionalProperties: false,
          required: ["critical", "minor"],
          properties: {
            critical: { type: "array", items: { type: "string" } },
            minor: { type: "array", items: { type: "string" } },
          },
        },
        axes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["key", "note"],
            properties: { key: { type: "string", enum: AXIS_KEYS }, note: { type: "string" } },
          },
        },
      },
    },
    judgement: {
      type: "object",
      additionalProperties: false,
      required: ["fundamentalTurn", "turnReason", "commanderDependency", "dependencyReason"],
      properties: {
        fundamentalTurn: { type: "number" },
        turnReason: { type: "string" },
        commanderDependency: { type: "string", enum: ["none", "moderate", "high"] },
        dependencyReason: { type: "string" },
      },
    },
  },
} as const;

/** One line per card, grouped by type, the way a player reads a list. */
export function decklistBlock(cards: ScoredCard[]): string {
  const commanders = cards.filter((c) => c.isCommander);
  const rest = cards.filter((c) => !c.isCommander);
  const line = (c: ScoredCard) => `${c.quantity > 1 ? `${c.quantity}x ` : ""}${c.name} — ${c.manaCost ?? ""} ${c.typeLine}`.replace(/\s+/g, " ").trim();
  const groups: [string, (c: ScoredCard) => boolean][] = [
    ["Creatures", (c) => /creature/i.test(c.typeLine) && !/land/i.test(c.typeLine)],
    ["Instants", (c) => /instant/i.test(c.typeLine)],
    ["Sorceries", (c) => /sorcery/i.test(c.typeLine)],
    ["Artifacts", (c) => /artifact/i.test(c.typeLine) && !/creature|land/i.test(c.typeLine)],
    ["Enchantments", (c) => /enchantment/i.test(c.typeLine) && !/creature|land/i.test(c.typeLine)],
    ["Planeswalkers", (c) => /planeswalker/i.test(c.typeLine)],
    ["Lands", (c) => /land/i.test(c.typeLine)],
  ];
  const seen = new Set<ScoredCard>();
  const out: string[] = [];
  if (commanders.length) out.push(`Commander: ${commanders.map(line).join(" + ")}`);
  for (const [label, test] of groups) {
    const rows = rest.filter((c) => !seen.has(c) && test(c));
    if (!rows.length) continue;
    rows.forEach((c) => seen.add(c));
    out.push(`\n${label} (${rows.reduce((n, c) => n + c.quantity, 0)}):\n` + rows.map(line).join("\n"));
  }
  const other = rest.filter((c) => !seen.has(c));
  if (other.length) out.push(`\nOther:\n` + other.map(line).join("\n"));
  return out.join("\n");
}

/** The Score's working, as the model should read it. */
export function scoreBlock(report: DeckScoreReport): string {
  const parts = [`Score ${report.label} — bracket floor ${report.bracketFloor}, computed fundamental turn ${report.fundamentalTurn}, computed commander dependency ${report.commanderDependency}.`];
  for (const a of report.axes) {
    parts.push(`\n${a.label} ${a.score} (${a.descriptor}) — ${a.summary}`);
    for (const f of a.facts) parts.push(`  - ${f}`);
    for (const g of a.cards) parts.push(`  ${g.label}: ${g.names.join("; ")}`);
  }
  return parts.join("\n");
}

export function combosBlock(lines: ComboLineInput[]): string {
  if (!lines.length) return "Combo lines (Commander Spellbook): none found.";
  return (
    "Combo lines (Commander Spellbook):\n" +
    lines.map((l) => `- ${l.pieces.join(" + ")} → ${l.produces.join(", ") || "?"}${l.manaNeeded ? ` (${l.manaNeeded})` : ""}`).join("\n")
  );
}

export const ANALYSIS_INSTRUCTIONS =
  "You are a world-class Commander (EDH) deck analyst. You are given a decklist, a rubric-based Score with " +
  "all of its working, the combo lines a database found, and possibly the player's own notes about the deck. " +
  "Write the analysis a strong pilot would hand a friend who is about to play the deck for the first time.\n\n" +
  "Ground everything in the list. Name real cards from the decklist, by their exact printed names, and never " +
  "invent a card, a combo, or an interaction that is not in front of you. Where the Score's working and your " +
  "reading disagree, say so plainly in the axis notes — the working is counted from card text and can misread a card.\n\n" +
  "The document:\n" +
  "- overview: 3–5 sentences. What the deck is, how it wins, what it leans on.\n" +
  "- strategy: 3–6 numbered steps of the core game plan, each naming the cards that do the work.\n" +
  "- mulligan: 2–4 lines on what a keepable hand needs and what to ship.\n" +
  "- keyCards: 5–8 cards, each with one sentence on the job it does.\n" +
  "- tips: 3–6 practical lines — sequencing, what to hold up, when to commit, political reads.\n" +
  "- weaknesses: critical (things that beat the deck outright) and minor (annoyances). 1–3 each, each naming the kind of card or play.\n" +
  "- axes: one note per axis (consistency, resilience, interaction, speed): one or two sentences reading the number against the deck — what it gets right, what it misses, what the player would change to move it.\n\n" +
  "The judgement. The rubric leaves two calls to a reader, and you make them:\n" +
  "- fundamentalTurn: the turn this deck takes its first player out of the game in at least half of its games with no disruption. " +
  "Start from the computed turn (a goldfish simulation that does not model reanimation, cost reducers, cheating threats " +
  "into play, extra turns, or the player's notes). Move it only when the list or the notes give a concrete reason — " +
  "a Sneak Attack package, a wheel-into-storm turn, a voltron commander with equipment the goldfish undercounts — and " +
  "say the reason. If torn, take the slower turn. Whole or half turns.\n" +
  "- commanderDependency: none (80%+ capacity with the commander never cast), moderate (the format default), or high " +
  "(the engine, win condition, or mana base lives in the command zone). Say why.\n\n" +
  "Plain language. Short sentences. No headings inside strings, no markdown, no card links — the app renders the names.";

/** The user turn: the deck, the working, the combos, the notes. */
export function buildAnalysisPrompt(cards: ScoredCard[], report: DeckScoreReport, lines: ComboLineInput[], notes: string | null): string {
  const trimmedNotes = (notes ?? "").trim().slice(0, MAX_NOTES_CHARS);
  return [
    "DECKLIST\n" + decklistBlock(cards),
    "\nSCORE AND WORKING\n" + scoreBlock(report),
    "\n" + combosBlock(lines),
    trimmedNotes
      ? "\nPLAYER'S NOTES (what they say the deck does — weigh it, but the list is the evidence)\n" + trimmedNotes
      : "\nPLAYER'S NOTES: none.",
  ].join("\n");
}

const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim()).slice(0, max) : [];

/** Validate the model's JSON into the shape the clients store; null if unusable. */
export function parseAnalysis(raw: unknown): AnalysisOutput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const a = r.analysis as Record<string, unknown> | undefined;
  const j = r.judgement as Record<string, unknown> | undefined;
  if (!a || typeof a.overview !== "string" || !a.overview.trim()) return null;
  const weaknesses = (a.weaknesses ?? {}) as Record<string, unknown>;
  const axes = Array.isArray(a.axes)
    ? a.axes
        .filter((x): x is { key: string; note: string } => !!x && typeof x === "object" && typeof (x as { key?: unknown }).key === "string" && typeof (x as { note?: unknown }).note === "string")
        .filter((x) => AXIS_KEYS.includes(x.key))
        .map((x) => ({ key: x.key as AnalysisDocument["axes"][number]["key"], note: x.note.trim() }))
    : [];
  const keyCards = Array.isArray(a.keyCards)
    ? a.keyCards
        .filter((x): x is { name: string; why: string } => !!x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string" && typeof (x as { why?: unknown }).why === "string")
        .map((x) => ({ name: x.name.trim(), why: x.why.trim() }))
        .slice(0, 10)
    : [];
  const dependency = j?.commanderDependency;
  const turn = Number(j?.fundamentalTurn);
  return {
    analysis: {
      overview: a.overview.trim(),
      strategy: strings(a.strategy, 8),
      mulligan: strings(a.mulligan, 6),
      keyCards,
      tips: strings(a.tips, 8),
      weaknesses: { critical: strings(weaknesses.critical, 4), minor: strings(weaknesses.minor, 4) },
      axes,
    },
    judgement: {
      fundamentalTurn: Number.isFinite(turn) ? turn : NaN,
      turnReason: typeof j?.turnReason === "string" ? j.turnReason.trim() : "",
      commanderDependency: dependency === "none" || dependency === "high" ? dependency : "moderate",
      dependencyReason: typeof j?.dependencyReason === "string" ? j.dependencyReason.trim() : "",
    },
  };
}

/** The model's calls as a Judgement — the report clamps them to bounds. */
export function judgementFrom(out: AnalysisOutput, computedTurn: number): Judgement {
  const j: Judgement = {};
  if (Number.isFinite(out.judgement.fundamentalTurn)) {
    const delta = out.judgement.fundamentalTurn - computedTurn;
    if (delta !== 0) {
      j.turnDelta = delta;
      j.turnReason = out.judgement.turnReason || undefined;
    }
  }
  j.commanderDependency = out.judgement.commanderDependency;
  j.dependencyReason = out.judgement.dependencyReason || undefined;
  return j;
}
