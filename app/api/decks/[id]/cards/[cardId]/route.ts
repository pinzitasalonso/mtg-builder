import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { parseId } from "@/lib/api";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";
import { isCommanderCard, singletonCapped } from "@/lib/commander";

const MAX_QTY = 999;

// Update a card in the pool: move it between boards ("pool" ↔ "deck"), set the
// exact copy count, and/or swap its printing (scryfallId + imageUri). Every
// field is optional, but at least one is required.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> }
) {
  const user = await currentUser();
  const { id, cardId } = await params;
  const cid = parseId(cardId);
  if (!cid) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const deck = await accessibleDeckByPublicId(id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const deckId = deck.id;
  const body = await req.json();

  const data: { board?: string; quantity?: number; scryfallId?: string; imageUri?: string } = {};
  if (body.board !== undefined) {
    if (body.board !== "pool" && body.board !== "deck") {
      return NextResponse.json({ error: "board must be 'pool' or 'deck'" }, { status: 400 });
    }
    data.board = body.board;
  }
  if (body.quantity !== undefined) {
    // Set the exact count (not an increment). Clamp to 1..MAX_QTY — removing the
    // last copy is the DELETE endpoint's job, not a quantity of 0.
    if (!Number.isFinite(body.quantity) || body.quantity < 1) {
      return NextResponse.json({ error: "quantity must be a positive number" }, { status: 400 });
    }
    data.quantity = Math.min(MAX_QTY, Math.floor(body.quantity));
  }
  if (body.scryfallId !== undefined) {
    // Swap the printing in place (used when the player picks a specific
    // version). The card's identity — name, types, oracle text — is unchanged,
    // so only the Scryfall id and its image move; the DELETE-then-add path
    // can't do this for a commander, which the server refuses to delete.
    if (typeof body.scryfallId !== "string" || !body.scryfallId.trim()) {
      return NextResponse.json({ error: "scryfallId must be a non-empty string" }, { status: 400 });
    }
    data.scryfallId = body.scryfallId;
    if (body.imageUri !== undefined) {
      if (typeof body.imageUri !== "string" || !body.imageUri) {
        return NextResponse.json({ error: "imageUri must be a non-empty string" }, { status: 400 });
      }
      data.imageUri = body.imageUri;
    }
  }
  if (data.board === undefined && data.quantity === undefined && data.scryfallId === undefined) {
    return NextResponse.json({ error: "board, quantity, or scryfallId required" }, { status: 400 });
  }

  // Commander-format rules: the commander stays on the deck board, and a
  // non-basic can't be set to more than one copy.
  if (data.board === "pool" || (data.quantity !== undefined && data.quantity > 1)) {
    const card = await prisma.poolCard.findFirst({ where: { id: cid, deckId }, select: { name: true, typeLine: true } });
    if (card) {
      if (data.board === "pool" && isCommanderCard(deck, card.name)) {
        return NextResponse.json({ error: "The commander can't leave the deck." }, { status: 409 });
      }
      if (data.quantity !== undefined && data.quantity > 1 && singletonCapped(deck.format, card.typeLine)) {
        return NextResponse.json({ error: "Commander decks allow only one copy of a non-basic card." }, { status: 409 });
      }
    }
  }

  try {
    const { count } = await prisma.poolCard.updateMany({ where: { id: cid, deckId }, data });
    if (count === 0) return NextResponse.json({ error: "card not found in deck" }, { status: 404 });
  } catch (e) {
    // @@unique([deckId, scryfallId]) — the target printing is already in the deck.
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "That printing is already in the deck." }, { status: 409 });
    }
    throw e;
  }
  const card = await prisma.poolCard.findUnique({ where: { id: cid } });
  return NextResponse.json(card);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> }
) {
  const user = await currentUser();
  const { id, cardId } = await params;
  const cid = parseId(cardId);
  if (!cid) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const deck = await accessibleDeckByPublicId(id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const deckId = deck.id;
  // The commander can't be removed from a commander deck.
  const target = await prisma.poolCard.findFirst({ where: { id: cid, deckId }, select: { name: true } });
  if (target && isCommanderCard(deck, target.name)) {
    return NextResponse.json({ error: "The commander can't be removed." }, { status: 409 });
  }
  // Scoped to the deck so a card id from another deck can't be deleted through
  // this URL; deleteMany also makes a missing row a 404 instead of a 500.
  const { count } = await prisma.poolCard.deleteMany({ where: { id: cid, deckId } });
  if (count === 0) return NextResponse.json({ error: "card not found in deck" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
