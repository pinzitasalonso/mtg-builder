import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const decks = await prisma.deck.findMany({
    where: { userId: user.id },
    include: { _count: { select: { cards: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(decks);
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const format = typeof body.format === "string" && body.format.trim() ? body.format.trim() : "commander";
  const commander = typeof body.commander === "string" && body.commander.trim() ? body.commander.trim() : null;
  const deck = await prisma.deck.create({ data: { name, format, commander, userId: user.id } });
  return NextResponse.json(deck, { status: 201 });
}
