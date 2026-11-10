import { beforeEach, describe, expect, it } from "vitest";
import { jsonRequest, makeUser, prisma, signIn, signOut } from "@/test/db";
import { DELETE, GET, PATCH, POST } from "@/app/api/wishlist/route";

// A card with its details, so the route has nothing to look up.
const card = (name: string, quantity = 1) => ({
  name,
  quantity,
  imageUri: `https://cards.scryfall.io/normal/front/a/b/${name.toLowerCase().replace(/\W/g, "")}.jpg`,
  typeLine: "Artifact",
  manaCost: "{1}",
  colorIdentity: "",
});

describe("/api/wishlist", () => {
  let user: { id: number };
  beforeEach(async () => {
    user = await makeUser();
    await signIn(user);
  });

  it("needs an account to add, and is empty when signed out", async () => {
    signOut();
    expect((await POST(jsonRequest("/api/wishlist", card("Sol Ring")))).status).toBe(401);
    expect(await (await GET(jsonRequest("/api/wishlist"))).json()).toMatchObject({ cards: [], unique: 0 });
  });

  it("raises a card already on the list to the quantity asked for, never sums or lowers", async () => {
    expect(await (await POST(jsonRequest("/api/wishlist", { cards: [card("Sol Ring", 2)] }))).json()).toMatchObject({ added: 1, raised: 0 });
    // The same again: still 2, not 4.
    expect(await (await POST(jsonRequest("/api/wishlist", { cards: [card("Sol Ring", 2)] }))).json()).toMatchObject({ added: 0, raised: 0, already: 1 });
    // More: raised to it.
    expect(await (await POST(jsonRequest("/api/wishlist", { cards: [card("sol ring", 3)] }))).json()).toMatchObject({ added: 0, raised: 1 });
    // Fewer: left alone.
    await POST(jsonRequest("/api/wishlist", { cards: [card("Sol Ring", 1)] }));
    const rows = await prisma.wishlistCard.findMany({ where: { userId: user.id } });
    expect(rows.map((r) => [r.name, r.quantity])).toEqual([["Sol Ring", 3]]);
  });

  it("lists each card with the copies owned now", async () => {
    await POST(jsonRequest("/api/wishlist", { cards: [card("Sol Ring", 2), card("Arcane Signet")] }));
    await prisma.collectionCard.create({ data: { userId: user.id, name: "Sol Ring", nameKey: "sol ring", quantity: 1 } });
    const body = await (await GET(jsonRequest("/api/wishlist"))).json();
    expect(body.cards.map((c: { name: string; owned: number }) => [c.name, c.owned])).toEqual([
      ["Arcane Signet", 0],
      ["Sol Ring", 1],
    ]);
    // Three copies wanted, one owned: two still to get. Scryfall is down in
    // tests, so nothing is priced, and the list still loads.
    expect(body).toMatchObject({ unique: 2, total: 3, missing: 2, cost: 0, unpriced: 2 });
  });

  it('"got it" moves the copies still wanted into the collection', async () => {
    await POST(jsonRequest("/api/wishlist", { cards: [card("Sol Ring", 3)] }));
    await prisma.collectionCard.create({ data: { userId: user.id, name: "Sol Ring", nameKey: "sol ring", quantity: 1 } });
    expect(await (await POST(jsonRequest("/api/wishlist", { got: "Sol Ring" }))).json()).toMatchObject({ ok: true, added: 2 });
    expect(await prisma.wishlistCard.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.collectionCard.findFirst({ where: { userId: user.id, nameKey: "sol ring" } }))?.quantity).toBe(3);
    // Twice is a 404, not a second copy.
    expect((await POST(jsonRequest("/api/wishlist", { got: "Sol Ring" }))).status).toBe(404);
  });

  it("keeps one player's list apart from another's", async () => {
    await POST(jsonRequest("/api/wishlist", { cards: [card("Sol Ring")] }));
    await signIn(await makeUser());
    expect((await (await GET(jsonRequest("/api/wishlist"))).json()).cards).toEqual([]);
    expect((await POST(jsonRequest("/api/wishlist", { got: "Sol Ring" }))).status).toBe(404);
  });

  it("sets a quantity, and clears the cards now owned", async () => {
    await POST(jsonRequest("/api/wishlist", { cards: [card("Sol Ring"), card("Arcane Signet", 2), card("Command Tower")] }));
    await PATCH(jsonRequest("/api/wishlist", { name: "Sol Ring", quantity: 500 }, "PATCH"));
    await PATCH(jsonRequest("/api/wishlist", { name: "Command Tower", quantity: 0 }, "PATCH"));
    await prisma.collectionCard.create({ data: { userId: user.id, name: "Arcane Signet", nameKey: "arcane signet", quantity: 2 } });
    expect(await (await DELETE(jsonRequest("/api/wishlist?owned=1", undefined, "DELETE"))).json()).toMatchObject({ removed: 1 });
    const rows = await prisma.wishlistCard.findMany({ where: { userId: user.id } });
    expect(rows.map((r) => [r.name, r.quantity])).toEqual([["Sol Ring", 99]]);
  });

  it("doesn't store an image that isn't Scryfall's", async () => {
    // Without its image the card is looked up by name; Scryfall is down in
    // tests, so it isn't added at all.
    const res = await POST(jsonRequest("/api/wishlist", { cards: [{ ...card("Sol Ring"), imageUri: "https://evil.example/x.jpg" }] }));
    expect(res.status).toBe(404);
    expect(await prisma.wishlistCard.count({ where: { userId: user.id } })).toBe(0);
  });
});
