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
  try {
    const card = await prisma.poolCard.create({
      data: { deckId: Number(id), scryfallId, name, imageUri, manaCost, typeLine, oracleText },
    });
    return NextResponse.json(card, { status: 201 });
  } catch {
    // unique constraint — card already in pool
    return NextResponse.json({ error: "card already in pool" }, { status: 409 });
  }
}
