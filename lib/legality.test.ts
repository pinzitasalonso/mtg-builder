import { describe, expect, it } from "vitest";
import { cardWarnings, fitsIdentity } from "./legality";

describe("fitsIdentity", () => {
  it("accepts identity inside the commander's", () => {
    expect(fitsIdentity("U", "WU")).toBe(true);
    expect(fitsIdentity("", "WU")).toBe(true); // colorless fits anywhere
    expect(fitsIdentity("WU", "WU")).toBe(true);
  });

  it("rejects identity outside the commander's", () => {
    expect(fitsIdentity("R", "WU")).toBe(false);
    expect(fitsIdentity("WUR", "WU")).toBe(false);
    expect(fitsIdentity("G", "")).toBe(false); // colorless commander
  });

  it("never warns on unknown identities", () => {
    expect(fitsIdentity(null, "WU")).toBe(true);
    expect(fitsIdentity("R", null)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(fitsIdentity("u", "WU")).toBe(true);
  });
});

describe("cardWarnings", () => {
  const legal = { commander: "legal", modern: "legal" };

  it("flags banned and not-legal cards", () => {
    expect(cardWarnings({ legalities: { commander: "banned" }, colorIdentity: "" }, "commander", null)).toEqual([
      { kind: "format", message: "Banned in commander" },
    ]);
    expect(cardWarnings({ legalities: { modern: "not_legal" }, colorIdentity: "" }, "modern", null)).toEqual([
      { kind: "format", message: "Not legal in modern" },
    ]);
  });

  it("flags restricted separately", () => {
    expect(cardWarnings({ legalities: { vintage: "restricted" }, colorIdentity: "" }, "vintage", null)).toEqual([
      { kind: "format", message: "Restricted in vintage (max 1 copy)" },
    ]);
  });

  it("flags color-identity violations only in commander", () => {
    const card = { legalities: legal, colorIdentity: "R" };
    expect(cardWarnings(card, "commander", "WU")).toEqual([
      { kind: "identity", message: "Outside your commander's color identity" },
    ]);
    expect(cardWarnings(card, "modern", "WU")).toEqual([]);
  });

  it("stays silent on legal cards and missing data", () => {
    expect(cardWarnings({ legalities: legal, colorIdentity: "U" }, "commander", "WU")).toEqual([]);
    expect(cardWarnings({ legalities: null, colorIdentity: null }, "commander", "WU")).toEqual([]);
    expect(cardWarnings({ legalities: legal, colorIdentity: "U" }, "draft", null)).toEqual([]);
  });
});
