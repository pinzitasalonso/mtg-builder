import { describe, expect, it } from "vitest";
import { cardNamesIn, parseBlocks, tokenizeInline } from "./chat-markdown";

describe("tokenizeInline", () => {
  it("extracts card links as card tokens", () => {
    expect(tokenizeInline("Try [[Sol Ring]] early.")).toEqual([
      { type: "text", value: "Try " },
      { type: "card", value: "Sol Ring" },
      { type: "text", value: " early." },
    ]);
  });

  it("extracts bold spans", () => {
    expect(tokenizeInline("This is **strong** advice")).toEqual([
      { type: "text", value: "This is " },
      { type: "bold", tokens: [{ type: "text", value: "strong" }] },
      { type: "text", value: " advice" },
    ]);
  });

  it("handles cards and bold together", () => {
    expect(tokenizeInline("**Add** [[Lightning Bolt]] now")).toEqual([
      { type: "bold", tokens: [{ type: "text", value: "Add" }] },
      { type: "text", value: " " },
      { type: "card", value: "Lightning Bolt" },
      { type: "text", value: " now" },
    ]);
  });

  it("links a [[card]] wrapped in bold", () => {
    expect(tokenizeInline("**[[Ashnod's Altar]]** — combo piece")).toEqual([
      { type: "bold", tokens: [{ type: "card", value: "Ashnod's Altar" }] },
      { type: "text", value: " — combo piece" },
    ]);
  });

  it("leaves an unterminated card bracket as plain text (mid-stream)", () => {
    expect(tokenizeInline("Consider [[Blightste")).toEqual([
      { type: "text", value: "Consider [[Blightste" },
    ]);
  });

  it("leaves an unterminated bold marker as plain text (mid-stream)", () => {
    expect(tokenizeInline("This is **bol")).toEqual([{ type: "text", value: "This is **bol" }]);
  });
});

describe("parseBlocks", () => {
  it("parses headings by level", () => {
    const blocks = parseBlocks("# One\n## Two\n### Three");
    expect(blocks.map((b) => b.type)).toEqual(["h1", "h2", "h3"]);
  });

  it("groups consecutive bullets into a single ul block", () => {
    const blocks = parseBlocks("- a\n- b\n- c");
    expect(blocks).toHaveLength(1);
    const ul = blocks[0];
    if (ul.type !== "ul") throw new Error("expected ul");
    expect(ul.items).toHaveLength(3);
  });

  it("groups numbered items into a single ol block", () => {
    const blocks = parseBlocks("1. first\n2. second");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("ol");
  });

  it("joins consecutive lines into one paragraph and splits on blank lines", () => {
    const blocks = parseBlocks("line one\nline two\n\nsecond para");
    expect(blocks.map((b) => b.type)).toEqual(["p", "p"]);
  });

  it("tokenizes card links inside list items", () => {
    const blocks = parseBlocks("- Run [[Sol Ring]]");
    const ul = blocks[0];
    if (ul.type !== "ul") throw new Error("expected ul");
    expect(ul.items[0]).toContainEqual({ type: "card", value: "Sol Ring" });
  });
});

describe("cardNamesIn", () => {
  it("collects distinct card names case-insensitively", () => {
    expect(cardNamesIn("[[Sol Ring]] and [[Sol Ring]] plus [[Mana Crypt]]")).toEqual([
      "Sol Ring",
      "Mana Crypt",
    ]);
  });

  it("returns an empty list when there are no card links", () => {
    expect(cardNamesIn("just some prose")).toEqual([]);
  });
});
