import { describe, expect, it } from "vitest";
import { csvShape, parseCollectionCsv, parseCollectionText, splitCsvLine } from "./collection-csv";

describe("splitCsvLine", () => {
  it("keeps a quoted comma inside the field and unescapes doubled quotes", () => {
    expect(splitCsvLine('1,"Ajani, Caller of the Pride",M14', ",")).toEqual(["1", "Ajani, Caller of the Pride", "M14"]);
    expect(splitCsvLine('1,"Say ""hi""",x', ",")).toEqual(["1", 'Say "hi"', "x"]);
  });
});

describe("parseCollectionCsv", () => {
  it("reads a Moxfield export by its Count and Name columns", () => {
    const csv = [
      "Count,Tradelist Count,Name,Edition,Condition,Language,Foil,Tags,Last Modified,Collector Number",
      '2,0,"Ajani, Caller of the Pride",m14,Near Mint,English,,,2024-01-01,1',
      "1,0,Sol Ring,c21,Near Mint,English,foil,,2024-01-01,263",
      "3,0,Sol Ring,cmr,Near Mint,English,,,2024-01-01,331",
    ].join("\n");
    expect(parseCollectionCsv(csv)).toEqual([
      { name: "Ajani, Caller of the Pride", qty: 2 },
      { name: "Sol Ring", qty: 4 },
    ]);
  });

  it("reads a ManaBox export where Quantity comes after Name", () => {
    const csv = [
      "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID",
      "Lightning Bolt,2x2,Double Masters 2022,117,normal,uncommon,4,1,abc",
    ].join("\n");
    expect(parseCollectionCsv(csv)).toEqual([{ name: "Lightning Bolt", qty: 4 }]);
  });

  it("takes a tab-separated spreadsheet paste and a BOM", () => {
    const tsv = "﻿Name\tQty\nPlains\t10\nIsland\t\n";
    expect(parseCollectionCsv(tsv)).toEqual([
      { name: "Plains", qty: 10 },
      { name: "Island", qty: 1 },
    ]);
  });

  it("defaults to one copy when there is no count column", () => {
    expect(parseCollectionCsv("Card Name,Set\nSol Ring,C21\n")).toEqual([{ name: "Sol Ring", qty: 1 }]);
  });

  it("is empty without a header it recognises", () => {
    expect(csvShape("1 Sol Ring\n1 Arcane Signet")).toBeNull();
    expect(parseCollectionCsv("foo,bar\n1,2")).toEqual([]);
  });
});

describe("parseCollectionText", () => {
  it("routes a CSV to the CSV reader and a decklist to the decklist reader", () => {
    expect(parseCollectionText("Count,Name\n2,Sol Ring")).toEqual([{ name: "Sol Ring", qty: 2 }]);
    expect(parseCollectionText("2 Sol Ring")).toEqual([{ name: "Sol Ring", qty: 2 }]);
  });

  it("does not mistake a card name with a comma for a CSV", () => {
    expect(parseCollectionText("1 Ajani, Caller of the Pride")).toEqual([{ name: "Ajani, Caller of the Pride", qty: 1 }]);
  });
});
