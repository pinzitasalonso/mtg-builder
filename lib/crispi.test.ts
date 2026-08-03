import { describe, it, expect } from "vitest";
import {
  readLadder,
  snapQuarter,
  drawColumnScore,
  consistencyScore,
  interactionScore,
  answerScopeCap,
  speedFromFundamentalTurn,
  assemblyMultiplier,
  resilienceScore,
  crispiScore,
  bracketFloor,
  TUTOR_LADDER,
  INTERACTION_COUNT_LADDER,
  STACK_POINTS_LADDER,
  type InteractionInput,
} from "./crispi";

describe("readLadder", () => {
  it("reads an anchor exactly", () => {
    expect(readLadder(0, TUTOR_LADDER)).toBe(3.5);
    expect(readLadder(24, TUTOR_LADDER)).toBe(6.25);
    expect(readLadder(68, TUTOR_LADDER)).toBe(10);
  });

  it("interpolates linearly between anchors", () => {
    // Halfway from 20→5.5 to 24→6.25 is 22 → 5.875.
    expect(readLadder(22, TUTOR_LADDER)).toBeCloseTo(5.875, 5);
    // Halfway from 32→7 to 44→8 is 38 → 7.5.
    expect(readLadder(38, TUTOR_LADDER)).toBeCloseTo(7.5, 5);
  });

  it("clamps outside the ladder", () => {
    expect(readLadder(-5, TUTOR_LADDER)).toBe(3.5);
    expect(readLadder(500, TUTOR_LADDER)).toBe(10);
  });

  it("carries the published interaction anchors", () => {
    expect(readLadder(26, INTERACTION_COUNT_LADDER)).toBe(10);
    expect(readLadder(14, INTERACTION_COUNT_LADDER)).toBe(6.25);
    expect(readLadder(52, STACK_POINTS_LADDER)).toBe(10);
    expect(readLadder(20, STACK_POINTS_LADDER)).toBe(7.5);
  });
});

describe("snapQuarter", () => {
  it("snaps to the quarter grid", () => {
    expect(snapQuarter(5.875)).toBe(6);
    expect(snapQuarter(6.1)).toBe(6);
    expect(snapQuarter(6.2)).toBe(6.25);
  });

  it("rounds exact midpoints up", () => {
    // An eighth is the exact midpoint between two quarters.
    expect(snapQuarter(6.125)).toBe(6.25);
    expect(snapQuarter(7.375)).toBe(7.5);
  });
});

describe("drawColumnScore", () => {
  it("reads the published bands", () => {
    expect(drawColumnScore(60)).toBe(10);
    expect(drawColumnScore(59)).toBe(9);
    expect(drawColumnScore(40)).toBe(9);
    expect(drawColumnScore(39)).toBe(8);
    expect(drawColumnScore(36)).toBe(8);
    expect(drawColumnScore(35)).toBe(7);
    expect(drawColumnScore(24)).toBe(6);
    expect(drawColumnScore(20)).toBe(5);
    expect(drawColumnScore(12)).toBe(3.5);
    expect(drawColumnScore(11)).toBe(1.5);
  });
});

describe("consistencyScore", () => {
  it("lets the weaker column hold the score down", () => {
    // Huge draw suite, no tutors at all: the tutor column reads 3.5 and binds.
    expect(consistencyScore({ drawPoints: 60, tutorPoints: 0, premiumTutors: 0 })).toBe(3.5);
    // And the mirror: premium search, no draw.
    expect(consistencyScore({ drawPoints: 0, tutorPoints: 68, premiumTutors: 4 })).toBe(1.5);
  });

  it("caps at 8 without two premium tutors", () => {
    // Both columns would read 10 on volume alone.
    expect(consistencyScore({ drawPoints: 60, tutorPoints: 68, premiumTutors: 1 })).toBe(8);
    expect(consistencyScore({ drawPoints: 60, tutorPoints: 68, premiumTutors: 2 })).toBe(10);
  });

  it("caps a redundancy-driven tutor column at 7", () => {
    const redundant = consistencyScore({
      drawPoints: 60, tutorPoints: 44, premiumTutors: 0, leansOnRedundancy: true,
    });
    expect(redundant).toBe(7);
  });

  it("waives the redundancy cap once real search is there", () => {
    const withSearch = consistencyScore({
      drawPoints: 60, tutorPoints: 44, premiumTutors: 2, leansOnRedundancy: true,
    });
    expect(withSearch).toBe(8);
  });

  it("applies the mana reliability penalty, capped at -2", () => {
    const base = { drawPoints: 40, tutorPoints: 32, premiumTutors: 2 };
    expect(consistencyScore(base)).toBe(7);
    expect(consistencyScore({ ...base, manaReliability: -1 })).toBe(6);
    expect(consistencyScore({ ...base, manaReliability: -9 })).toBe(5);
  });
});

