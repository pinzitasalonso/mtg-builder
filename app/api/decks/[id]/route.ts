import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { parseId } from "@/lib/api";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const deckId = parseId((await params).id);
  if (!deckId) return NextResponse.json({ error: "invalid deck id" }, { status: 400 });
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    include: { _count: { select: { cards: true } } },
  });
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  return NextResponse.json(deck);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const deckId = parseId((await params).id);
  if (!deckId) return NextResponse.json({ error: "invalid deck id" }, { status: 400 });
  const body = await req.json();
  const data: { name?: string; format?: string; commander?: string | null } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.format === "string" && body.format.trim()) data.format = body.format.trim();
  if ("commander" in body) {
    const c = typeof body.commander === "string" ? body.commander.trim() : "";
    data.commander = c || null;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }
  const { count } = await prisma.deck.updateMany({ where: { id: deckId }, data });
  if (count === 0) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const deck = await prisma.deck.findUnique({ where: { id: deckId } });
  return NextResponse.json(deck);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const deckId = parseId((await params).id);
  if (!deckId) return NextResponse.json({ error: "invalid deck id" }, { status: 400 });
  const { count } = await prisma.deck.deleteMany({ where: { id: deckId } });
  if (count === 0) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
