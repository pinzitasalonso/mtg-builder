// The data behind a deck tile: each deck with its real deck size, colour
// identity, cover scan and last Score. Shared by GET /api/decks and the
// home page, which renders a signed-in player's decks on the server so the
// first paint is their home, not the landing.

import { deckFace } from "@/lib/deck-face";
import prisma from "@/lib/prisma";
import { newPublicId } from "@/lib/deck-id";
import { scanSummary } from "@/lib/deck-analysis";

// One-time: assign an unguessable publicId to any deck created before this
// column existed, so every deck has a stable URL. No-op once all are filled.
export async function backfillPublicIds() {
  const stale = await prisma.deck.findMany({ where: { publicId: null }, select: { id: true } });
  for (const d of stale) {
    await prisma.deck.update({ where: { id: d.id }, data: { publicId: newPublicId() } });
  }
}

type DeckRow = Awaited<ReturnType<typeof prisma.deck.findMany>>[number];

/** Decks as their tiles show them. */
export async function tileDecks(decks: DeckRow[]) {
  // Aggregate each deck's color identity (WUBRG order) and its real deck size.
  // The card count must reflect only cards promoted to the decklist (board
  // "deck"), not pool candidates — and summed by quantity, matching the deck
  // page — so the home progress bar shows actual progress toward the format.
  const cards = await prisma.poolCard.findMany({
    where: { deckId: { in: decks.map((d) => d.id) } },
    select: { deckId: true, colorIdentity: true, board: true, quantity: true, name: true, imageUri: true, typeLine: true, manaCost: true },
  });
  // The tile's art is the stored scan of the deck's face (lib/deck-face.ts):
  // its commander, or with none the card its list is most about. The tile
  // cuts its art crop from that scan on cards.scryfall.io instead of asking
  // Scryfall's API by name, which allows two lookups a second (a home page
  // of decks went over).
  const cardsByDeck = new Map<number, typeof cards>();
  for (const c of cards) {
    const list = cardsByDeck.get(c.deckId);
    if (list) list.push(c);
    else cardsByDeck.set(c.deckId, [c]);
  }
  const coverByDeck = new Map<number, string>();
  for (const d of decks) {
    const face = deckFace(d.commander, cardsByDeck.get(d.id) ?? []);
    if (face?.imageUri) coverByDeck.set(d.id, face.imageUri);
  }
  const colorsByDeck = new Map<number, Set<string>>();
  const deckCountByDeck = new Map<number, number>();
  for (const c of cards) {
    if (c.board === "deck") {
      deckCountByDeck.set(c.deckId, (deckCountByDeck.get(c.deckId) ?? 0) + c.quantity);
    }
    if (!c.colorIdentity) continue;
    const set = colorsByDeck.get(c.deckId) ?? new Set<string>();
    for (const ch of c.colorIdentity) if ("WUBRG".includes(ch)) set.add(ch);
    colorsByDeck.set(c.deckId, set);
  }
  // The last scan travels as its summary (Score and bracket, for the deck's
  // tile), not as the stored JSON: the full scan is several KB a deck, and
  // both clients read it from /scan on the deck's own page.
  return decks.map(({ analysis, ...d }) => ({
    ...d,
    _count: { cards: deckCountByDeck.get(d.id) ?? 0 },
    colors: ["W", "U", "B", "R", "G"].filter((ch) => colorsByDeck.get(d.id)?.has(ch)),
    scan: scanSummary(analysis),
    cover: coverByDeck.get(d.id) ?? null,
  }));
}

/** A player's own decks, pinned first then newest, as tiles. */
export async function ownDecks(userId: number) {
  await backfillPublicIds();
  const decks = await prisma.deck.findMany({ where: { userId }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 100 });
  return tileDecks(decks);
}