describe("answerScopeCap", () => {
  const base: InteractionInput = {
    pieces: 26, stackPoints: 52, counterspells: 0, symmetricWipes: 0,
    answersCreatures: true, answersArtifacts: true, answersEnchantments: true,
  };

  it("permits every row with all three classes covered", () => {
    expect(answerScopeCap(base)).toBe(10);
  });

  it("permits every row on a real counterspell suite regardless of scope", () => {
    expect(answerScopeCap({
      ...base, answersArtifacts: false, answersEnchantments: false, counterspells: 4,
    })).toBe(10);
  });

  it("caps creatures-plus-one at 8 and creature-only at 7", () => {
    expect(answerScopeCap({ ...base, answersEnchantments: false })).toBe(8);
    expect(answerScopeCap({ ...base, answersArtifacts: false, answersEnchantments: false })).toBe(7);
  });
});

describe("interactionScore", () => {
  const dense: InteractionInput = {
    pieces: 26, stackPoints: 52, counterspells: 6, symmetricWipes: 0,
    answersCreatures: true, answersArtifacts: true, answersEnchantments: true,
  };

  it("reads 10 for a compact suite that operates on the stack", () => {
    expect(interactionScore(dense)).toBe(10);
  });

  it("separates a precon pile from a cEDH suite on the stack column", () => {
    // Same 26 pieces, but nothing happens at instant speed.
    const pile = interactionScore({
      ...dense, stackPoints: 0, counterspells: 0,
      answersArtifacts: false, answersEnchantments: false,
    });
    expect(pile).toBe(3.5);
    expect(pile).toBeLessThan(interactionScore(dense));
  });

  it("caps at 7 when the deck leans on symmetric wipes", () => {
    expect(interactionScore({ ...dense, symmetricWipes: 3 })).toBe(7);
    expect(interactionScore({ ...dense, symmetricWipes: 2 })).toBe(10);
  });
});

describe("speedFromFundamentalTurn", () => {
  it("maps the published rows", () => {
    expect(speedFromFundamentalTurn(1)).toBe(10);
    expect(speedFromFundamentalTurn(2)).toBe(10);
    expect(speedFromFundamentalTurn(3)).toBe(9);
    expect(speedFromFundamentalTurn(4)).toBe(8);
    expect(speedFromFundamentalTurn(5)).toBe(7);
    expect(speedFromFundamentalTurn(6)).toBe(6);
    expect(speedFromFundamentalTurn(7)).toBe(5);
    expect(speedFromFundamentalTurn(8)).toBe(4);
    expect(speedFromFundamentalTurn(9)).toBe(4);
    expect(speedFromFundamentalTurn(11)).toBe(3);
    expect(speedFromFundamentalTurn(13)).toBe(2);
    expect(speedFromFundamentalTurn(14)).toBe(1);
    expect(speedFromFundamentalTurn(20)).toBe(1);
  });

  it("lands a straddling deck on the half-step", () => {
    // "A 7.5 means eliminates a player on turn 4 or 5, depending on the draw."
    expect(speedFromFundamentalTurn(4.5)).toBe(7.5);
    expect(speedFromFundamentalTurn(3.5)).toBe(8.5);
  });
});

describe("assemblyMultiplier", () => {
  it("scales line credit with tutor access", () => {
    expect(assemblyMultiplier(24)).toBe(1);
    expect(assemblyMultiplier(23)).toBe(0.75);
    expect(assemblyMultiplier(12)).toBe(0.75);
    expect(assemblyMultiplier(11)).toBe(0.5);
  });

  it("gives a battlefield-tutor commander full credit regardless", () => {
    expect(assemblyMultiplier(0, true)).toBe(1);
  });
});

describe("resilienceScore", () => {
  it("reads a layered, findable combo deck at the top", () => {
    expect(resilienceScore({
      comboLines: 3, tutorPoints: 40, commanderDependency: "none",
    })).toBe(10);
  });

  it("discounts a combo a tutorless deck cannot find", () => {
    // 2 lines × 0.5 assembly = 1.0 → reads 7, then the one-trick cap and the
    // format-default commander penalty.
    const tutorless = resilienceScore({
      comboLines: 2, tutorPoints: 0, commanderDependency: "none",
    });
    const tutored = resilienceScore({
      comboLines: 2, tutorPoints: 40, commanderDependency: "none",
    });
    expect(tutorless).toBeLessThan(tutored);
    expect(tutored).toBe(9);
  });

  it("caps a one-trick deck at 6", () => {
    // One findable line, no combat plan and no stax to fall back on.
    expect(resilienceScore({
      comboLines: 1, tutorPoints: 40, commanderDependency: "none",
    })).toBe(6);
  });

  it("lifts the cap once there is a real backup path", () => {
    expect(resilienceScore({
      comboLines: 1, tutorPoints: 40, combatChannel: 5, commanderDependency: "none",
    })).toBe(7);
  });

  it("caps the stax path at 6", () => {
    expect(resilienceScore({
      comboLines: 0, tutorPoints: 0, staxPieces: 20, commanderDependency: "none",
    })).toBe(6);
  });

  it("applies the commander dependency penalty", () => {
    const base = { comboLines: 3, tutorPoints: 40 } as const;
    expect(resilienceScore({ ...base, commanderDependency: "none" })).toBe(10);
    expect(resilienceScore({ ...base, commanderDependency: "moderate" })).toBe(9);
    expect(resilienceScore({ ...base, commanderDependency: "high" })).toBe(8);
  });

  it("applies engine exposure, capped at -2", () => {
    expect(resilienceScore({
      comboLines: 3, tutorPoints: 40, engineExposure: -9, commanderDependency: "none",
    })).toBe(8);
  });
});

