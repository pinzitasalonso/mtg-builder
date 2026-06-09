import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { parseId } from "@/lib/api";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> }
) {
  const { id, cardId } = await params;
  const deckId = parseId(id);
  const cid = parseId(cardId);
  if (!deckId || !cid) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  // Scoped to the deck so a card id from another deck can't be deleted through
  // this URL; deleteMany also makes a missing row a 404 instead of a 500.
  const { count } = await prisma.poolCard.deleteMany({ where: { id: cid, deckId } });
  if (count === 0) return NextResponse.json({ error: "card not found in deck" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
