// CRISPI — Consistency, Resilience, Interaction, Speed → Performance Index.
//
// An implementation of DeckCheck's published CRISPI rubrics
// (https://deckcheck.co/blog/crispi-deep-dive). DeckCheck publishes the rubrics
// deliberately — "you could sit down with your decklist, a calculator, and the
// rubrics below to assign your own exact CRISPI score" — and this module is
// that calculator. The scoring system is theirs; only the code is ours.
//
// WHAT IS FAITHFUL HERE: the arithmetic. Ladder anchors and their linear
// interpolation, the joint-requirement rule where the weaker column binds, the
// premium gate, the answer-scope gate, the board-wipe cap, the Speed table, the
// Speed/Consistency coupling, quarter-point snapping with midpoints rounding
// up, and the bracket floors including the half-step benefit-of-the-doubt rule.
// Those are transcribed from the rubrics and covered by tests.
//
// WHAT IS NOT: which cards count as what. DeckCheck scores against a curated
// card database. We classify from Scryfall text plus the named cards the
// rubrics themselves cite, which will disagree at the margins — a tutor we
// don't recognise is a tutor we don't count. Treat a score from here as our
// reading of the rubrics, not as a number DeckCheck would print.
//
// THE TWO JUDGEMENTS: the rubrics leave exactly two calls to a human or an AI
// — the deck's fundamental turn, and how commander-dependent it is. Neither is
// derivable from a decklist by counting, so both are INPUTS here rather than
// guesses. Resilience's combo-line count is a third: it needs a combo database
// this repo does not have yet, so it too is supplied by the caller.

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
  if (!anchors.length) return 0;
  if (total <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (total >= last[0]) return last[1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [lo, loReads] = anchors[i];
    const [hi, hiReads] = anchors[i + 1];
    if (total >= lo && total <= hi) {
      const span = hi - lo;
      if (span === 0) return hiReads;
      return loReads + ((total - lo) / span) * (hiReads - loReads);
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
  /** Total tutor points, commander bonuses already folded in. */
  tutorPoints: number;
  /** Premium-tier (6-point) tutors; a tutor commander counts as one. */
  premiumTutors: number;
  /**
   * Whether the tutor total leans on the Tribal/Synergy redundancy bonus.
   * Redundancy lifts the tutor column at most to a 7 — "the rows above require
   * real tutors" — and the cap is waived once there are 2+ premium tutors.
   */
  leansOnRedundancy?: boolean;
  /** Mana Reliability modifier, already computed. Penalty-only, capped at −2. */
  manaReliability?: number;
}

export function consistencyScore(input: ConsistencyInput): number {
  const draw = drawColumnScore(input.drawPoints);
  let tutor = readLadder(input.tutorPoints, TUTOR_LADDER);

  // "Redundancy lifts the tutor column at most to a 7 … waived for decks that
  // already run a real premium search suite."
  if (input.leansOnRedundancy && input.premiumTutors < 2) tutor = Math.min(tutor, 7);

  // Joint requirement: "a score is earned only when BOTH totals qualify, so
  // whichever column is weaker holds the score down."
  let score = Math.min(draw, tutor);

  // Premium gate: rows 9–10 need 2+ premium-tier tutors. "Volume alone is not
  // an elite search suite — ten standard tutors make a very good column, and it
  // caps at 8."
  if (input.premiumTutors < 2) score = Math.min(score, 8);

  const mana = Math.max(-2, Math.min(0, input.manaReliability ?? 0));
  return clampScore(snapQuarter(score + mana));
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

export function interactionScore(input: InteractionInput): number {
  const byCount = readLadder(input.pieces, INTERACTION_COUNT_LADDER);
  const byStack = readLadder(input.stackPoints, STACK_POINTS_LADDER);

  // Joint requirement again — "all must qualify, and the weakest binds".
  let score = Math.min(byCount, byStack, answerScopeCap(input));

  // Board Wipe Cap: 3+ symmetric wipes and the score cannot exceed 7.
  if (input.symmetricWipes >= 3) score = Math.min(score, 7);

  return clampScore(snapQuarter(score));
}

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

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
  const at = (t: number): number => {
    if (t <= 2) return 10;
    if (t === 3) return 9;
    if (t === 4) return 8;
    if (t === 5) return 7;
    if (t === 6) return 6;
    if (t === 7) return 5;
    if (t <= 9) return 4;
    if (t <= 11) return 3;
    if (t <= 13) return 2;
    return 1;
  };
  if (frac === 0) return at(whole);
  // Straddling two turns lands on the half-step between their rows.
  return snapQuarter(at(whole) + frac * (at(whole + 1) - at(whole)));
}

// ---------------------------------------------------------------------------
// Resilience
// ---------------------------------------------------------------------------

export interface ResilienceInput {
  /**
   * Combo lines that actually produce a win or an infinite engine. Lines
   * sharing a single point of failure count 1.5, clunky lines count half.
   * Needs a combo database, so the caller supplies it.
   */
  comboLines: number;
  /** Tutor points, for the assembly adjustment. */
  tutorPoints: number;
  /** A battlefield-tutor commander is guaranteed access by definition. */
  battlefieldTutorCommander?: boolean;
  /** Alternative inevitability paths, each with its own ceiling. */
  staxPieces?: number;
  /** Stack-protection suite of 5+ adds +0.5 to the combo channel. */
  stackProtectionPieces?: number;
  /** A floor from the combat/voltron/answer-density rows, if the caller read one. */
  combatChannel?: number;
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
function comboChannelScore(lines: number): number {
  if (lines >= 3) return 10;
  if (lines >= 2) return 9;
  if (lines >= 1.5) return 8;
  if (lines >= 1) return 7;
  // "Assembly-discounted totals read below the rows above: 0.75 lines read a 5,
  // 0.5 lines a 3.5."
  if (lines >= 0.75) return 5;
  if (lines >= 0.5) return 3.5;
  return 0;
}

/** The stax path: 4 pieces read a 4, 6 a 5, 8+ a 6. Capped at 6. */
function staxChannelScore(pieces: number): number {
  if (pieces >= 8) return 6;
  if (pieces >= 6) return 5;
  if (pieces >= 4) return 4;
  return 0;
}

export function resilienceScore(input: ResilienceInput): number {
  const multiplier = assemblyMultiplier(input.tutorPoints, input.battlefieldTutorCommander);
  let combo = comboChannelScore(input.comboLines * multiplier);

  // A stack-protection suite of 5+ adds +0.5 to the combo channel.
  if (combo > 0 && (input.stackProtectionPieces ?? 0) >= 5) combo += 0.5;

  // "A single line with no other real win path … is a one-trick deck and caps
  // at 6." A backup path means a combat channel reading at least 5, or stax.
  const stax = staxChannelScore(input.staxPieces ?? 0);
  const combat = input.combatChannel ?? 0;
  const hasBackup = combat >= 5 || stax >= 5;
  if (input.comboLines < 2 && !hasBackup) combo = Math.min(combo, 6);

  let score = Math.max(combo, stax, combat);

  const exposure = Math.max(-2, Math.min(0, input.engineExposure ?? 0));
  score += exposure;

  // Commander Dependency Penalty — "Moderate is the format default".
  if (input.commanderDependency === "moderate") score -= 1;
  else if (input.commanderDependency === "high") score -= 2;

  return clampScore(snapQuarter(score));
}

// ---------------------------------------------------------------------------
// The composite, and the bracket floors
// ---------------------------------------------------------------------------

export interface CrispiScores {
  consistency: number;
  resilience: number;
  interaction: number;
  speed: number;
}

export interface CrispiResult extends CrispiScores {
  /** The Performance Index: the simple average, snapped to the same grid. */
  crispi: number;
  /** Two decimal places, the way the score is displayed. */
  display: string;
}

/**
 * CRISPI Score = (Speed + Consistency + Interaction + Resilience) / 4.
 *
 * The Speed/Consistency coupling applies first: "If your calculated Speed score
 * is 9 or 10, check your Consistency score. If Consistency is 7 or lower, Speed
 * is capped at a maximum of 8."
 */
export function crispiScore(scores: CrispiScores): CrispiResult {
  const speed = scores.speed >= 9 && scores.consistency <= 7 ? 8 : scores.speed;
  const crispi = snapQuarter((speed + scores.consistency + scores.interaction + scores.resilience) / 4);
  return {
    ...scores,
    speed,
    crispi,
    display: crispi.toFixed(2),
  };
}

/**
 * The CRISPI bracket guardrails.
 *
 * These only ever bump a deck UP — "no one finds issue with the person playing
 * a weak deck that does nothing all game" — so the official rules-based bracket
 * goes in and the higher of the two comes out.
 *
 * Half-step Speed ratings get the benefit of the doubt: an 8.5 is counted as
 * the slower of its two turns, so it trips the Bracket 4 floor but not Bracket
 * 5's. Flooring the Speed rating is exactly that rule.
 */
export function bracketFloor(result: CrispiResult, rulesBracket: number): number {
  const speed = Math.floor(result.speed);
  const { crispi, consistency, interaction } = result;

  let floor = 1;
  if (speed >= 5 || crispi >= 3.5) floor = 2;
  if (speed >= 6 || crispi >= 5.0) floor = 3;
  if (speed >= 8 || crispi >= 7.0 || (consistency >= 7.5 && interaction >= 7.5)) floor = 4;
  if (speed >= 9 || crispi >= 8.5) floor = 5;

  return Math.max(rulesBracket, floor);
}
