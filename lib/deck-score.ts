// The deck Score — Consistency, Resilience, Interaction and Speed, averaged
// into one number on a 1–10 scale.
//
// The rubric is DeckCheck's published CRISPI framework
// (https://deckcheck.co/blog/crispi-deep-dive, July 2026 recalibration).
// DeckCheck publishes it deliberately — "you could sit down with your
// decklist, a calculator, and the rubrics below to assign your own exact
// score" — and this module is that calculator. The scoring system is theirs;
// the code, the card reading and the goldfish are ours, which is why the
// number carries our name rather than theirs.
//
// This file is the ARITHMETIC only: ladders and their interpolation, the joint
// requirement rule where the weaker column binds, the premium and answer-scope
// gates, the board-wipe cap, the combat / voltron / stax / answer-density rows
// of Resilience, the Speed table and its coupling, quarter-point snapping, and
// the bracket floors. Every number here is transcribed from the rubric and
// covered by tests. Turning a decklist into these inputs is
// lib/deck-score-classify.ts; the fundamental turn comes from lib/goldfish.ts.

export type CommanderDependency = "none" | "moderate" | "high";

/** A ladder anchor: a total, and the score a deck ON that total reads. */
type Anchor = readonly [total: number, reads: number];

/**
 * Read a total against a ladder, interpolating linearly between anchors.
 *
 * "A total ON an anchor reads that score; totals between anchors interpolate
 * linearly." Below the first anchor reads the first score; at or above the last
 * reads the last.
 */
export function readLadder(total: number, anchors: readonly Anchor[]): number {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (!first || !last) return 0;
  if (total <= first[0]) return first[1];
  if (total >= last[0]) return last[1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const lo = anchors[i];
    const hi = anchors[i + 1];
    if (!lo || !hi) break;
    if (total >= lo[0] && total <= hi[0]) {
      const span = hi[0] - lo[0];
      if (span === 0) return hi[1];
      return lo[1] + ((total - lo[0]) / span) * (hi[1] - lo[1]);
    }
  }
  return last[1];
}

/**
 * Snap to the quarter-point grid the whole scale is built on.
 *
 * "Exact midpoints round up" — an eighth lands on the higher quarter. JS
 * `Math.round` already rounds .5 away from zero for positives, and every score
 * here is positive, so it is the rule rather than an approximation of it.
 */
export function snapQuarter(score: number): number {
  return Math.round(score * 4) / 4;
}

/** Clamp into the 1–10 the whole scale lives on. */
function clampScore(score: number): number {
  return Math.min(10, Math.max(1, score));
}

// ---------------------------------------------------------------------------
// Consistency
// ---------------------------------------------------------------------------

/**
 * The tutor ladder — "0 pts → 3.5 · 12 → 4.5 · 20 → 5.5 · 24 → 6.25 · 32 → 7 ·
 * 44 → 8 · 56 → 9 · 68+ → 10".
 *
 * This one spans the whole scale on purpose: per the rubric, "search access is
 * what actually separates deck classes", and a tutorless deck reads 3.5 here
 * however good its draw suite is.
 */
export const TUTOR_LADDER: readonly Anchor[] = [
  [0, 3.5], [12, 4.5], [20, 5.5], [24, 6.25], [32, 7], [44, 8], [56, 9], [68, 10],
];

/**
 * The draw column is a TABLE of bands, not a ladder — the rubric gives ranges
 * ("36–39 pts" → 8), so a total inside a band reads that band's score flat.
 * The two banded rows ("3–4" and "1–2") take their midpoint.
 */
export function drawColumnScore(points: number): number {
  if (points >= 60) return 10;
  if (points >= 40) return 9;
  if (points >= 36) return 8;
  if (points >= 32) return 7;
  if (points >= 24) return 6;
  if (points >= 20) return 5;
  if (points >= 12) return 3.5;
  return 1.5;
}

