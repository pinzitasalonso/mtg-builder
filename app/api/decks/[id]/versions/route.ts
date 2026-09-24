import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser, viewableDeckByPublicId } from "@/lib/auth";
import { snapshotDeck } from "@/lib/deck-versions";

// The saved versions of a deck, newest first — summaries only; the cards
// come from /versions/[versionId].
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  const deck = await viewableDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const versions = await prisma.deckVersion.findMany({
    where: { deckId: deck.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, createdAt: true, deckCount: true, poolCount: true },
  });
  return NextResponse.json(versions);
}

// Save the deck as it is now.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  const deck = await accessibleDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const label = typeof body?.label === "string" ? body.label : null;
  const r = await snapshotDeck(deck.id, label);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r.version, { status: 201 });
}
