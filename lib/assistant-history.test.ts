import { describe, expect, it } from "vitest";
import { historyForModel, markedUserMessage } from "./assistant-history";

const krenko = { publicId: "abc123", name: "Krenko goblins" };

describe("markedUserMessage", () => {
  it("marks the deck on screen", () => {
    expect(markedUserMessage("add ramp", krenko)).toBe("[On screen: Krenko goblins (/deck/abc123)]\nadd ramp");
  });
  it("marks the home page when no deck was on screen", () => {
    expect(markedUserMessage("which is best?", null)).toBe("[On screen: home]\nwhich is best?");
  });
});

describe("historyForModel", () => {
  it("keeps the thread in order, marking the player's turns", () => {
    const out = historyForModel([
      { role: "user", content: "which is best?", deck: null },
      { role: "assistant", content: "Krenko.", deck: null },
      { role: "user", content: "add ramp", deck: krenko },
    ]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(out[2].content).toBe("[On screen: Krenko goblins (/deck/abc123)]\nadd ramp");
    expect(out[1].content).toBe("Krenko.");
  });

  it("skips empty replies (stopped before a word)", () => {
    const out = historyForModel([
      { role: "user", content: "one", deck: null },
      { role: "assistant", content: "", deck: null },
      { role: "user", content: "two", deck: null },
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((m) => m.role === "user")).toBe(true);
  });

  it("drops the oldest turns past the budget, and always starts on the player", () => {
    const rows = [
      { role: "user", content: "a".repeat(50), deck: null },
      { role: "assistant", content: "b".repeat(50), deck: null },
      { role: "user", content: "c".repeat(50), deck: null },
      { role: "assistant", content: "d".repeat(50), deck: null },
      { role: "user", content: "last", deck: null },
    ];
    const out = historyForModel(rows, 140);
    expect(out[0].role).toBe("user");
    expect(String(out[out.length - 1].content)).toContain("last");
    expect(out.length).toBeLessThan(rows.length);
  });

  it("keeps the latest message even when it alone is over budget", () => {
    const out = historyForModel([{ role: "user", content: "x".repeat(500), deck: null }], 100);
    expect(out).toHaveLength(1);
  });
});
