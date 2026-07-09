import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, canEditDeck, currentUser, viewableDeckByPublicId } from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  // View access: the owner, an ownerless public deck, or a shared deck.
  const deck = await viewableDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const counted = await prisma.deck.findUnique({
    where: { id: deck.id },
    include: { _count: { select: { cards: true } } },
  });
  return NextResponse.json({
    ...counted,
    isPublic: deck.userId === null,
    canEdit: canEditDeck(deck, user?.id ?? null),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  const deck = await accessibleDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const body = await req.json();
  const data: { name?: string; format?: string; commander?: string | null; notes?: string | null; shared?: boolean } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.format === "string" && body.format.trim()) data.format = body.format.trim();
  if ("commander" in body) {
    const c = typeof body.commander === "string" ? body.commander.trim() : "";
    data.commander = c || null;
  }
  if ("notes" in body) {
    const n = typeof body.notes === "string" ? body.notes.slice(0, 20_000) : "";
    data.notes = n.trim() ? n : null;
  }
  if (typeof body.shared === "boolean") data.shared = body.shared;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }
  const updated = await prisma.deck.update({ where: { id: deck.id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  const deck = await accessibleDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  await prisma.deck.delete({ where: { id: deck.id } });
  return new NextResponse(null, { status: 204 });
}
