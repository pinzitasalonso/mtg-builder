import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { normalizePlayCode } from "@/lib/play-code";
import { clientIp, rateLimit } from "@/lib/ratelimit";

// A per-client guess-brake for code lookups: a table types a handful of codes a
// minute, so a scanner doesn't get to hammer the six-character space. Keyed by
// IP so one abuser can't lock out every legitimate table (the old brake was a
// single global bucket).
const LOOKUP_WINDOW_MS = 60_000;
const MAX_LOOKUPS_PER_IP = 20;

// GET /api/play/[code] — resolve a code to its seat: player, deck, art.
// Public on purpose: the host device is a different account, or none at all.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const code = normalizePlayCode((await params).code);
  if (!code) return NextResponse.json({ error: "code not found" }, { status: 404 });
  if (!rateLimit(`play-lookup:${clientIp(req)}`, MAX_LOOKUPS_PER_IP, LOOKUP_WINDOW_MS)) {
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
