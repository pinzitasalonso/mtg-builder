import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser, viewableDeckByPublicId } from "@/lib/auth";
import { newPublicId } from "@/lib/deck-id";
import { DECK_LIMIT_MSG } from "@/lib/limits";
import { canCreateDeck } from "@/lib/limits-db";
import { recordEvent } from "@/lib/analytics";
import { withoutOwned } from "@/lib/collection-diff";

// Copy a deck (any deck the caller can see — their own or a public one) into a
// fresh deck they own, cards and all. The copy starts as a new, independent
// deck: its own publicId, owned by the current user (or public when signed out).
// Body { pool: false } copies the decklist only, leaving the pool behind.
// { missing: true } copies only what the caller doesn't own yet — the deck
// board less their collection, copy for copy (30 Mountains, 10 owned: 20) —
// which is a shopping list. It implies no pool, and needs a signed-in caller.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  if (user && !(await canCreateDeck(user))) {
    return NextResponse.json({ error: DECK_LIMIT_MSG, code: "deck_limit" }, { status: 403 });
  }
  // You can copy any deck you can see — your own, an ownerless public deck, or
  // one someone shared with you — into a fresh deck you own.
  const source = await viewableDeckByPublicId((await params).id, user?.id ?? null);
  if (!source) return NextResponse.json({ error: "deck not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const missing = body?.missing === true;
  if (missing && !user) return NextResponse.json({ error: "Sign in to leave out the cards you own." }, { status: 401 });
  const withPool = body?.pool !== false && !missing;
  let cards = await prisma.poolCard.findMany({ where: { deckId: source.id, ...(withPool ? {} : { board: "deck" }) } });
  if (missing) {
    const owned = await prisma.collectionCard.findMany({ where: { userId: user!.id }, select: { name: true, quantity: true } });
    cards = withoutOwned(cards, owned);
  }

  const copy = await prisma.deck.create({
    data: {
      name: `${source.name} (${missing ? "to buy" : "copy"})`,
      format: source.format,
      commander: source.commander,
      primer: source.primer,
      userId: user?.id ?? null,
      publicId: newPublicId(),
      cards: {
        create: cards.map((c) => ({
          scryfallId: c.scryfallId,
          name: c.name,
          imageUri: c.imageUri,
          manaCost: c.manaCost,
          typeLine: c.typeLine,
          oracleText: c.oracleText,
          quantity: c.quantity,
          board: c.board,
          role: c.role,
          colorIdentity: c.colorIdentity,
          legalities: c.legalities,
        })),
      },
    },
  });

  await recordEvent("deck_duplicated");
  return NextResponse.json(copy, { status: 201 });
}
