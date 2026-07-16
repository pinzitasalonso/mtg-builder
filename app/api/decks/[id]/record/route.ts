import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";

// POST /api/decks/[id]/record {won} — the owner's own tracker logging a
// finished game on this deck, so the server record covers games hosted on
// their phone as well as games joined by play code elsewhere.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  const deck = await accessibleDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const won = body.won === true;
  const updated = await prisma.deck.update({
    where: { id: deck.id },
    data: { gamesPlayed: { increment: 1 }, ...(won ? { gamesWon: { increment: 1 } } : {}) },
    select: { gamesPlayed: true, gamesWon: true },
  });
  return NextResponse.json({ ok: true, gamesPlayed: updated.gamesPlayed, gamesWon: updated.gamesWon });
}