export interface ConsistencyInput {
  /** Total draw-engine points, commander bonuses already folded in. */
  drawPoints: number;
  /** Total tutor points, commander bonuses and redundancy already folded in. */
  tutorPoints: number;
  /** Premium-tier (6-point) tutors; a tutor commander counts as one. */
  premiumTutors: number;
  /**
   * Whether the tutor total leans on the Tribal/Synergy redundancy bonus.
   * Redundancy lifts the tutor column at most to a 7 — "the rows above require
   * real tutors" — and the cap is waived once there are 2+ premium tutors.
   */
  leansOnRedundancy?: boolean;
  /**
   * Command-Zone Engine: "a commander that IS the engine lifts a Consistency
   * column by up to two rows, to at most a 9". An access engine (a repeatable
   * battlefield tutor or selection dig) lifts whichever column reads lower; a
   * volume engine (a repeatable draw commander) lifts the draw column only.
   */
  commandZoneEngine?: "access" | "volume" | null;
  /** Mana Reliability modifier, already computed. Penalty-only, capped at −2. */
  manaReliability?: number;
}

export interface ConsistencyReading {
  score: number;
  drawColumn: number;
  tutorColumn: number;
}

export function consistencyReading(input: ConsistencyInput): ConsistencyReading {
  let draw = drawColumnScore(input.drawPoints);
  let tutor = readLadder(input.tutorPoints, TUTOR_LADDER);

  // "Redundancy lifts the tutor column at most to a 7 … waived for decks that
  // already run a real premium search suite."
  if (input.leansOnRedundancy && input.premiumTutors < 2) tutor = Math.min(tutor, 7);

  // Command-zone engine lift: up to two rows, never past 9, and "the other
  // column still binds".
  if (input.commandZoneEngine === "volume") {
    draw = Math.max(draw, Math.min(9, draw + 2));
  } else if (input.commandZoneEngine === "access") {
    if (draw <= tutor) draw = Math.max(draw, Math.min(9, draw + 2));
    else tutor = Math.max(tutor, Math.min(9, tutor + 2));
  }

  // Joint requirement: "a score is earned only when BOTH totals qualify, so
  // whichever column is weaker holds the score down."
  let score = Math.min(draw, tutor);

  // Premium gate: rows 9–10 need 2+ premium-tier tutors. "Volume alone is not
  // an elite search suite — ten standard tutors make a very good column, and it
  // caps at 8."
  if (input.premiumTutors < 2) score = Math.min(score, 8);

  const mana = Math.max(-2, Math.min(0, input.manaReliability ?? 0));
  return {
    score: clampScore(snapQuarter(score + mana)),
    drawColumn: snapQuarter(draw),
    tutorColumn: snapQuarter(tutor),
  };
}

