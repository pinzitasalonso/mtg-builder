// Turning a decklist into the counts `lib/crispi.ts` consumes.
//
// READ THIS BEFORE TRUSTING A NUMBER FROM HERE.
//
// DeckCheck scores CRISPI against a curated card database — a human decided
// that Demonic Tutor is a premium tutor and Rhystic Study is a premium
// asymmetric engine. We have no such database. What we have is Scryfall's
// oracle text on each row, so this module reads text.
//
// That is enough for some questions and hopeless for others, and the split is
// not subtle:
//
//   DERIVABLE — "search your library" really does mean a tutor. "Counter
//   target spell" really is a counterspell. An Instant really is instant
//   speed. These are text facts, and reading them is honest.
//
//   NOT DERIVABLE — whether a tutor is PREMIUM (a rubric tier that depends on
//   mana value AND restriction AND what it can find), whether a deck has a
//   combo line (needs a combo database), the deck's fundamental turn, and how
//   commander-dependent it is. The last two the rubric itself hands to a human
//   or an AI.
//
// So every result carries `estimated` and `stubbed` lists naming which inputs
// were guessed and which were not computed at all. A caller that renders a
// score without surfacing those is lying to a player about a number that looks
// authoritative. The score is a placeholder until a real classifier lands.

import type { CommanderDependency, ConsistencyInput, InteractionInput, ResilienceInput } from "./crispi";

export interface ClassifiableCard {
  name: string;
  typeLine: string | null;
  oracleText: string | null;
  manaCost: string | null;
  quantity: number;
}

const has = (text: string | null, re: RegExp): boolean => (text ? re.test(text) : false);

const isLand = (c: ClassifiableCard): boolean => /\bLand\b/.test(c.typeLine ?? "");
const isInstant = (c: ClassifiableCard): boolean =>
  /\bInstant\b/.test(c.typeLine ?? "") || has(c.oracleText, /\bFlash\b/);

