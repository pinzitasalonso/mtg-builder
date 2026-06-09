import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { parseId } from "@/lib/api";

const MAX_QTY = 999;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const deckId = parseId((await params).id);
  if (!deckId) return NextResponse.json({ error: "invalid deck id" }, { status: 400 });
  const cards = await prisma.poolCard.findMany({
    where: { deckId },
    orderBy: { addedAt: "asc" },
  });
  return NextResponse.json(cards);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const deckId = parseId((await params).id);
  if (!deckId) return NextResponse.json({ error: "invalid deck id" }, { status: 400 });
  const body = await req.json();
  const { scryfallId, name, imageUri, manaCost, typeLine, oracleText } = body;
  if (
    typeof scryfallId !== "string" || !scryfallId ||
    typeof name !== "string" || !name ||
    typeof imageUri !== "string" || !imageUri
  ) {
    return NextResponse.json({ error: "scryfallId, name, imageUri required" }, { status: 400 });
  }

  const deck = await prisma.deck.findUnique({ where: { id: deckId }, select: { id: true } });
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });

  // quantity is how many copies to add; defaults to 1, clamped so a bad client
  // can't create absurd stacks. Adding a card already in the pool increments
  // its count rather than erroring (basics & decklist merges).
  const qty = Math.min(
    MAX_QTY,
    Number.isFinite(body.quantity) && body.quantity > 0 ? Math.floor(body.quantity) : 1
  );
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const card = await prisma.poolCard.upsert({
    where: { deckId_scryfallId: { deckId, scryfallId } },
    update: { quantity: { increment: qty } },
    create: {
      deckId,
      scryfallId,
      name,
      imageUri,
      manaCost: str(manaCost),
      typeLine: str(typeLine),
      oracleText: str(oracleText),
      quantity: qty,
    },
  });
  return NextResponse.json(card, { status: 201 });
}
