// The Score, assembled: classification in, the payload both clients render out.
//
// Everything the page shows lives here so the web and iOS never disagree by a
// digit — the axes, the index, the descriptor per axis, the bracket floor, and
// the working under each axis: the counts the rubric read and the cards it
// counted. A number with no working is a verdict nobody can argue with; this
// one shows its hand.

import {
  bracketFloor,
  consistencyReading,
  deckScore,
  describe,
  interactionReading,
  resilienceReading,
  speedFromFundamentalTurn,
  type DeckScoreResult,
} from "./deck-score";
import { classify, manaValue, type CardReading, type ComboLineInput, type ScoredCard } from "./deck-score-classify";
import type { CommanderDependency } from "./deck-score";
import { goldfish, type GoldfishLine } from "./goldfish";
import { INFINITE_MANA_OUTLETS } from "./deck-score-cards";

export interface AxisReport {
  key: "consistency" | "resilience" | "interaction" | "speed";
  label: string;
  score: number;
  descriptor: string;
  /** One line of working, for the row under the score. */
  summary: string;
  /** The rest of the working, one line each. */
  facts: string[];
  /** The cards that were counted, grouped. */
  cards: { label: string; names: string[] }[];
}

export interface DeckScoreReport extends DeckScoreResult {
  /** Shown as "Score", trimmed of trailing zeros on the quarter grid. */
  label: string;
  bracketFloor: number;
  fundamentalTurn: number;
  commanderDependency: "none" | "moderate" | "high";
  axes: AxisReport[];
  /** What is estimated rather than counted, in plain words. */
  caveats: string[];
  cardsScored: number;
  /** Fraction of goldfish hands that had taken a player out by each turn (index = turn). */
  wonByTurn: number[];
  /** What the classifier read on each card. Calibration diffs this against DeckCheck. */
  cardReadings: Record<string, CardReading>;
}

const trim = (n: number): string => String(Number(n.toFixed(2)));
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Spellbook's "{U}{U}{B}" → 3; "" → 0; X → treated as expensive. */
function lineMana(manaNeeded: string): number {
  return manaValue(manaNeeded) + (manaNeeded.includes("X") ? 6 : 0);
}

/**
 * The two judgements the rubric leaves to a reader, applied on top of the
 * computed read — within bounds. The goldfish's turn can move by at most two
 * turns either way (it does not see reanimation, Show and Tell, or the
 * player's notes) and commander dependency by one step, and each carries the
 * reason it moved, which the working shows. Wider than that and the number
 * would be the judgement rather than the deck.
 */
export interface Judgement {
  /** Up to two turns either way on the goldfish's fundamental turn, on the half-turn grid. */
  turnDelta?: number;
  turnReason?: string;
  commanderDependency?: CommanderDependency;
  dependencyReason?: string;
}

const DEPENDENCY_ORDER: CommanderDependency[] = ["none", "moderate", "high"];

/** Clamp a judgement to its bounds against the computed read. */
export function boundJudgement(j: Judgement, computedDependency: CommanderDependency): Judgement {
  const out: Judgement = {};
  const delta = Number(j.turnDelta ?? 0);
  if (Number.isFinite(delta) && delta !== 0) {
    out.turnDelta = Math.max(-2, Math.min(2, Math.round(delta * 2) / 2));
    out.turnReason = j.turnReason;
  }
  if (j.commanderDependency && DEPENDENCY_ORDER.includes(j.commanderDependency) && j.commanderDependency !== computedDependency) {
    const from = DEPENDENCY_ORDER.indexOf(computedDependency);
    const to = DEPENDENCY_ORDER.indexOf(j.commanderDependency);
    const step = Math.max(-1, Math.min(1, to - from));
    out.commanderDependency = DEPENDENCY_ORDER[from + step];
    out.dependencyReason = j.dependencyReason;
  }
  return out;
}

