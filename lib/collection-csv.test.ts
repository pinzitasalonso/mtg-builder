import { describe, expect, it } from "vitest";
import { parseCollectionCsv, parseCollectionText, splitCsv } from "./collection-csv";

describe("splitCsv", () => {
  it("keeps delimiters, doubled quotes and line breaks inside quotes", () => {
    expect(splitCsv('a,"b, c","say ""hi""","x\ny"\r\n1,2,3,4', ",")).toEqual([
      ["a", "b, c", 'say "hi"', "x\ny"],
      ["1", "2", "3", "4"],
    ]);
  });
});

describe("parseCollectionCsv", () => {
  it("reads a Moxfield export and merges printings", () => {
    const csv = [
      '"Count","Tradelist Count","Name","Edition","Condition","Language","Foil"',
      '"2","0","Sol Ring","cmr","Near Mint","English",""',
      '"1","0","Borra, Cursed Blacksmith","otj","Near Mint","English","foil"',
      '"1","0","Sol Ring","c21","Near Mint","English",""',
    ].join("\n");
    expect(parseCollectionCsv(csv)).toEqual([
      { name: "Sol Ring", qty: 3 },
      { name: "Borra, Cursed Blacksmith", qty: 1 },
    ]);
  });

  it("reads ManaBox's Quantity column wherever it sits", () => {
    const csv = "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity\nLightning Bolt,2x2,Double Masters 2022,117,normal,uncommon,4";
    expect(parseCollectionCsv(csv)).toEqual([{ name: "Lightning Bolt", qty: 4 }]);
  });

  it("prefers TCGplayer's Simple Name over its annotated Name", () => {
    const csv = "Quantity,Name,Simple Name,Set\n1,Sol Ring (Borderless),Sol Ring,Commander Masters";
    expect(parseCollectionCsv(csv)).toEqual([{ name: "Sol Ring", qty: 1 }]);
  });

  it("handles a BOM, a sep= hint and semicolons (Dragon Shield / Excel)", () => {
    const csv = "﻿sep=;\nFolder Name;Quantity;Trade Quantity;Card Name\nBinder;3;0;Llanowar Elves";
    expect(parseCollectionCsv(csv)).toEqual([{ name: "Llanowar Elves", qty: 3 }]);
  });

  it("counts a row as one copy when there's no count column, and skips zeros", () => {
    expect(parseCollectionCsv("Name\nSol Ring\nSol Ring")).toEqual([{ name: "Sol Ring", qty: 2 }]);
    expect(parseCollectionCsv("Count,Name\n0,Mana Crypt\n1,Sol Ring")).toEqual([{ name: "Sol Ring", qty: 1 }]);
  });

  it("returns null for text that isn't a CSV export", () => {
    expect(parseCollectionCsv("1 Sol Ring\n4 Lightning Bolt")).toBeNull();
    expect(parseCollectionCsv("1 Borra, Cursed Blacksmith")).toBeNull();
  });
});

describe("parseCollectionText", () => {
  it("falls back to a plain list", () => {
    expect(parseCollectionText("1 Borra, Cursed Blacksmith\n4x Lightning Bolt")).toEqual([
      { name: "Borra, Cursed Blacksmith", qty: 1 },
      { name: "Lightning Bolt", qty: 4 },
    ]);
  });
});
