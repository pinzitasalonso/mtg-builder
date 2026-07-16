import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { normalizePlayCode, PLAY_CODE_REPORT_WINDOW_MS } from "@/lib/play-code";
import { clientIp, rateLimit } from "@/lib/ratelimit";

// POST /api/play/[code]/result {won} — the host's tracker reporting a
// finished game for a code-claimed seat: a play on the deck's record, a win
// when that seat took the table. Public like the resolve — knowing the code
// IS the authorization (it was handed across the table). Gated by the REPORT
// window, not the short join expiry: the game runs long past the 10 minutes
// in which the code could be entered.
//
// A result records the game EXACTLY ONCE: the first report stamps reportedAt,
// and the increment only happens for the request that wins that stamp. So a
// code can't be replayed — by the table or by anyone who guesses it — to pad a
// deck's win/loss record. A per-IP brake keeps the endpoint from being hammered
// as a code-existence oracle.
const WINDOW_MS = 60_000;
const MAX_REPORTS_PER_IP = 20;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const code = normalizePlayCode((await params).code);
  if (!code) return NextResponse.json({ error: "code not found" }, { status: 404 });
  if (!rateLimit(`play-result:${clientIp(req)}`, MAX_REPORTS_PER_IP, WINDOW_MS)) {
    return NextResponse.json({ error: "too many reports — try again in a minute" }, { status: 429 });
  }

  const row = await prisma.playCode.findUnique({ where: { code } });
  if (!row || row.createdAt < new Date(Date.now() - PLAY_CODE_REPORT_WINDOW_MS)) {
    return NextResponse.json({ error: "code not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const won = body.won === true;

  // Claim the single report slot atomically: only the request that flips
  // reportedAt from null gets to record the game. Concurrent or repeat reports
  // see count 0 and fall through to an idempotent no-op response.
  const claim = await prisma.playCode.updateMany({
    where: { code, reportedAt: null },
    data: { reportedAt: new Date() },
  });
  if (claim.count === 0) {
    const deck = await prisma.deck.findUnique({
      where: { id: row.deckId },
      select: { gamesPlayed: true, gamesWon: true },
    });
    return NextResponse.json({
      ok: true,
      alreadyReported: true,
      gamesPlayed: deck?.gamesPlayed ?? 0,
      gamesWon: deck?.gamesWon ?? 0,
    });
  }

  const deck = await prisma.deck.update({
    where: { id: row.deckId },
    data: { gamesPlayed: { increment: 1 }, ...(won ? { gamesWon: { increment: 1 } } : {}) },
    select: { gamesPlayed: true, gamesWon: true },
  });
  return NextResponse.json({ ok: true, gamesPlayed: deck.gamesPlayed, gamesWon: deck.gamesWon });
}