export function scoreDeck(
  cards: ScoredCard[],
  lines: ComboLineInput[],
  rulesBracket = 1,
  judgement: Judgement = {}
): DeckScoreReport {
  const c = classify(cards, lines);
  const j = boundJudgement(judgement, c.resilience.commanderDependency);
  if (j.commanderDependency) c.resilience.commanderDependency = j.commanderDependency;

  const consistency = consistencyReading(c.consistency);
  const interaction = interactionReading(c.interaction);
  const resilience = resilienceReading(c.resilience);

  // Infinite mana is a kill when the deck holds something to pour it into.
  const outletsInDeck = cards.filter((c) => INFINITE_MANA_OUTLETS.has(c.name.toLowerCase())).map((c) => c.name);
  const goldfishLines: GoldfishLine[] = lines.map((l) => {
    const wins = l.produces.some((p) => /win the game|loses? the game|infinite (damage|lifeloss|life loss|mill|poison|combat)/i.test(p));
    const infiniteMana = l.produces.some((p) => /infinite (colorless |colou?red )?mana/i.test(p));
    if (wins) return { pieces: l.pieces, manaNeeded: lineMana(l.manaNeeded), lethal: true };
    if (infiniteMana && outletsInDeck.length) {
      return { pieces: l.pieces, manaNeeded: lineMana(l.manaNeeded), lethal: true, anyOf: outletsInDeck };
    }
    return { pieces: l.pieces, manaNeeded: lineMana(l.manaNeeded), lethal: false };
  });
  const fish = goldfish(c.reads, goldfishLines);
  const fundamentalTurn = Math.max(1, Math.min(14, fish.fundamentalTurn + (j.turnDelta ?? 0)));
  const speed = speedFromFundamentalTurn(fundamentalTurn);

  const result = deckScore({
    consistency: consistency.score,
    resilience: resilience.score,
    interaction: interaction.score,
    speed,
  });

  const groups = (...ids: string[]) =>
    ids.map((id) => c.groups[id]).filter((g): g is { label: string; names: string[] } => Boolean(g));

  const consistencyFacts: string[] = [
    `Draw column reads ${trim(consistency.drawColumn)} on ${c.consistency.drawPoints} draw points; tutor column reads ${trim(consistency.tutorColumn)} on ${c.consistency.tutorPoints} tutor points. The weaker column binds.`,
    c.consistency.premiumTutors >= 2
      ? `${plural(c.consistency.premiumTutors, "premium tutor")} — the 9 and 10 rows are open.`
      : `${plural(c.consistency.premiumTutors, "premium tutor")} — rows 9 and 10 need two, so the score caps at 8.`,
  ];
  if (c.redundancy.bonus > 0) consistencyFacts.push(`${c.redundancy.count} ${c.redundancy.subtype} add +${c.redundancy.bonus} tutor points as redundancy${c.consistency.leansOnRedundancy ? " (capped at a 7 without real search)" : ""}.`);
  if (c.consistency.commandZoneEngine) consistencyFacts.push(`The commander is a${c.consistency.commandZoneEngine === "access" ? "n access" : " volume"} engine, lifting a column by up to two rows.`);
  if ((c.consistency.manaReliability ?? 0) < 0) {
    consistencyFacts.push(
      `Mana reliability ${c.consistency.manaReliability}: ${c.mana.lands} lands and ${c.mana.rocks + c.mana.dorks} rocks and dorks make ${trim(c.mana.effectiveSources)} effective sources against a target of ${c.mana.target}${c.mana.weakColor ? `; ${c.mana.weakColor} carries 20%+ of the pips on fewer than ten producers` : ""}.`
    );
  } else {
    consistencyFacts.push(`Mana base is fine: ${trim(c.mana.effectiveSources)} effective sources against a target of ${c.mana.target}.`);
  }

  const interactionFacts: string[] = [
    `${plural(c.interaction.pieces, "interactive piece")} read ${trim(interaction.countColumn)} on count; ${c.interaction.stackPoints} stack points read ${trim(interaction.stackColumn)} on timing. The weaker binds.`,
    `${plural(c.interaction.counterspells, "counterspell")}. Answers ${[
      c.interaction.answersCreatures ? "creatures" : null,
      c.interaction.answersArtifacts ? "artifacts" : null,
      c.interaction.answersEnchantments ? "enchantments" : null,
    ].filter(Boolean).join(", ") || "nothing on the board"}${interaction.scopeCap < 10 ? ` — scope caps the score at ${interaction.scopeCap}` : ""}.`,
  ];
  if (c.interaction.symmetricWipes >= 3) interactionFacts.push(`${c.interaction.symmetricWipes} symmetric wipes cap the score at 7.`);

  const combat = c.resilience.combat!;
  const channelName: Record<string, string> = {
    combo: "combo lines",
    combat: "the combat rows",
    stax: "the stax path",
    voltron: "the Voltron path",
    answers: "answer density",
  };
  const resilienceFacts: string[] = [
    `Best channel: ${channelName[resilience.channel]} (combo ${trim(resilience.comboChannel)}, combat ${trim(resilience.combatChannel)}${resilience.staxChannel ? `, stax ${trim(resilience.staxChannel)}` : ""}${resilience.voltronChannel ? `, voltron ${trim(resilience.voltronChannel)}` : ""}${resilience.answerDensityChannel ? `, answers ${trim(resilience.answerDensityChannel)}` : ""}).`,
    c.comboLines.total > 0
      ? `${plural(c.comboLines.total, "win line")} count as ${trim(c.comboLines.counted)}${c.comboLines.clunky ? ` (${c.comboLines.clunky} clunky at half)` : ""}${c.comboLines.sharedFailure ? ", sharing a point of failure" : ""}; ${trim(resilience.effectiveLines)} after the tutor-access adjustment.`
      : "No combo line that wins or goes infinite.",
    `Combat rows: ${trim(combat.threats)} threats, ${combat.protectionCards} protection cards (${combat.protectionEffective} effective), ${trim(combat.recursionPoints)} recursion points with ${plural(combat.rebuildEngines, "rebuild engine")}, ${plural(combat.boardLevelProtection, "board-level protection effect")}.`,
    j.commanderDependency
      ? `Commander dependency read as ${j.commanderDependency} rather than the computed ${c.commanderDependencyReason.split(":")[0]!.toLowerCase()}: ${j.dependencyReason ?? "the scan's judgement"}.`
      : `Commander dependency: ${c.commanderDependencyReason}`,
  ];
  if ((c.resilience.engineExposure ?? 0) < 0 && c.exposure.className) {
    resilienceFacts.push(`Engine exposure ${c.resilience.engineExposure}: ${Math.round(c.exposure.share * 100)}% of the nonland cards are ${c.exposure.className}-based with ${plural(c.exposure.answers, "answer")} to an artifact or enchantment.`);
  }

  const speedFacts = [...fish.notes];
  if (j.turnDelta) speedFacts.push(`Read as turn ${trim(fundamentalTurn)} rather than the goldfish's ${trim(fish.fundamentalTurn)}: ${j.turnReason ?? "the scan's judgement"}.`);
  if (speed !== result.speed) speedFacts.push(`Speed ${trim(speed)} capped at 8: Consistency is ${trim(consistency.score)} and a turn-3 deck needs a 7.5 or better.`);

  const axes: AxisReport[] = [
    {
      key: "consistency",
      label: "Consistency",
      score: consistency.score,
      descriptor: describe("consistency", consistency.score),
      summary: `${c.consistency.tutorPoints} tutor pts · ${c.consistency.drawPoints} draw pts`,
      facts: consistencyFacts,
      cards: groups("tutors", "draw"),
    },
    {
      key: "resilience",
      label: "Resilience",
      score: resilience.score,
      descriptor: describe("resilience", resilience.score),
      summary: `${trim(c.comboLines.counted)} win lines · ${trim(combat.threats)} threats · ${c.resilience.commanderDependency === "none" ? "commander optional" : `${c.resilience.commanderDependency} commander dependency`}`,
      facts: resilienceFacts,
      cards: groups("combos", "threats", "recursion"),
    },
    {
      key: "interaction",
      label: "Interaction",
      score: interaction.score,
      descriptor: describe("interaction", interaction.score),
      summary: `${plural(c.interaction.pieces, "piece")} · ${c.interaction.stackPoints} stack pts · ${plural(c.interaction.counterspells, "counter")}`,
      facts: interactionFacts,
      cards: groups("interaction"),
    },
    {
      key: "speed",
      label: "Speed",
      score: result.speed,
      descriptor: describe("speed", result.speed),
      summary: `fundamental turn ${trim(fundamentalTurn)}${fundamentalTurn >= 14 ? "+" : ""} · ${fish.comboWins > fish.combatWins ? "combo" : "combat"} kills`,
      facts: speedFacts,
      cards: [],
    },
  ];

  const caveats = [
    "Card roles are read from a curated list of staples and from oracle text; a card counted wrongly shows up by name under its axis.",
    "Speed is a goldfish simulation — no opponent, no colour, no reanimation — so it is the shape of the clock rather than a measurement of one.",
  ];

  return {
    ...result,
    label: trim(result.index),
    bracketFloor: bracketFloor(result, rulesBracket),
    fundamentalTurn,
    commanderDependency: c.resilience.commanderDependency,
    axes,
    caveats,
    cardsScored: cards.reduce((n, card) => n + Math.max(1, card.quantity), 0),
    wonByTurn: fish.wonByTurn,
    cardReadings: c.cardReadings,
  };
}