/** Mana value from a cost string like "{2}{U}{U}" — generic plus one per pip. */
export function manaValue(manaCost: string | null): number {
  if (!manaCost) return 0;
  let total = 0;
  for (const sym of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const body = sym[1];
    const n = Number.parseInt(body, 10);
    if (Number.isFinite(n)) total += n;
    else if (body !== "X" && body !== "Y" && body !== "Z") total += 1;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Text signals
// ---------------------------------------------------------------------------

/** "Search your library" is the tutor tell, and it is a reliable one. */
export const isTutor = (c: ClassifiableCard): boolean =>
  !isLand(c) && has(c.oracleText, /search your library/i);

export const isCounterspell = (c: ClassifiableCard): boolean =>
  has(c.oracleText, /counter target (?:spell|ability|activated|triggered)/i);

/**
 * Removal, sweepers, hate pieces, protection — anything that answers something.
 * Deliberately broad, because the rubric's Total Interaction is "an unweighted
 * count of ALL interactive cards".
 */
export const isInteraction = (c: ClassifiableCard): boolean => {
  if (isLand(c)) return false;
  if (isCounterspell(c)) return true;
  return has(
    c.oracleText,
    /\b(destroy target|exile target|destroy all|exile all|each opponent sacrifices|target player sacrifices|return target .* to (?:its owner's|their owner's) hand|gets? -\d|deals? \d+ damage to target|hexproof|indestructible|protection from|can't attack|counter target)\b/i
  );
};

/** Draw and selection. Not "each opponent draws" — that is a symmetric gift. */
export const isDrawish = (c: ClassifiableCard): boolean =>
  !isLand(c) &&
  has(c.oracleText, /\b(draw (?:a|two|three|\w+) cards?|scry \d|surveil \d|look at the top)\b/i) &&
  !has(c.oracleText, /each opponent draws/i);

/** A destroy/exile-all effect that hits every board, including yours. */
export const isSymmetricWipe = (c: ClassifiableCard): boolean =>
  has(c.oracleText, /\b(destroy all|exile all)\b/i) && !has(c.oracleText, /you control don't|except/i);

const answersCreatures = (c: ClassifiableCard): boolean =>
  has(c.oracleText, /\b(target creature|all creatures|each creature|creature an opponent controls)\b/i);
const answersArtifacts = (c: ClassifiableCard): boolean =>
  has(c.oracleText, /\b(target artifact|all artifacts|each artifact)\b/i);
const answersEnchantments = (c: ClassifiableCard): boolean =>
  has(c.oracleText, /\b(target enchantment|all enchantments|each enchantment)\b/i);

// ---------------------------------------------------------------------------
// The counts
// ---------------------------------------------------------------------------

export interface ClassificationNotes {
  /** Inputs derived from oracle text — real signal, wrong at the margins. */
  estimated: string[];
  /** Inputs not computed at all. These carry placeholder values. */
  stubbed: string[];
}

export interface Classification {
  consistency: ConsistencyInput;
  interaction: InteractionInput;
  resilience: ResilienceInput;
  /** Placeholder. The rubric hands this to a human or an AI. */
  fundamentalTurn: number;
  notes: ClassificationNotes;
  /** Handy for the caller, and cheap here. */
  averageManaValue: number;
  landCount: number;
}

/**
 * The one honest default for the two judgements the rubric reserves.
 *
 * Turn 7 is the rubric's own "Baseline Casual" row, and "moderate" is what it
 * calls "the format default". Picking the middle of the scale keeps a stubbed
 * score from flattering or libelling a deck while the real inputs are missing.
 */
const DEFAULT_FUNDAMENTAL_TURN = 7;
const DEFAULT_COMMANDER_DEPENDENCY: CommanderDependency = "moderate";

export function classify(cards: ClassifiableCard[]): Classification {
  const nonland = cards.filter((c) => !isLand(c));
  const copies = (c: ClassifiableCard) => Math.max(1, c.quantity);

  let tutors = 0;
  let drawSources = 0;
  let interactionPieces = 0;
  let counterspells = 0;
  let instantSpeedInteraction = 0;
  let freeSpells = 0;
  let symmetricWipes = 0;
  let scopeCreatures = false;
  let scopeArtifacts = false;
  let scopeEnchantments = false;
  let mvTotal = 0;
  let mvCount = 0;

  for (const c of cards) {
    if (isLand(c)) continue;
    const n = copies(c);
    const mv = manaValue(c.manaCost);
    mvTotal += mv * n;
    mvCount += n;

    if (isTutor(c)) tutors += n;
    if (isDrawish(c)) drawSources += n;
    if (isCounterspell(c)) counterspells += n;
    if (isSymmetricWipe(c)) symmetricWipes += n;

    if (isInteraction(c)) {
      interactionPieces += n;
      if (isInstant(c)) instantSpeedInteraction += n;
      // A 0-mana reactive spell is the rubric's "free interaction".
      if (mv === 0) freeSpells += n;
      if (answersCreatures(c)) scopeCreatures = true;
      if (answersArtifacts(c)) scopeArtifacts = true;
      if (answersEnchantments(c)) scopeEnchantments = true;
    }
  }

  // The rubric prices tutors and draw in POINTS per tier. With no tier
  // information, every tutor is priced as a standard one (4) and every draw
  // source as a standard repeatable engine (4). That is the middle of both
  // ladders, and it is the single biggest reason a score from here is
  // provisional: a cEDH suite and a precon pile price identically.
  const tutorPoints = tutors * 4;
  const drawPoints = drawSources * 4;

  // Stack/Timing: 2 per counterspell, 2 per free spell, 1 per instant-speed
  // piece. The rubric's turn-protection and hard-wipe tiers need card-level
  // judgement we do not have, so they are absent rather than approximated.
  const stackPoints = counterspells * 2 + freeSpells * 2 + instantSpeedInteraction;

  return {
    consistency: {
      drawPoints,
      tutorPoints,
      // The premium gate needs tiering. Reporting zero keeps Consistency
      // capped at 8, which is the honest ceiling for an untiered count.
      premiumTutors: 0,
    },
    interaction: {
      pieces: interactionPieces,
      stackPoints,
      answersCreatures: scopeCreatures,
      answersArtifacts: scopeArtifacts,
      answersEnchantments: scopeEnchantments,
      counterspells,
      symmetricWipes,
    },
    resilience: {
      // Needs a combo database. Zero, not a guess.
      comboLines: 0,
      tutorPoints,
      commanderDependency: DEFAULT_COMMANDER_DEPENDENCY,
    },
    fundamentalTurn: DEFAULT_FUNDAMENTAL_TURN,
    averageManaValue: mvCount > 0 ? mvTotal / mvCount : 0,
    landCount: cards.length - nonland.length,
    notes: {
      estimated: [
        "tutorPoints — every tutor priced as standard (4); no premium tier",
        "drawPoints — every draw source priced as a standard engine (4)",
        "interaction pieces and answer scope — from oracle text patterns",
        "stackPoints — counterspells, free spells and instant speed only",
      ],
      stubbed: [
        "premiumTutors — always 0, so Consistency cannot exceed 8",
        "comboLines — always 0; needs a combo database",
        `fundamentalTurn — always ${DEFAULT_FUNDAMENTAL_TURN} (the rubric's Baseline Casual)`,
        `commanderDependency — always "${DEFAULT_COMMANDER_DEPENDENCY}" (the rubric's format default)`,
        "Resilience's recursion, threat, protection and stax counts",
      ],
    },
  };
}
