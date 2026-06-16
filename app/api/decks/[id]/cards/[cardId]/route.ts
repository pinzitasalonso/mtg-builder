import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { parseId } from "@/lib/api";
import { accessibleDeck, currentUser } from "@/lib/auth";

const MAX_QTY = 999;

// Update a card in the pool: move it between boards ("pool" ↔ "deck") and/or set
// the exact copy count. Both fields are optional, but at least one is required.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> }
) {
  const user = await currentUser();
  const { id, cardId } = await params;
  const deckId = parseId(id);
  const cid = parseId(cardId);
  if (!deckId || !cid) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  if (!(await accessibleDeck(deckId, user?.id ?? null))) {
    return NextResponse.json({ error: "deck not found" }, { status: 404 });
  }
  const body = await req.json();

  const data: { board?: string; quantity?: number } = {};
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
  if (data.board === undefined && data.quantity === undefined) {
    return NextResponse.json({ error: "board or quantity required" }, { status: 400 });
  }

  const { count } = await prisma.poolCard.updateMany({ where: { id: cid, deckId }, data });
  if (count === 0) return NextResponse.json({ error: "card not found in deck" }, { status: 404 });
  const card = await prisma.poolCard.findUnique({ where: { id: cid } });
  return NextResponse.json(card);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> }
) {
  const user = await currentUser();
  const { id, cardId } = await params;
  const deckId = parseId(id);
  const cid = parseId(cardId);
  if (!deckId || !cid) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  if (!(await accessibleDeck(deckId, user?.id ?? null))) {
    return NextResponse.json({ error: "deck not found" }, { status: 404 });
  }
  // Scoped to the deck so a card id from another deck can't be deleted through
  // this URL; deleteMany also makes a missing row a 404 instead of a 500.
  const { count } = await prisma.poolCard.deleteMany({ where: { id: cid, deckId } });
  if (count === 0) return NextResponse.json({ error: "card not found in deck" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
