import { describe, expect, it } from "vitest";
import { jsonRequest, makeUser, params, prisma, signIn, signOut } from "@/test/db";
import { POST as createDeck } from "@/app/api/decks/route";
import { POST as addCard } from "@/app/api/decks/[id]/cards/route";
import { CARD_TEXT_MAX } from "@/lib/api";
import { FREE_DECK_LIMIT } from "@/lib/limits";

const IMAGE = "https://cards.scryfall.io/normal/front/a/b/sol-ring.jpg";

describe("POST /api/decks", () => {
  it("needs an account", async () => {
    signOut();
    const res = await createDeck(jsonRequest("/api/decks", { name: "Mine" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "sign_in" });
    expect(await prisma.deck.count()).toBe(0);
  });

  it("keeps a free account to its deck limit when the requests arrive together", async () => {
    const user = await makeUser();
    await signIn(user);
    const asked = FREE_DECK_LIMIT + 5;
    const statuses = await Promise.all(Array.from({ length: asked }, async (_, i) => (await createDeck(jsonRequest("/api/decks", { name: `Deck ${i}` }))).status));
    expect(statuses.filter((s) => s === 201)).toHaveLength(FREE_DECK_LIMIT);
    expect(statuses.filter((s) => s === 403)).toHaveLength(5);
    expect(await prisma.deck.count({ where: { userId: user.id } })).toBe(FREE_DECK_LIMIT);
  });

  it("has no limit on Pro", async () => {
    const user = await makeUser({ tier: "pro" });
    await signIn(user);
    const statuses = await Promise.all(Array.from({ length: FREE_DECK_LIMIT + 2 }, async (_, i) => (await createDeck(jsonRequest("/api/decks", { name: `Deck ${i}` }))).status));
    expect(statuses.every((s) => s === 201)).toBe(true);
  });

  it("cuts a deck's name to size and refuses an empty one", async () => {
    await signIn(await makeUser());
    expect((await createDeck(jsonRequest("/api/decks", { name: "   " }))).status).toBe(400);
    expect((await createDeck(jsonRequest("/api/decks", ["not", "an", "object"]))).status).toBe(400);
    const deck = await (await createDeck(jsonRequest("/api/decks", { name: "x".repeat(5000), format: "modern" }))).json();
    expect(deck.name).toHaveLength(120);
  });
});

describe("POST /api/decks/<id>/cards", () => {
  async function deckOf(userId: number) {
    return prisma.deck.create({ data: { name: "Mine", userId, format: "modern", publicId: `d-${userId}-${Math.random().toString(36).slice(2)}` } });
  }
  const sol = { scryfallId: "sol-ring", name: "Sol Ring", imageUri: IMAGE, typeLine: "Artifact", manaCost: "{1}", oracleText: "{T}: Add {C}{C}." };

  it("adds a card, and a second add raises its count", async () => {
    const user = await makeUser();
    await signIn(user);
    const deck = await deckOf(user.id);
    const p = params({ id: deck.publicId! });
    expect((await addCard(jsonRequest("/x", sol), p)).status).toBe(201);
    await addCard(jsonRequest("/x", { ...sol, quantity: 2 }), p);
    const rows = await prisma.poolCard.findMany({ where: { deckId: deck.id } });
    expect(rows.map((r) => [r.name, r.quantity, r.imageUri])).toEqual([["Sol Ring", 3, IMAGE]]);
  });

  it("refuses a card whose image isn't Scryfall's", async () => {
    const user = await makeUser();
    await signIn(user);
    const deck = await deckOf(user.id);
    const p = params({ id: deck.publicId! });
    for (const imageUri of ["https://evil.example/track.gif", "http://cards.scryfall.io/x.jpg", "javascript:alert(1)", "https://cards.scryfall.io.evil.example/x.jpg", undefined]) {
      expect((await addCard(jsonRequest("/x", { ...sol, imageUri }), p)).status).toBe(400);
    }
    expect(await prisma.poolCard.count({ where: { deckId: deck.id } })).toBe(0);
  });

  it("cuts a card's text to a card's size", async () => {
    const user = await makeUser();
    await signIn(user);
    const deck = await deckOf(user.id);
    await addCard(jsonRequest("/x", { ...sol, oracleText: "x".repeat(50_000), typeLine: "y".repeat(5000) }), params({ id: deck.publicId! }));
    const row = await prisma.poolCard.findFirstOrThrow({ where: { deckId: deck.id } });
    expect(row.oracleText).toHaveLength(CARD_TEXT_MAX.oracleText);
    expect(row.typeLine).toHaveLength(CARD_TEXT_MAX.typeLine);
  });

  it("is a 404 on someone else's deck", async () => {
    const owner = await makeUser();
    const deck = await deckOf(owner.id);
    const p = params({ id: deck.publicId! });
    signOut();
    expect((await addCard(jsonRequest("/x", sol), p)).status).toBe(404);
    await signIn(await makeUser());
    expect((await addCard(jsonRequest("/x", sol), p)).status).toBe(404);
    expect(await prisma.poolCard.count({ where: { deckId: deck.id } })).toBe(0);
  });

  it("adds the printing the player owns", async () => {
    const user = await makeUser();
    await signIn(user);
    const deck = await deckOf(user.id);
    const mine = "https://cards.scryfall.io/normal/front/1/2/12345678-1234-1234-1234-123456789abc.jpg";
    await prisma.collectionCard.create({ data: { userId: user.id, name: "Sol Ring", nameKey: "sol ring", quantity: 1, imageUri: mine } });
    await addCard(jsonRequest("/x", sol), params({ id: deck.publicId! }));
    const row = await prisma.poolCard.findFirstOrThrow({ where: { deckId: deck.id } });
    expect([row.scryfallId, row.imageUri]).toEqual(["12345678-1234-1234-1234-123456789abc", mine]);
  });
});
