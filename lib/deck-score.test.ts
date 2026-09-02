import { describe, it, expect } from "vitest";
import {
  readLadder,
  snapQuarter,
  drawColumnScore,
  consistencyScore,
  consistencyReading,
  interactionScore,
  answerScopeCap,
  speedFromFundamentalTurn,
  assemblyMultiplier,
  resilienceScore,
  resilienceReading,
  combatChannelScore,
  voltronChannelScore,
  answerDensityChannelScore,
  deckScore,
  bracketFloor,
  describe as describeAxis,
  TUTOR_LADDER,
  INTERACTION_COUNT_LADDER,
  STACK_POINTS_LADDER,
  type InteractionInput,
  type CombatInput,
} from "./deck-score";

describe("readLadder", () => {
  it("reads an anchor exactly", () => {
    expect(readLadder(0, TUTOR_LADDER)).toBe(3.5);
    expect(readLadder(24, TUTOR_LADDER)).toBe(6.25);
    expect(readLadder(68, TUTOR_LADDER)).toBe(10);
  });

  it("interpolates linearly between anchors", () => {
    expect(readLadder(22, TUTOR_LADDER)).toBeCloseTo(5.875, 5);
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
  it("snaps to the quarter grid and rounds midpoints up", () => {
    expect(snapQuarter(5.875)).toBe(6);
    expect(snapQuarter(6.1)).toBe(6);
    expect(snapQuarter(6.2)).toBe(6.25);
    expect(snapQuarter(6.125)).toBe(6.25);
    expect(snapQuarter(7.375)).toBe(7.5);
  });
});

describe("drawColumnScore", () => {
  it("reads the published bands", () => {
    expect(drawColumnScore(60)).toBe(10);
    expect(drawColumnScore(59)).toBe(9);
    expect(drawColumnScore(36)).toBe(8);
    expect(drawColumnScore(35)).toBe(7);
    expect(drawColumnScore(24)).toBe(6);
    expect(drawColumnScore(20)).toBe(5);
    expect(drawColumnScore(12)).toBe(3.5);
    expect(drawColumnScore(11)).toBe(1.5);
  });
});

describe("consistency", () => {
  it("lets the weaker column hold the score down", () => {
    expect(consistencyScore({ drawPoints: 60, tutorPoints: 0, premiumTutors: 0 })).toBe(3.5);
    expect(consistencyScore({ drawPoints: 0, tutorPoints: 68, premiumTutors: 4 })).toBe(1.5);
  });

  it("caps at 8 without two premium tutors", () => {
    expect(consistencyScore({ drawPoints: 60, tutorPoints: 68, premiumTutors: 1 })).toBe(8);
    expect(consistencyScore({ drawPoints: 60, tutorPoints: 68, premiumTutors: 2 })).toBe(10);
  });

  it("caps a redundancy-driven tutor column at 7, waived with real search", () => {
    expect(consistencyScore({ drawPoints: 60, tutorPoints: 44, premiumTutors: 0, leansOnRedundancy: true })).toBe(7);
    expect(consistencyScore({ drawPoints: 60, tutorPoints: 44, premiumTutors: 2, leansOnRedundancy: true })).toBe(8);
  });

  it("applies the mana reliability penalty, capped at -2", () => {
    const base = { drawPoints: 40, tutorPoints: 32, premiumTutors: 2 };
    expect(consistencyScore(base)).toBe(7);
    expect(consistencyScore({ ...base, manaReliability: -1 })).toBe(6);
    expect(consistencyScore({ ...base, manaReliability: -9 })).toBe(5);
  });

  it("lets a command-zone engine lift a column by two rows, never past 9", () => {
    // Draw 3.5 (12 pts) is the weaker column; an access engine lifts it to 5.5.
    const access = consistencyReading({ drawPoints: 12, tutorPoints: 32, premiumTutors: 0, commandZoneEngine: "access" });
    expect(access.drawColumn).toBe(5.5);
    expect(access.score).toBe(5.5);
    // A volume engine only ever lifts draw — and stops at 9.
    const volume = consistencyReading({ drawPoints: 36, tutorPoints: 68, premiumTutors: 2, commandZoneEngine: "volume" });
    expect(volume.drawColumn).toBe(9);
    expect(volume.score).toBe(9);
  });
});

describe("interaction", () => {
  const base: InteractionInput = {
    pieces: 26, stackPoints: 52, counterspells: 0, symmetricWipes: 0,
    answersCreatures: true, answersArtifacts: true, answersEnchantments: true,
  };

  it("caps by answer scope", () => {
    expect(answerScopeCap(base)).toBe(10);
    expect(answerScopeCap({ ...base, answersEnchantments: false })).toBe(8);
    expect(answerScopeCap({ ...base, answersArtifacts: false, answersEnchantments: false })).toBe(7);
    expect(answerScopeCap({ ...base, answersArtifacts: false, answersEnchantments: false, counterspells: 4 })).toBe(10);
  });

  it("lets the weakest of count, timing and scope bind", () => {
    expect(interactionScore(base)).toBe(10);
    expect(interactionScore({ ...base, stackPoints: 0 })).toBe(3.5);
    expect(interactionScore({ ...base, pieces: 3 })).toBe(3);
    expect(interactionScore({ ...base, answersEnchantments: false })).toBe(8);
  });

  it("caps at 7 with three symmetric wipes", () => {
    expect(interactionScore({ ...base, symmetricWipes: 3 })).toBe(7);
  });
});

describe("speed", () => {
  it("reads the table", () => {
    expect(speedFromFundamentalTurn(2)).toBe(10);
    expect(speedFromFundamentalTurn(3)).toBe(9);
    expect(speedFromFundamentalTurn(4)).toBe(8);
    expect(speedFromFundamentalTurn(7)).toBe(5);
    expect(speedFromFundamentalTurn(9)).toBe(4);
    expect(speedFromFundamentalTurn(11)).toBe(3);
    expect(speedFromFundamentalTurn(14)).toBe(1);
  });

  it("lands on the half-step between two turns", () => {
    expect(speedFromFundamentalTurn(4.5)).toBe(7.5);
    expect(speedFromFundamentalTurn(8.5)).toBe(4);
  });
});

describe("resilience", () => {
  it("discounts lines by tutor access", () => {
    expect(assemblyMultiplier(24)).toBe(1);
    expect(assemblyMultiplier(12)).toBe(0.75);
    expect(assemblyMultiplier(0)).toBe(0.5);
    expect(assemblyMultiplier(0, true)).toBe(1);
  });

  it("reads the combo rows and the one-trick cap", () => {
    // Two lines with full access: 9, moderate dependency: 8.
    expect(resilienceScore({ comboLines: 2, tutorPoints: 30, commanderDependency: "moderate" })).toBe(8);
    // One line, no backup: capped at 6, then -1.
    expect(resilienceScore({ comboLines: 1, tutorPoints: 30, commanderDependency: "moderate" })).toBe(5);
    // One tutorless line reads 3.5, and the floor keeps it there.
    expect(resilienceScore({ comboLines: 1, tutorPoints: 0, commanderDependency: "none" })).toBe(3.5);
  });

  it("reads the combat rows by structure, not totals", () => {
    const row9: CombatInput = { threats: 12, protectionCards: 8, protectionEffective: 8, recursionPoints: 12, rebuildEngines: 4, boardLevelProtection: 3 };
    expect(combatChannelScore(row9)).toBe(9);
    expect(combatChannelScore({ ...row9, rebuildEngines: 3 })).toBe(8);
    expect(combatChannelScore({ ...row9, protectionCards: 5, boardLevelProtection: 1 })).toBe(6);
    expect(combatChannelScore({ ...row9, boardLevelProtection: 0 })).toBe(5);
    expect(combatChannelScore({ threats: 8, protectionCards: 0, protectionEffective: 2, recursionPoints: 4, rebuildEngines: 0, boardLevelProtection: 0 })).toBe(5);
    expect(combatChannelScore({ threats: 6, protectionCards: 0, protectionEffective: 1, recursionPoints: 2, rebuildEngines: 0, boardLevelProtection: 0 })).toBe(4.5);
    expect(combatChannelScore({ threats: 3, protectionCards: 0, protectionEffective: 0, recursionPoints: 0, rebuildEngines: 0, boardLevelProtection: 0 })).toBe(3.5);
    expect(combatChannelScore({ threats: 0, protectionCards: 0, protectionEffective: 0, recursionPoints: 0, rebuildEngines: 0, boardLevelProtection: 0 })).toBe(2.5);
  });

  it("takes the best channel and applies the penalties", () => {
    const r = resilienceReading({
      comboLines: 0,
      tutorPoints: 0,
      combat: { threats: 12, protectionCards: 6, protectionEffective: 6, recursionPoints: 10, rebuildEngines: 3, boardLevelProtection: 2 },
      engineExposure: -1,
      commanderDependency: "high",
    });
    expect(r.channel).toBe("combat");
    expect(r.combatChannel).toBe(8);
    expect(r.score).toBe(5);
  });

  it("adds the stack-protection half point to a real combo or threat plan", () => {
    expect(resilienceReading({ comboLines: 2, tutorPoints: 30, stackProtectionPieces: 5, commanderDependency: "none" }).comboChannel).toBe(9.5);
    expect(voltronChannelScore(10, 5)).toBe(7);
    expect(voltronChannelScore(6, 3)).toBe(6);
    expect(voltronChannelScore(5, 5)).toBe(0);
    expect(answerDensityChannelScore(16, 8, 40)).toBe(7);
    expect(answerDensityChannelScore(13, 5, 32)).toBe(6);
    expect(answerDensityChannelScore(13, 4, 32)).toBe(0);
  });
});

describe("deckScore", () => {
  it("averages the four onto the quarter grid", () => {
    const r = deckScore({ speed: 7, consistency: 6, interaction: 7, resilience: 5 });
    expect(r.index).toBe(6.25);
    expect(r.display).toBe("6.25");
  });

  it("caps speed at 8 when consistency is 7 or lower", () => {
    expect(deckScore({ speed: 10, consistency: 7, interaction: 5, resilience: 5 }).speed).toBe(8);
    expect(deckScore({ speed: 10, consistency: 7.25, interaction: 5, resilience: 5 }).speed).toBe(10);
  });
});

describe("bracketFloor", () => {
  const at = (speed: number, index: number, consistency = 5, interaction = 5) =>
    bracketFloor({ speed, index, consistency, interaction, resilience: 5, display: String(index) }, 1);

  it("only ever bumps up", () => {
    expect(bracketFloor({ speed: 1, index: 1, consistency: 1, interaction: 1, resilience: 1, display: "1" }, 4)).toBe(4);
  });

  it("reads the speed and index floors", () => {
    expect(at(4, 3)).toBe(1);
    expect(at(5, 3)).toBe(2);
    expect(at(1, 3.5)).toBe(2);
    expect(at(6, 3)).toBe(3);
    expect(at(1, 5)).toBe(3);
    expect(at(8, 3)).toBe(4);
    expect(at(1, 7)).toBe(4);
    expect(at(1, 3, 7.5, 7.5)).toBe(4);
    expect(at(9, 3)).toBe(5);
    expect(at(1, 8.5)).toBe(5);
  });

  it("gives half-step speeds the benefit of the doubt", () => {
    expect(at(8.5, 3)).toBe(4);
    expect(at(7.5, 3)).toBe(3);
  });
});

describe("describe", () => {
  it("names the rows", () => {
    expect(describeAxis("consistency", 5.25)).toBe("Baseline casual");
    expect(describeAxis("resilience", 4.5)).toBe("Thin");
    expect(describeAxis("interaction", 10)).toBe("Stack-dominant");
    expect(describeAxis("speed", 4)).toBe("Battlecruiser");
  });
});
