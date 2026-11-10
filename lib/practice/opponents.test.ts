import { describe, expect, it } from "vitest";
import { commanderQuery } from "@/app/api/practice/commanders/route";
import { parseTopCommanders } from "@/lib/edhrec";
import { cleanOpponent, opponentKey, seededOrder } from "./opponents";

describe("cleanOpponent", () => {
  it("keeps what an option is, by kind", () => {
    expect(cleanOpponent({ kind: "deck", deck: "abc", label: "Mine", detail: "Your deck", extra: 1 })).toEqual({ kind: "deck", deck: "abc", label: "Mine", detail: "Your deck", image: null, colors: null });
    expect(cleanOpponent({ kind: "mtgtop8", format: "modern", archetype: "12", label: "Boros Energy", detail: "9%" })).toMatchObject({ kind: "mtgtop8", format: "modern", archetype: "12" });
    expect(cleanOpponent({ kind: "edhrec", commander: " Atraxa, Praetors' Voice ", level: "upgraded", label: "Atraxa", detail: "" })).toMatchObject({ kind: "edhrec", commander: "Atraxa, Praetors' Voice", level: "upgraded" });
  });

  it("drops a bracket that isn't one, and an image that isn't Scryfall's", () => {
    expect(cleanOpponent({ kind: "edhrec", commander: "Atraxa", level: "godlike", label: "A", detail: "" })?.level).toBeNull();
    expect(cleanOpponent({ kind: "deck", deck: "abc", label: "A", detail: "", image: "https://evil.example/x.jpg" })?.image).toBeNull();
    expect(cleanOpponent({ kind: "deck", deck: "abc", label: "A", detail: "", image: "https://cards.scryfall.io/art_crop/front/a/b/x.jpg" })?.image).toBe("https://cards.scryfall.io/art_crop/front/a/b/x.jpg");
  });

  it("orders the colours, and cuts long text", () => {
    expect(cleanOpponent({ kind: "deck", deck: "abc", label: "x".repeat(900), detail: "", colors: "gub?w" })).toMatchObject({ colors: "WUBG", label: "x".repeat(200) });
  });

  it("is null for anything else", () => {
    for (const bad of [null, "deck", {}, { kind: "deck" }, { kind: "mtgtop8", format: "modern" }, { kind: "edhrec", commander: "  " }, { kind: "other", deck: "abc" }]) expect(cleanOpponent(bad)).toBeNull();
  });
});

describe("opponentKey", () => {
  it("is the same for one opponent, whatever its tile said or its bracket was", () => {
    const a = cleanOpponent({ kind: "edhrec", commander: "Atraxa, Praetors' Voice", level: "core", label: "Atraxa", detail: "x" })!;
    const b = cleanOpponent({ kind: "edhrec", commander: "atraxa, praetors' voice", level: null, label: "other words", detail: "y" })!;
    expect(opponentKey(a)).toBe(opponentKey(b));
    expect(opponentKey(cleanOpponent({ kind: "deck", deck: "abc", label: "", detail: "" })!)).not.toBe(opponentKey(cleanOpponent({ kind: "deck", deck: "abd", label: "", detail: "" })!));
  });
});

describe("seededOrder", () => {
  const items = Array.from({ length: 40 }, (_, i) => i);
  it("gives the same order for the same seed, and another for another", () => {
    expect(seededOrder(items, "2026-11-10:deck")).toEqual(seededOrder(items, "2026-11-10:deck"));
    expect(seededOrder(items, "2026-11-11:deck")).not.toEqual(seededOrder(items, "2026-11-10:deck"));
  });
  it("keeps every item, and leaves the list it was given alone", () => {
    expect([...seededOrder(items, "seed")].sort((a, b) => a - b)).toEqual(items);
    expect(items[0]).toBe(0);
  });
});

describe("parseTopCommanders", () => {
  it("reads EDHREC's list, most played first", () => {
    const page = { container: { json_dict: { cardlists: [{ header: "Past Year", cardviews: [{ name: "Edgar Markov", num_decks: 40000 }, { name: "Kaalia of the Vast", num_decks: 30000 }, { name: 5 }, { num_decks: 1 }] }] } } };
    expect(parseTopCommanders(page)).toEqual([
      { name: "Edgar Markov", decks: 40000 },
      { name: "Kaalia of the Vast", decks: 30000 },
    ]);
  });
  it("is empty for a page that isn't one", () => {
    for (const bad of [null, {}, { container: {} }, { container: { json_dict: { cardlists: "x" } } }]) expect(parseTopCommanders(bad)).toEqual([]);
  });
});

describe("commanderQuery", () => {
  it("asks for commanders with each typed word in the name", () => {
    expect(commanderQuery("Atraxa pra")).toBe('is:commander name:"atraxa" name:"pra"');
    expect(commanderQuery("  K'rrik,  son ")).toBe(`is:commander name:"k'rrik" name:"son"`);
  });
  it("can't be turned into another search", () => {
    expect(commanderQuery('x" or t:land (')).toBe('is:commander name:"x" name:"or" name:"t" name:"land"');
  });
  it("wants two letters", () => {
    expect(commanderQuery("a")).toBeNull();
    expect(commanderQuery(" ,- ")).toBeNull();
  });
});
