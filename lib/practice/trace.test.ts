import { describe, expect, it } from "vitest";
import { endTrace, movesIn, sinceLastOwnTurn, traceStats, traceText, type TraceRow, type TurnTrace } from "./trace";
import type { PracticeGame } from "./types";

const game = (texts: string[]) => ({ log: texts.map((text) => ({ seat: null, text })) }) as unknown as PracticeGame;
const row = (turn: number, source: string, since: string[], o: Partial<TurnTrace> = {}): TraceRow => ({ turn, source, data: { life: { opp: 40, you: 40 }, mana: "2 mana: U, B", hand: ["Dark Ritual*", "Thassa's Oracle"], field: ["Swamp"], graveyard: 1, library: 80, yourField: [], since, ...o } });

describe("a match's kept turns", () => {
  it("the log since its turn before: that turn as played, then the player's", () => {
    const g = game(["Turn 2 — the opponent's turn.", "The opponent plays Swamp.", "Turn 3 — your turn.", "You cast Bear.", "Turn 4 — the opponent's turn."]);
    expect(sinceLastOwnTurn(g)).toEqual(["Turn 2 — the opponent's turn.", "The opponent plays Swamp.", "Turn 3 — your turn.", "You cast Bear."]);
    // Its first turn: what came before it.
    expect(sinceLastOwnTurn(game(["You go first.", "Turn 1 — your turn.", "Turn 2 — the opponent's turn."]))).toEqual(["You go first.", "Turn 1 — your turn."]);
  });

  it("counts what the opponent did on a turn, not the player's answer", () => {
    expect(movesIn(["Turn 2 — the opponent's turn.", "The opponent plays Swamp.", "Turn 3 — your turn.", "The opponent casts Counterspell."])).toBe(0);
    expect(movesIn(["Turn 2 — the opponent's turn.", "The opponent casts Sol Ring.", "The opponent goes for a combo: A + B.", "The opponent activates Wishclaw Talisman.", "Turn 3 — your turn."])).toBe(3);
  });

  it("a turn is idle when the next row shows it cast nothing; the last turn isn't judged without the ending", () => {
    const rows = [
      row(2, "ai", ["You go first."]),
      row(4, "ai", ["Turn 2 — the opponent's turn.", "The opponent plays Swamp.", "Turn 3 — your turn."]),
      row(6, "fallback", ["Turn 4 — the opponent's turn.", "The opponent casts Dark Ritual.", "Turn 5 — your turn."]),
    ];
    expect(traceStats(rows)).toEqual({ turns: 3, idle: 1, known: 2, bySource: { ai: 2, fallback: 1 } });
    const ended = [...rows, { turn: 6, source: "end", data: endTrace(["Turn 6 — the opponent's turn.", "The opponent goes for a combo: A + B.", "The opponent wins."], "lost")! }];
    expect(traceStats(ended)).toMatchObject({ turns: 3, idle: 1, known: 3 });
  });

  it("the closing log is text lines only", () => {
    expect(endTrace(["a", 3, null, "b"], "won")).toMatchObject({ since: ["a", "b"], result: "won" });
    expect(endTrace("nope", "won")).toBeNull();
    expect(endTrace([], "won")).toBeNull();
  });

  it("reads as text, with the model's plan beside the app's line", () => {
    const text = traceText({ label: "Rograkh + Silas Renn", bot: false, result: "lost", endTurn: 27, createdAt: new Date("2026-11-26T10:00:00Z") }, [
      row(2, "ai", ["You go first."], { line: "cast c1 Dark Ritual; cast c2 Necropotence.", plan: "", say: "Holding up interaction.", raw: "[]" }),
      { turn: 27, source: "end", data: endTrace(["The opponent wins."], "lost")! },
    ]);
    expect(text).toMatch(/^Practice match against Rograkh \+ Silas Renn, 2026-11-26 10:00 UTC\nResult: the player lost on turn 27\./);
    expect(text).toMatch(/the app's line: cast c1 Dark Ritual; cast c2 Necropotence\.\nthe model's plan: nothing — "Holding up interaction\."/);
    expect(text).toMatch(/=== How it ended \(lost\) ===\n   The opponent wins\./);
  });
});
