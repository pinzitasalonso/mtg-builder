import { describe, it, expect } from "vitest";
import { buildAnalysisPrompt, decklistBlock, judgementFrom, parseAnalysis, scanSummary } from "./deck-analysis";
import { boundJudgement, scoreDeck } from "./deck-score-report";
import type { ScoredCard } from "./deck-score-classify";

function card(name: string, over: Partial<ScoredCard> = {}): ScoredCard {
  return {
    name, typeLine: "Creature — Beast", oracleText: "", manaCost: "{3}", manaValue: 3, quantity: 1,
    power: 3, toughness: 3, keywords: [], producedMana: [], isCommander: false, ...over,
  };
}
const forest = (i: number) => card(`Forest ${i}`, { typeLine: "Basic Land — Forest", oracleText: "({T}: Add {G}.)", manaCost: null, manaValue: 0, power: null, producedMana: ["G"] });
const deck = (): ScoredCard[] => [
  ...Array.from({ length: 36 }, (_, i) => forest(i)),
  ...Array.from({ length: 63 }, (_, i) => card(`Bear ${i}`)),
  card("Boss", { isCommander: true, power: 4, manaCost: "{4}", manaValue: 4 }),
];

describe("parseAnalysis", () => {
  it("reads a well-formed document and drops what it cannot use", () => {
    const out = parseAnalysis({
      analysis: {
        overview: " A deck. ",
        strategy: ["Ramp", "", 3],
        mulligan: ["Keep three lands"],
        keyCards: [{ name: "Boss", why: "It hits." }, { name: 4 }],
        tips: [],
        weaknesses: { critical: ["Wraths"], minor: [] },
        axes: [{ key: "speed", note: "Slow." }, { key: "bogus", note: "x" }],
      },
      judgement: { fundamentalTurn: 7.5, turnReason: "Voltron.", commanderDependency: "high", dependencyReason: "Engine." },
    });
    expect(out?.analysis.overview).toBe("A deck.");
    expect(out?.analysis.strategy).toEqual(["Ramp"]);
    expect(out?.analysis.keyCards).toEqual([{ name: "Boss", why: "It hits." }]);
    expect(out?.analysis.axes).toEqual([{ key: "speed", note: "Slow." }]);
    expect(out?.judgement.fundamentalTurn).toBe(7.5);
    expect(out?.judgement.commanderDependency).toBe("high");
  });

  it("rejects a document with no overview", () => {
    expect(parseAnalysis({ analysis: { overview: "" }, judgement: {} })).toBeNull();
    expect(parseAnalysis(null)).toBeNull();
  });

  it("defaults an unknown dependency to moderate", () => {
    const out = parseAnalysis({ analysis: { overview: "x" }, judgement: { commanderDependency: "extreme" } });
    expect(out?.judgement.commanderDependency).toBe("moderate");
  });
});

describe("judgement bounds", () => {
  it("clamps the turn to two turns either way on the half-turn grid", () => {
    expect(boundJudgement({ turnDelta: 3 }, "moderate").turnDelta).toBe(2);
    expect(boundJudgement({ turnDelta: -1.5 }, "moderate").turnDelta).toBe(-1.5);
    expect(boundJudgement({ turnDelta: -0.7 }, "moderate").turnDelta).toBe(-0.5);
    expect(boundJudgement({ turnDelta: 0 }, "moderate").turnDelta).toBeUndefined();
  });

  it("moves dependency at most one step from the computed read", () => {
    expect(boundJudgement({ commanderDependency: "high" }, "none").commanderDependency).toBe("moderate");
    expect(boundJudgement({ commanderDependency: "none" }, "high").commanderDependency).toBe("moderate");
    expect(boundJudgement({ commanderDependency: "moderate" }, "moderate").commanderDependency).toBeUndefined();
  });

  it("shows beside the report and leaves the number alone", () => {
    const cards = deck();
    const computed = scoreDeck(cards, [], 2);
    const judged = scoreDeck(cards, [], 2, judgementFrom({
      analysis: { overview: "x", strategy: [], mulligan: [], keyCards: [], tips: [], weaknesses: { critical: [], minor: [] }, axes: [] },
      judgement: { fundamentalTurn: computed.fundamentalTurn - 4, turnReason: "Sneak Attack package.", commanderDependency: "high", dependencyReason: "Voltron." },
    }, computed.fundamentalTurn));
    // Measured only: an unchanged list scores the same whatever the analysis says.
    expect(judged.fundamentalTurn).toBe(computed.fundamentalTurn);
    expect(judged.speed).toBe(computed.speed);
    expect(judged.index).toBe(computed.index);
    expect(judged.resilience).toBe(computed.resilience);
    const speed = judged.axes.find((a) => a.key === "speed")!;
    expect(speed.facts.some((f) => f.includes("Sneak Attack package"))).toBe(true);
    const resilience = judged.axes.find((a) => a.key === "resilience")!;
    expect(resilience.facts.some((f) => f.includes("Voltron"))).toBe(true);
  });
});

describe("prompt", () => {
  it("lists the deck by type with the commander first, and carries the notes", () => {
    const block = decklistBlock(deck());
    expect(block.startsWith("Commander: Boss")).toBe(true);
    expect(block).toContain("Lands (36)");
    const prompt = buildAnalysisPrompt(deck(), scoreDeck(deck(), [], 2), [], "It is a voltron deck.");
    expect(prompt).toContain("PLAYER'S NOTES");
    expect(prompt).toContain("It is a voltron deck.");
    expect(prompt).toContain("SCORE AND WORKING");
  });
});

describe("scanSummary", () => {
  const stored = (score: object) => JSON.stringify({ score, analysis: null, notes: null, scannedAt: "2026-09-27T00:00:00Z" });

  it("reads the Score and the bracket from a stored scan", () => {
    expect(scanSummary(stored({ index: 6.25, label: "6.25", bracketFloor: 3 }))).toEqual({ score: 6.25, label: "6.25", bracket: 3 });
  });

  it("works on a real report", () => {
    const report = scoreDeck(deck(), [], 2);
    const summary = scanSummary(JSON.stringify({ score: report, analysis: null, notes: null, scannedAt: "" }));
    expect(summary).toEqual({ score: report.index, label: report.label, bracket: report.bracketFloor });
  });

  it("prints the Score itself when the label is missing", () => {
    expect(scanSummary(stored({ index: 7 }))).toEqual({ score: 7, label: "7", bracket: null });
  });

  it("drops a bracket outside 1–5", () => {
    expect(scanSummary(stored({ index: 5, label: "5", bracketFloor: 9 }))?.bracket).toBeNull();
  });

  it("is null for a deck never scanned, or a scan it cannot read", () => {
    expect(scanSummary(null)).toBeNull();
    expect(scanSummary("")).toBeNull();
    expect(scanSummary("{not json")).toBeNull();
    expect(scanSummary(JSON.stringify({ analysis: null }))).toBeNull();
    expect(scanSummary(stored({ index: "6" }))).toBeNull();
  });
});
