import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser, viewableDeckByPublicId } from "@/lib/auth";
import type { VersionCard } from "@/lib/deck-diff";

// Enough to keep a build's history; a deck is not a git repo.
const MAX_VERSIONS = 30;
const MAX_LABEL = 80;

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
  const count = await prisma.deckVersion.count({ where: { deckId: deck.id } });
  if (count >= MAX_VERSIONS) {
    return NextResponse.json({ error: `A deck keeps at most ${MAX_VERSIONS} versions — delete one first.` }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, MAX_LABEL) : null;
  const rows = await prisma.poolCard.findMany({
    where: { deckId: deck.id },
    select: { name: true, quantity: true, board: true, scryfallId: true },
    orderBy: { addedAt: "asc" },
  });
  const cards: VersionCard[] = rows.map((r) => ({
    name: r.name,
    quantity: r.quantity,
    board: r.board === "deck" ? "deck" : "pool",
    scryfallId: r.scryfallId,
  }));
  const deckCount = cards.filter((c) => c.board === "deck").reduce((n, c) => n + c.quantity, 0);
  const poolCount = cards.filter((c) => c.board === "pool").reduce((n, c) => n + c.quantity, 0);
  const version = await prisma.deckVersion.create({
    data: { deckId: deck.id, label, cards: JSON.stringify(cards), deckCount, poolCount },
    select: { id: true, label: true, createdAt: true, deckCount: true, poolCount: true },
  });
  return NextResponse.json(version, { status: 201 });
}