export function consistencyScore(input: ConsistencyInput): number {
  return consistencyReading(input).score;
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

/** Piece-count ladder: 0 3 6 10 14 18 22 26+ → 1 3 4.5 5.5 6.25 7 8.5 10. */
export const INTERACTION_COUNT_LADDER: readonly Anchor[] = [
  [0, 1], [3, 3], [6, 4.5], [10, 5.5], [14, 6.25], [18, 7], [22, 8.5], [26, 10],
];

/** Stack/timing ladder: 0 6 10 14 20 28 38 45 52+ → 3.5 4.75 5.75 6.5 7.5 8.25 9 9.5 10. */
export const STACK_POINTS_LADDER: readonly Anchor[] = [
  [0, 3.5], [6, 4.75], [10, 5.75], [14, 6.5], [20, 7.5], [28, 8.25], [38, 9], [45, 9.5], [52, 10],
];

export interface InteractionInput {
  /** Unweighted count of every interactive card. The command zone counts. */
  pieces: number;
  /** Stack/Timing points — counters, free spells, turn protection, instants, hard wipes. */
  stackPoints: number;
  /** Which of creatures / artifacts / enchantments the suite can actually touch. */
  answersCreatures: boolean;
  answersArtifacts: boolean;
  answersEnchantments: boolean;
  /** A real counterspell suite (4+) permits every row regardless of scope. */
  counterspells: number;
  /** Symmetric board wipes the deck relies on; 3+ caps the score at 7. */
  symmetricWipes: number;
}

/**
 * The answer-scope ceiling: "All three — or a real counterspell suite of 4+
 * counters — permits every row; creatures plus one other class permits up to 8;
 * creature-only permits up to 7."
 */
export function answerScopeCap(input: InteractionInput): number {
  if (input.counterspells >= 4) return 10;
  const others = Number(input.answersArtifacts) + Number(input.answersEnchantments);
  if (input.answersCreatures && others === 2) return 10;
  if (input.answersCreatures && others === 1) return 8;
  if (input.answersCreatures) return 7;
  // A suite that cannot touch creatures at all is not a row the table covers;
  // read it at the creature-only ceiling rather than inventing a lower one.
  return others > 0 ? 7 : 1;
}

export interface InteractionReading {
  score: number;
  countColumn: number;
  stackColumn: number;
  scopeCap: number;
}

export function interactionReading(input: InteractionInput): InteractionReading {
  const byCount = readLadder(input.pieces, INTERACTION_COUNT_LADDER);
  const byStack = readLadder(input.stackPoints, STACK_POINTS_LADDER);
  const scopeCap = answerScopeCap(input);

  // Joint requirement again — "all must qualify, and the weakest binds".
  let score = Math.min(byCount, byStack, scopeCap);

  // Board Wipe Cap: 3+ symmetric wipes and the score cannot exceed 7.
  if (input.symmetricWipes >= 3) score = Math.min(score, 7);

  return {
    score: clampScore(snapQuarter(score)),
    countColumn: snapQuarter(byCount),
    stackColumn: snapQuarter(byStack),
    scopeCap,
  };
}

export function interactionScore(input: InteractionInput): number {
  return interactionReading(input).score;
}

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

/** The Speed row a whole-number fundamental turn reads. */
function speedRow(turn: number): number {
  if (turn <= 2) return 10;
  if (turn === 3) return 9;
  if (turn === 4) return 8;
  if (turn === 5) return 7;
  if (turn === 6) return 6;
  if (turn === 7) return 5;
  if (turn <= 9) return 4;
  if (turn <= 11) return 3;
  if (turn <= 13) return 2;
  return 1;
}

/**
 * Fundamental turn → Speed. "One turn is worth a full point where the game is
 * fastest … so the fast rows are single turns and the tail rows blend."
 *
 * A fractional turn reads the half-step between rows, which is how the rubric
 * describes a deck that genuinely straddles two turns ("a 7.5 means eliminates
 * a player on turn 4 or 5, depending on the draw").
 */
export function speedFromFundamentalTurn(turn: number): number {
  if (!Number.isFinite(turn)) return 1;
  if (turn <= 2) return 10;
  if (turn >= 14) return 1;
  const whole = Math.floor(turn);
  const frac = turn - whole;
  if (frac === 0) return speedRow(whole);
  // Straddling two turns lands on the half-step between their rows.
  return snapQuarter(speedRow(whole) + frac * (speedRow(whole + 1) - speedRow(whole)));
}

// ---------------------------------------------------------------------------
// Resilience
// ---------------------------------------------------------------------------

/** The combat / value channel — the rows the rubric calls "the combat rows". */
export interface CombatInput {
  /** Effective threats — vanilla beatsticks already weighed at half. */
  threats: number;
  /** Real protection CARDS (rows 8–9 count only these). */
  protectionCards: number;
  /** Protection including the per-3 self-protecting and deathtouch bonuses (rows ≤ 6). */
  protectionEffective: number;
  /** Recursion points, heavy-draw recovery already folded in. */
  recursionPoints: number;
  /** Rebuild engines — repeatable / mass / token / flicker pieces, sticky bodies per 3, a recursion commander. */
  rebuildEngines: number;
  /** Board-level protection effects: player grants, team grants, fogs, phasing, mass blink. */
  boardLevelProtection: number;
}

/**
 * Read the combat rows. "The rows demand STRUCTURE, not just totals."
 *
 *   9 — 12+ threats, 8+ real protection, 12+ recursion pts with 4+ engines, 3+ board-level
 *   8 — 12+ threats, 6+ real protection, 10+ recursion pts with 3+ engines, 2+ board-level
 *   6 — 10+ threats, 4+ protection, 8+ recursion pts with 2+ engines, 1+ board-level
 *   5 — 8+ threats, 2+ protection, 4+ recursion pts
 *   4.5 — 6+ threats, 1+ protection, 2+ recursion pts
 *   3.5 — 3+ threats
 *   2.5 — otherwise
 */
export function combatChannelScore(c: CombatInput): number {
  const { threats, protectionCards, protectionEffective, recursionPoints, rebuildEngines, boardLevelProtection } = c;
  if (threats >= 12 && protectionCards >= 8 && recursionPoints >= 12 && rebuildEngines >= 4 && boardLevelProtection >= 3) return 9;
  if (threats >= 12 && protectionCards >= 6 && recursionPoints >= 10 && rebuildEngines >= 3 && boardLevelProtection >= 2) return 8;
  if (threats >= 10 && protectionEffective >= 4 && recursionPoints >= 8 && rebuildEngines >= 2 && boardLevelProtection >= 1) return 6;
  if (threats >= 8 && protectionEffective >= 2 && recursionPoints >= 4) return 5;
  if (threats >= 6 && protectionEffective >= 1 && recursionPoints >= 2) return 4.5;
  if (threats >= 3) return 3.5;
  return 2.5;
}

/** The stax path: 4 pieces read a 4, 6 a 5, 8+ a 6. Capped at 6. */
export function staxChannelScore(pieces: number): number {
  if (pieces >= 8) return 6;
  if (pieces >= 6) return 5;
  if (pieces >= 4) return 4;
  return 0;
}

/** The Voltron path: 6+ equipment with 3+ protection reads a 6; 10+ with 5+ reads a 7. */
export function voltronChannelScore(equipment: number, protection: number): number {
  if (equipment >= 10 && protection >= 5) return 7;
  if (equipment >= 6 && protection >= 3) return 6;
  return 0;
}

/** The answer-density path: 13+/5+/32+ reads a 6; 16+/8+/40+ reads a 7. */
export function answerDensityChannelScore(pieces: number, counterspells: number, drawPoints: number): number {
  if (pieces >= 16 && counterspells >= 8 && drawPoints >= 40) return 7;
  if (pieces >= 13 && counterspells >= 5 && drawPoints >= 32) return 6;
  return 0;
}

export interface ResilienceInput {
  /**
   * Combo lines that actually produce a win or an infinite engine. Lines
   * sharing a single point of failure count 1.5, clunky lines count half.
   * Assembly-adjusted here, not by the caller.
   */
  comboLines: number;
  /** Tutor points, for the assembly adjustment. */
  tutorPoints: number;
  /** A battlefield-tutor commander is guaranteed access by definition. */
  battlefieldTutorCommander?: boolean;
  /** Stax pieces, for the stax path. */
  staxPieces?: number;
  /** Stack-protection suite of 5+ adds +0.5 to the combo channel (and to a commander-threat plan). */
  stackProtectionPieces?: number;
  /** The combat rows' inputs. */
  combat?: CombatInput;
  /** Equipment count, for the Voltron path. */
  equipment?: number;
  /** Interaction pieces, counterspells and draw points, for the answer-density path. */
  interactionPieces?: number;
  counterspells?: number;
  drawPoints?: number;
  /** Engine Exposure modifier — penalty-only, capped at −2. */
  engineExposure?: number;
  commanderDependency: CommanderDependency;
}

/**
 * Assembly adjustment: "Line credit scales with tutor access — full credit at
 * 24+ tutor points (or a battlefield-tutor commander), ×0.75 at 12–23, ×0.5
 * below 12."
 */
export function assemblyMultiplier(tutorPoints: number, battlefieldTutorCommander = false): number {
  if (battlefieldTutorCommander || tutorPoints >= 24) return 1;
  if (tutorPoints >= 12) return 0.75;
  return 0.5;
}

/** The combo channel's row readings, including the assembly-discounted rows. */
export function comboChannelScore(lines: number): number {
  // Between the rows the read interpolates, the way the other ladders do:
  // 2.25 lines read 9.25, not 9.
  if (lines >= 3) return 10;
  if (lines >= 2) return 9 + (lines - 2);
  if (lines >= 1.5) return 8 + (lines - 1.5) * 2;
  if (lines >= 1) return 7 + (lines - 1) * 2;
  // "Assembly-discounted totals read below the rows above: 0.75 lines read a 5,
  // 0.5 lines a 3.5."
  if (lines >= 0.75) return 5;
  if (lines >= 0.5) return 3.5;
  return 0;
}

export interface ResilienceReading {
  score: number;
  /** Which channel carried the score. */
  channel: "combo" | "combat" | "stax" | "voltron" | "answers";
  comboChannel: number;
  combatChannel: number;
  staxChannel: number;
  voltronChannel: number;
  answerDensityChannel: number;
  /** Combo lines after the assembly adjustment. */
  effectiveLines: number;
}

export function resilienceReading(input: ResilienceInput): ResilienceReading {
  const multiplier = assemblyMultiplier(input.tutorPoints, input.battlefieldTutorCommander);
  const effectiveLines = input.comboLines * multiplier;
  let combo = comboChannelScore(effectiveLines);

  const combatBase = input.combat ? combatChannelScore(input.combat) : 0;
  let combat = combatBase;
  const stax = staxChannelScore(input.staxPieces ?? 0);
  const voltron = voltronChannelScore(input.equipment ?? 0, input.combat?.protectionEffective ?? 0);
  const answers = answerDensityChannelScore(
    input.interactionPieces ?? 0,
    input.counterspells ?? 0,
    input.drawPoints ?? 0
  );

  const stackSuite = (input.stackProtectionPieces ?? 0) >= 5;
  // "A stack-protection suite of 5+ pieces adds +0.5 to the combo channel."
  if (combo > 0 && stackSuite) combo += 0.5;
  // "The same suite defends a threat plan: a commander-threat deck with a real
  // threat base and 5+ stack-protection pieces adds +0.5 to the combat channel."
  if (combatBase >= 5 && stackSuite) combat += 0.5;

  // "A single line with no other real win path — no combat plan, no stax or
  // control inevitability reading at least a 5 — is a one-trick deck and caps
  // at 6."
  const hasBackup = combatBase >= 5 || stax >= 5 || voltron >= 5 || answers >= 5;
  if (input.comboLines < 2 && !hasBackup) combo = Math.min(combo, 6);

  const channels: [ResilienceReading["channel"], number][] = [
    ["combo", combo],
    ["combat", combat],
    ["stax", stax],
    ["voltron", voltron],
    ["answers", answers],
  ];
  let best = channels[0]!;
  for (const c of channels) if (c[1] > best[1]) best = c;

  let score = Math.max(best[1], 2.5);

  const exposure = Math.max(-2, Math.min(0, input.engineExposure ?? 0));
  score += exposure;

  // Commander Dependency Penalty — "Moderate is the format default".
  if (input.commanderDependency === "moderate") score -= 1;
  else if (input.commanderDependency === "high") score -= 2;

  return {
    score: clampScore(snapQuarter(score)),
    channel: best[0],
    comboChannel: combo,
    combatChannel: combat,
    staxChannel: stax,
    voltronChannel: voltron,
    answerDensityChannel: answers,
    effectiveLines,
  };
}

export function resilienceScore(input: ResilienceInput): number {
  return resilienceReading(input).score;
}

// ---------------------------------------------------------------------------
// The composite, and the bracket floors
// ---------------------------------------------------------------------------

export interface AxisScores {
  consistency: number;
  resilience: number;
  interaction: number;
  speed: number;
}

export interface DeckScoreResult extends AxisScores {
  /** The index: the simple average of the four, snapped to the same grid. */
  index: number;
  /** Two decimal places, the way the score is displayed. */
  display: string;
}

/**
 * Score = (Speed + Consistency + Interaction + Resilience) / 4.
 *
 * The Speed/Consistency coupling applies first: "If your calculated Speed score
 * is 9 or 10, check your Consistency score. If Consistency is 7 or lower, Speed
 * is capped at a maximum of 8."
 */
export function deckScore(scores: AxisScores): DeckScoreResult {
  const speed = scores.speed >= 9 && scores.consistency <= 7 ? 8 : scores.speed;
  const index = snapQuarter((speed + scores.consistency + scores.interaction + scores.resilience) / 4);
  return {
    ...scores,
    speed,
    index,
    display: index.toFixed(2),
  };
}

/**
 * The bracket guardrails.
 *
 * These only ever bump a deck UP — "no one finds issue with the person playing
 * a weak deck that does nothing all game" — so the official rules-based bracket
 * goes in and the higher of the two comes out.
 *
 * Half-step Speed ratings get the benefit of the doubt: an 8.5 is counted as
 * the slower of its two turns, so it trips the Bracket 4 floor but not Bracket
 * 5's. Flooring the Speed rating is exactly that rule.
 */
export function bracketFloor(result: DeckScoreResult, rulesBracket: number): number {
  const speed = Math.floor(result.speed);
  const { index, consistency, interaction } = result;

  let floor = 1;
  if (speed >= 5 || index >= 3.5) floor = 2;
  if (speed >= 6 || index >= 5.0) floor = 3;
  if (speed >= 8 || index >= 7.0 || (consistency >= 7.5 && interaction >= 7.5)) floor = 4;
  if (speed >= 9 || index >= 8.5) floor = 5;

  return Math.max(rulesBracket, floor);
}

/** The rubric's one-word descriptor for each axis row. */
export function describe(axis: keyof AxisScores, score: number): string {
  const row = Math.floor(score);
  switch (axis) {
    case "consistency":
      if (row >= 10) return "Deterministic";
      if (row === 9) return "Highly consistent";
      if (row === 8) return "Streamlined";
      if (row === 7) return "Focused";
      if (row === 6) return "Synergistic";
      if (row === 5) return "Baseline casual";
      if (row >= 3) return "Inconsistent";
      return "Unfocused";
    case "resilience":
      if (row >= 10) return "Inevitable";
      if (row === 9) return "Highly resilient";
      if (row === 8) return "Durable";
      if (row === 7) return "Sturdy";
      if (row === 6) return "Average";
      if (row === 5) return "Baseline";
      if (score >= 4.5) return "Thin";
      if (score >= 3.5) return "Fragile";
      return "Glass";
    case "interaction":
      if (row >= 9) return "Stack-dominant";
      if (row === 8) return "Instant-speed suite";
      if (row === 7) return "Well covered";
      if (row === 6) return "Solid";
      if (row === 5) return "Sorcery-speed";
      if (row >= 3) return "Light";
      return "Unarmed";
    case "speed":
      if (row >= 10) return "Peak turbo";
      if (row === 9) return "cEDH optimal";
      if (row === 8) return "Fringe cEDH / apex casual";
      if (row === 7) return "Optimized casual";
      if (row === 6) return "Tuned casual";
      if (row === 5) return "Baseline casual";
      if (row === 4) return "Battlecruiser";
      if (row === 3) return "Battlecruiser tail";
      if (row === 2) return "Unfocused";
      return "Meme-tier clock";
  }
}
