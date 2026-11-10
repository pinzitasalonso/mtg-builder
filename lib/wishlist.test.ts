import { describe, expect, it } from "vitest";
import { MAX_WANTED, parseWishlistAdd, stillWanted, wishlistSummary } from "./wishlist";
import { wishlistText } from "./wishlist-client";

describe("parseWishlistAdd", () => {
  it("takes one name, or a list; cleans and merges by name", () => {
    expect(parseWishlistAdd({ name: "  Sol Ring " })).toEqual([{ name: "Sol Ring", quantity: 1, imageUri: null, typeLine: null, manaCost: null, colorIdentity: null }]);
    const many = parseWishlistAdd({ cards: [{ name: "Sol Ring", quantity: 2 }, { name: "sol ring", quantity: 3 }, { name: "" }, null, { name: "Forest", quantity: -4 }] });
    expect(many.map((c) => [c.name, c.quantity])).toEqual([["Sol Ring", 5], ["Forest", 1]]);
    expect(parseWishlistAdd({ cards: [{ name: "Forest", quantity: 500 }] })[0]!.quantity).toBe(MAX_WANTED);
    expect(parseWishlistAdd(null)).toEqual([]);
    expect(parseWishlistAdd({ cards: "x" })).toEqual([]);
  });

  it("keeps only Scryfall images and WUBRG letters", () => {
    const [ok, bad] = parseWishlistAdd({
      cards: [
        { name: "A", imageUri: "https://cards.scryfall.io/normal/front/a/b/x.jpg", colorIdentity: "W,U", typeLine: "Artifact", manaCost: "{1}" },
        { name: "B", imageUri: "https://evil.example/x.jpg", colorIdentity: 5 },
      ],
    });
    expect(ok).toMatchObject({ imageUri: "https://cards.scryfall.io/normal/front/a/b/x.jpg", colorIdentity: "WU", typeLine: "Artifact", manaCost: "{1}" });
    expect(bad).toMatchObject({ imageUri: null, colorIdentity: null });
  });
});

describe("the list's totals", () => {
  const cards = [
    { name: "Sol Ring", quantity: 1, owned: 0, usdPrice: "1.50" },
    { name: "Forest", quantity: 4, owned: 1, usdPrice: "0.10" },
    { name: "Mox", quantity: 1, owned: 2, usdPrice: "900" },
    { name: "Odd", quantity: 2, owned: 0, usdPrice: null },
  ];

  it("counts what's still to get, and prices only that", () => {
    expect(stillWanted(cards[1]!)).toBe(3);
    expect(stillWanted(cards[2]!)).toBe(0);
    expect(wishlistSummary(cards)).toEqual({ unique: 4, total: 8, missing: 6, cost: 1.8, unpriced: 1, owned: 2 });
  });

  it("writes the copies still to get as a list", () => {
    expect(wishlistText(cards)).toBe("1 Sol Ring\n3 Forest\n2 Odd");
  });
});
