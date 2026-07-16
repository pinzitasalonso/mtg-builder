import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { normalizePlayCode } from "@/lib/play-code";

// A gentle shared guess-brake for code lookups (same per-process spirit as
// lib/ratelimit.ts): a table types a handful of codes a minute, a scanner
// doesn't get to hammer six-character space.
const WINDOW_MS = 60_000;
const MAX_LOOKUPS = 60;
let stamps: number[] = [];
function lookupAllowed(): boolean {
  const now = Date.now();
  stamps = stamps.filter((t) => now - t < WINDOW_MS);
  if (stamps.length >= MAX_LOOKUPS) return false;
  stamps.push(now);
  return true;
}

// GET /api/play/[code] — resolve a code to its seat: player, deck, art.
// Public on purpose: the host device is a different account, or none at all.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const code = normalizePlayCode((await params).code);
  if (!code) return NextResponse.json({ error: "code not found" }, { status: 404 });
  if (!lookupAllowed()) {
    return NextResponse.json({ error: "too many lookups — try again in a minute" }, { status: 429 });
  }
  const row = await prisma.playCode.findUnique({ where: { code } });
  if (!row || row.expiresAt < new Date()) {
    return NextResponse.json({ error: "code not found" }, { status: 404 });
  }
  return NextResponse.json({
    playerName: row.playerName,
    deckName: row.deckName,
    commander: row.commander,
    commanderImageUri: row.commanderImageUri,
  });
}
