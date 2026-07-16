import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { normalizePlayCode } from "@/lib/play-code";

// POST /api/play/[code]/result {won} — the host's tracker reporting a
// finished game for a code-claimed seat: a play on the deck's record, a win
// when that seat took the table. Public like the resolve — knowing a live
// code IS the authorization (it was handed across the table).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const code = normalizePlayCode((await params).code);
  if (!code) return NextResponse.json({ error: "code not found" }, { status: 404 });
  const row = await prisma.playCode.findUnique({ where: { code } });
  if (!row || row.expiresAt < new Date()) {
    return NextResponse.json({ error: "code not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const won = body.won === true;
  const deck = await prisma.deck.update({
    where: { id: row.deckId },
    data: { gamesPlayed: { increment: 1 }, ...(won ? { gamesWon: { increment: 1 } } : {}) },
    select: { gamesPlayed: true, gamesWon: true },
  });
  return NextResponse.json({ ok: true, gamesPlayed: deck.gamesPlayed, gamesWon: deck.gamesWon });
}
