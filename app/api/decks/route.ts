import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  const decks = await prisma.deck.findMany({
    include: { _count: { select: { cards: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(decks);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, format = "commander", commander } = body;
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const deck = await prisma.deck.create({ data: { name, format, commander } });
  return NextResponse.json(deck, { status: 201 });
}
