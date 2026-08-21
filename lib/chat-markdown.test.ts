import { describe, expect, it } from "vitest";
import { boldNamesIn, cardNamesIn, flattenInline, normalizeCardKey, parseBlocks, tokenizeInline, cutCandidates } from "./chat-markdown";

describe("boldNamesIn", () => {
  it("collects unbracketed bold spans as candidate card names", () => {
    expect(boldNamesIn("Run **Birds of Paradise** and **Farseek** now")).toEqual([
      "Birds of Paradise",
      "Farseek",
    ]);
  });
  it("ignores bold spans that already contain a bracketed card", () => {
    expect(boldNamesIn("**[[Sol Ring]]**")).toEqual([]);
  });
  it("skips lowercase prose emphasis even when the word is a real card", () => {
    expect(boldNamesIn("focus on **removal** and **fog** effects")).toEqual([]);
  });
  it("skips header-style spans ending with a colon", () => {
    expect(boldNamesIn("**Strategy:** go wide")).toEqual([]);
  });
  it("skips long bold sentences", () => {
    expect(boldNamesIn("**This is a whole bolded sentence about the deck plan**")).toEqual([]);
  });
  it("collapses internal whitespace in candidates", () => {
    expect(boldNamesIn("**Birds of  Paradise**")).toEqual(["Birds of Paradise"]);
  });
});

describe("normalizeCardKey", () => {
  it("trims, collapses whitespace, and lowercases", () => {
    expect(normalizeCardKey("  Birds of  Paradise ")).toBe("birds of paradise");
  });
});

describe("flattenInline", () => {
  it("returns the plain text of nested tokens", () => {
    expect(flattenInline(tokenizeInline("**Birds of Paradise**"))).toBe("Birds of Paradise");
  });
});

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

describe("cutCandidates", () => {
  // THE bug this function exists for. A cut is argued for by naming something
  // better, and the better card is in the same sentence — so a flat "every
  // named card already in the deck" scan offered to delete it.
  it("does not offer the card a cut is compared against", () => {
    const md = [
      "## Consider cutting",
      "- [[Divination]] — [[Rhystic Study]] already does this, better",
      "- [[Mind Stone]] — strictly worse than [[Arcane Signet]] here",
    ].join("\n");
    expect(cutCandidates(md)).toEqual(["Divination", "Mind Stone"]);
  });

  it("takes only the first card of a paragraph, not the reasoning after it", () => {
    const md = "## Cuts\n\n[[Sol Ring]] is the weakest slot now that you run [[Mana Crypt]] and [[Mana Vault]].";
    expect(cutCandidates(md)).toEqual(["Sol Ring"]);
  });

  // A card praised in one section can never be deleted by another.
  it("subtracts anything named under a keep or add heading", () => {
    const md = [
      "## Working well",
      "- [[Rhystic Study]] is carrying the draw",
      "## Consider cutting",
      "- [[Rhystic Study]]",
      "- [[Divination]]",
    ].join("\n");
    expect(cutCandidates(md)).toEqual(["Divination"]);
  });

  // No structure means no basis for a bulk delete. Cards stay removable one at
  // a time by clicking them; nothing here should authorize deleting in bulk.
  it("offers nothing when the reply has no cut heading", () => {
    expect(cutCandidates("Cut [[Divination]] — [[Rhystic Study]] is better.")).toEqual([]);
    expect(cutCandidates("## Working well\n- [[Sol Ring]]")).toEqual([]);
  });

  // "Cuts and additions" says both things, so it authorizes neither.
  it("treats an ambiguous heading as neutral", () => {
    expect(cutCandidates("## Cuts and additions\n- [[Divination]]")).toEqual([]);
  });

  it("reads a bolded cut the model didn't bracket", () => {
    const md = "## Consider cutting\n- **Divination** — [[Rhystic Study]] is better";
    expect(cutCandidates(md)).toEqual(["Divination"]);
  });

  it("dedupes and survives an empty or headingless reply", () => {
    expect(cutCandidates("## Cuts\n- [[Sol Ring]]\n- [[Sol Ring]]")).toEqual(["Sol Ring"]);
    expect(cutCandidates("")).toEqual([]);
    expect(cutCandidates("Just prose with no cards.")).toEqual([]);
  });

  // The heading's scope ends at the next heading.
  it("stops collecting when a new heading changes the advice", () => {
    const md = [
      "## Consider cutting",
      "- [[Divination]]",
      "## Missing",
      "- [[Rhystic Study]]",
      "- [[Mystic Remora]]",
    ].join("\n");
    expect(cutCandidates(md)).toEqual(["Divination"]);
  });
});
