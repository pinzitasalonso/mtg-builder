import { describe, expect, it } from "vitest";
import { jsonRequest, makeUser, params, prisma, signIn, signOut } from "@/test/db";
import { GET, POST } from "@/app/api/decks/[id]/assemble/route";

let seq = 0;
async function makeDeck(userId: number, name: string, cards: { name: string; board?: string; assembled?: boolean; quantity?: number }[]) {
  seq += 1;
  return prisma.deck.create({
    data: {
      name,
      userId,
      publicId: `deck-${seq}`,
      format: "modern",
      cards: {
        create: cards.map((c, i) => ({
          scryfallId: `${seq}-${i}`,
          name: c.name,
          imageUri: "https://cards.scryfall.io/normal/front/a/b/x.jpg",
          board: c.board ?? "deck",
          assembled: c.assembled ?? false,
          quantity: c.quantity ?? 1,
        })),
      },
    },
    include: { cards: true },
  });
}

describe("/api/decks/<id>/assemble", () => {
  it("ticks and unticks cards, and resets the deck", async () => {
    const user = await makeUser();
    await signIn(user);
    const deck = await makeDeck(user.id, "Mine", [{ name: "Sol Ring" }, { name: "Arcane Signet" }, { name: "Opt", board: "pool" }]);
    const [ring, signet] = deck.cards;
    const p = params({ id: deck.publicId! });

    expect(await (await POST(jsonRequest("/x", { cardIds: [ring.id, signet.id], assembled: true }), p)).json()).toMatchObject({ updated: 2 });
    expect((await (await GET(jsonRequest("/x"), p)).json()).assembled.sort()).toEqual([ring.id, signet.id].sort());

    await POST(jsonRequest("/x", { cardIds: [signet.id], assembled: false }), p);
    expect((await (await GET(jsonRequest("/x"), p)).json()).assembled).toEqual([ring.id]);

    await POST(jsonRequest("/x", { reset: true }), p);
    expect((await (await GET(jsonRequest("/x"), p)).json()).assembled).toEqual([]);

    expect((await POST(jsonRequest("/x", { cardIds: [], assembled: true }), p)).status).toBe(400);
  });

  it("can't tick a card of another deck through this one", async () => {
    const user = await makeUser();
    await signIn(user);
    const mine = await makeDeck(user.id, "Mine", [{ name: "Sol Ring" }]);
    const other = await makeDeck(user.id, "Other", [{ name: "Opt" }]);
    const res = await POST(jsonRequest("/x", { cardIds: [other.cards[0].id], assembled: true }), params({ id: mine.publicId! }));
    expect(await res.json()).toMatchObject({ updated: 0 });
    expect((await prisma.poolCard.findUnique({ where: { id: other.cards[0].id } }))?.assembled).toBe(false);
  });

  it("says which of the owner's other decks hold a card, ticked ones first", async () => {
    const user = await makeUser();
    const stranger = await makeUser();
    await signIn(user);
    const deck = await makeDeck(user.id, "Building", [{ name: "Sol Ring" }, { name: "Opt" }]);
    await makeDeck(user.id, "Aaa pool only", [{ name: "Sol Ring", board: "pool" }]);
    await makeDeck(user.id, "Bbb plays it", [{ name: "Sol Ring", quantity: 2 }]);
    await makeDeck(user.id, "Ccc built", [{ name: "Sol Ring", assembled: true }]);
    await makeDeck(stranger.id, "Not mine", [{ name: "Sol Ring", assembled: true }]);

    const body = await (await GET(jsonRequest("/x"), params({ id: deck.publicId! }))).json();
    expect(body.elsewhere["sol ring"].map((d: { name: string; deck: number; assembled: boolean }) => [d.name, d.deck, d.assembled])).toEqual([
      ["Ccc built", 1, true],
      ["Bbb plays it", 2, false],
      ["Aaa pool only", 0, false],
    ]);
    expect(body.elsewhere["opt"]).toBeUndefined();
  });

  it("is a 404 on someone else's deck, signed in or not", async () => {
    const owner = await makeUser();
    const deck = await makeDeck(owner.id, "Private", [{ name: "Sol Ring" }]);
    const p = params({ id: deck.publicId! });
    const tick = () => POST(jsonRequest("/x", { cardIds: [deck.cards[0].id], assembled: true }), p);

    signOut();
    expect((await GET(jsonRequest("/x"), p)).status).toBe(404);
    expect((await tick()).status).toBe(404);

    await signIn(await makeUser());
    expect((await GET(jsonRequest("/x"), p)).status).toBe(404);
    expect((await tick()).status).toBe(404);
    expect((await prisma.poolCard.findUnique({ where: { id: deck.cards[0].id } }))?.assembled).toBe(false);
  });
});
