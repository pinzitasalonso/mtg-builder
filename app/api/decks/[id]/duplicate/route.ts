import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser, viewableDeckByPublicId } from "@/lib/auth";
import { newPublicId } from "@/lib/deck-id";
import { DECK_LIMIT_MSG } from "@/lib/limits";
import { canCreateDeck } from "@/lib/limits-db";
import { recordEvent } from "@/lib/analytics";

// Copy a deck (any deck the caller can see — their own or a public one) into a
// fresh deck they own, cards and all. The copy starts as a new, independent
// deck: its own publicId, owned by the current user (or public when signed out).
export async function POST(
  _req: Request,
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

  const cards = await prisma.poolCard.findMany({ where: { deckId: source.id } });

  const copy = await prisma.deck.create({
    data: {
      name: `${source.name} (copy)`,
      format: source.format,
      commander: source.commander,
      notes: source.notes,
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
