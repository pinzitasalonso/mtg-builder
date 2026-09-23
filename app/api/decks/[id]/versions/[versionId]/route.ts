import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser, viewableDeckByPublicId } from "@/lib/auth";

const versionIdOf = (raw: string) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// One saved version, cards included.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  const user = await currentUser();
  const deck = await viewableDeckByPublicId(id, user?.id ?? null);
  const vid = versionIdOf(versionId);
  if (!deck || vid === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  const v = await prisma.deckVersion.findFirst({ where: { id: vid, deckId: deck.id } });
  if (!v) return NextResponse.json({ error: "not found" }, { status: 404 });
  let cards: unknown = [];
  try {
    cards = JSON.parse(v.cards);
  } catch {
    cards = [];
  }
  return NextResponse.json({ id: v.id, label: v.label, createdAt: v.createdAt, deckCount: v.deckCount, poolCount: v.poolCount, cards });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  const user = await currentUser();
  const deck = await accessibleDeckByPublicId(id, user?.id ?? null);
  const vid = versionIdOf(versionId);
  if (!deck || vid === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { count } = await prisma.deckVersion.deleteMany({ where: { id: vid, deckId: deck.id } });
  if (count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
