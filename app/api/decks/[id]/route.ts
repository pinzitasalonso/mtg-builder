import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, canEditDeck, currentUser, viewableDeckByPublicId } from "@/lib/auth";
import { clampDeckRecord } from "@/lib/deck-record";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  // View access: the owner, an ownerless public deck, or a shared deck.
  const deck = await viewableDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  // One-shot backfill: notes is gone from both clients, and a deck whose
  // owner only ever wrote notes would otherwise lose that text. It becomes
  // the primer, which is where it was always headed — iOS already READ it
  // that way, falling back to notes when there was no primer.
  //
  // On read rather than as a migration because this app has no migration
  // framework (`prisma db push` on boot), and every deck gets read. The guard
  // means it can only ever fire once per deck.
  if (!deck.primer?.trim() && deck.notes?.trim()) {
    await prisma.deck.update({ where: { id: deck.id }, data: { primer: deck.notes } });
  }
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
  const data: { name?: string; format?: string; commander?: string | null; primer?: string | null; shared?: boolean; gamesPlayed?: number; gamesWon?: number } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.format === "string" && body.format.trim()) data.format = body.format.trim();
  if ("commander" in body) {
    const c = typeof body.commander === "string" ? body.commander.trim() : "";
    data.commander = c || null;
  }
  // The primer is a document, not a field — an AI-drafted one runs several
  // thousand characters, so it gets its own (larger) cap.
  if ("primer" in body) {
    const p = typeof body.primer === "string" ? body.primer.slice(0, 40_000) : "";
    data.primer = p.trim() ? p : null;
  }
  // The play record, SET rather than incremented — /record is the tracker
  // reporting one finished game, this is the owner correcting the totals by
  // hand. Without it a hand-edited record was local-only on the phone and the
  // next sync mirrored the server's untouched numbers straight back over it.
  if ("gamesPlayed" in body || "gamesWon" in body) {
    const record = clampDeckRecord(body, deck);
    data.gamesPlayed = record.gamesPlayed;
    data.gamesWon = record.gamesWon;
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
