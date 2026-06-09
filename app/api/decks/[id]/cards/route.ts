import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cards = await prisma.poolCard.findMany({
    where: { deckId: Number(id) },
    orderBy: { addedAt: "asc" },
  });
  return NextResponse.json(cards);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { scryfallId, name, imageUri, manaCost, typeLine, oracleText } = body;
  if (!scryfallId || !name || !imageUri) {
    return NextResponse.json({ error: "scryfallId, name, imageUri required" }, { status: 400 });
  }
  // quantity is how many copies to add; defaults to 1. Adding a card already in
  // the pool increments its count rather than erroring (basics & decklist merges).
  const qty = Number.isFinite(body.quantity) && body.quantity > 0 ? Math.floor(body.quantity) : 1;
  const card = await prisma.poolCard.upsert({
    where: { deckId_scryfallId: { deckId: Number(id), scryfallId } },
    update: { quantity: { increment: qty } },
    create: { deckId: Number(id), scryfallId, name, imageUri, manaCost, typeLine, oracleText, quantity: qty },
  });
  return NextResponse.json(card, { status: 201 });
}