describe("crispiScore", () => {
  it("reproduces the worked example from the rubrics", () => {
    // "If your deck scores Speed 7, Consistency 6, Interaction 7, and
    // Resilience 5, your CRISPI is 6.25."
    const r = crispiScore({ speed: 7, consistency: 6, interaction: 7, resilience: 5 });
    expect(r.crispi).toBe(6.25);
    expect(r.display).toBe("6.25");
  });

  it("follows the stated formula over the rubric's illustrative pair", () => {
    // The rubric says: "A deck scoring 9/3/3/9 (fast but fragile) is nothing
    // like a deck scoring 6/7/7/6 (balanced). Both produce a 6.25."
    //
    // They don't. 9+3+3+9 = 24 → 6.00, and 6+7+7+6 = 26 → 6.50. The prose looks
    // like a callback to the worked example above it (7/6/7/5 = 25 → 6.25,
    // which IS correct). We implement the stated formula, so we differ from
    // that one sentence on purpose.
    const balanced = crispiScore({ speed: 6, consistency: 7, interaction: 7, resilience: 6 });
    expect(balanced.crispi).toBe(6.5);

    // The glass cannon never reaches its raw average anyway: Speed 9 with
    // Consistency 3 trips the coupling and caps Speed at 8, so 23/4 = 5.75.
    const glassCannon = crispiScore({ speed: 9, consistency: 3, interaction: 3, resilience: 9 });
    expect(glassCannon.speed).toBe(8);
    expect(glassCannon.crispi).toBe(5.75);

    // The point the rubric is making survives its own arithmetic: two decks
    // that play nothing alike land within a quarter-point of each other.
    expect(Math.abs(balanced.crispi - glassCannon.crispi)).toBeLessThanOrEqual(0.75);
  });

  it("caps Speed at 8 when Consistency is 7 or lower", () => {
    expect(crispiScore({ speed: 10, consistency: 7, interaction: 5, resilience: 5 }).speed).toBe(8);
    expect(crispiScore({ speed: 10, consistency: 7.5, interaction: 5, resilience: 5 }).speed).toBe(10);
    expect(crispiScore({ speed: 8.5, consistency: 3, interaction: 5, resilience: 5 }).speed).toBe(8.5);
  });

  it("displays two decimal places", () => {
    expect(crispiScore({ speed: 5, consistency: 5, interaction: 5, resilience: 5 }).display).toBe("5.00");
  });
});

describe("bracketFloor", () => {
  const at = (scores: Parameters<typeof crispiScore>[0], rulesBracket = 1) =>
    bracketFloor(crispiScore(scores), rulesBracket);

  it("bumps a fast deck up regardless of its rules bracket", () => {
    // Speed 9 → Bracket 5 floor. Consistency 7.5 keeps the coupling off.
    expect(at({ speed: 9, consistency: 7.5, interaction: 5, resilience: 5 })).toBe(5);
  });

  it("gives half-steps the benefit of the doubt", () => {
    // "An 8.5 counts as a turn-4 win: fast enough for the Bracket 4 floor, but
    // not for Bracket 5's."
    expect(at({ speed: 8.5, consistency: 7.5, interaction: 5, resilience: 5 })).toBe(4);
    // "A 7.5 counts as a turn-5 win and stays below the Bracket 4 floor."
    expect(at({ speed: 7.5, consistency: 5, interaction: 5, resilience: 5 })).toBe(3);
  });

  it("catches the competitive core that is not fast", () => {
    // Bracket 4's third input: Consistency 7.5+ AND Interaction 7.5+.
    expect(at({ speed: 4, consistency: 7.5, interaction: 7.5, resilience: 4 })).toBe(4);
    // Either one alone is not enough.
    expect(at({ speed: 4, consistency: 7.5, interaction: 7, resilience: 4 })).toBeLessThan(4);
  });

  it("only ever bumps up", () => {
    // A weak deck that the rules already put in Bracket 4 stays there.
    expect(at({ speed: 2, consistency: 2, interaction: 2, resilience: 2 }, 4)).toBe(4);
    // And a low-power deck with no rules bracket stays at 1.
    expect(at({ speed: 2, consistency: 2, interaction: 2, resilience: 2 })).toBe(1);
  });

  it("puts a precon at the CRISPI 5 band the rubric describes", () => {
    // "Precons — the definitional Bracket 2 experience — center on a CRISPI
    // score of about 5" and the strongest land at the bottom of Bracket 3.
    expect(at({ speed: 5, consistency: 5, interaction: 5, resilience: 5 })).toBe(3);
  });
});
