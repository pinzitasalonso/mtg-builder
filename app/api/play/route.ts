import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { newPlayCode, PLAY_CODE_REPORT_WINDOW_MS, PLAY_CODE_TTL_MS } from "@/lib/play-code";

// POST /api/play — mint a "seat me at your table" code for one of MY decks.
// The code resolves publicly (the host's phone is another account, or none),
// so it only ever carries what the table can already see: player name, deck
// name, commander, art. The client sends the commander art URI it shows (the
// server deck row doesn't store art).
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const publicId = typeof body.deckPublicId === "string" ? body.deckPublicId : "";
  // Codes record results onto the deck, so only the OWNER can mint one.
  const deck = await prisma.deck.findFirst({ where: { publicId, userId: user.id } });
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });

  const commanderImageUri =
    typeof body.commanderImageUri === "string" && body.commanderImageUri.startsWith("https://")
      ? body.commanderImageUri.slice(0, 500)
      : null;

  // Housekeeping: a row lives past its join expiry so the seated game can
  // still report its result — only codes past the report window are swept.
  // (Never delete a deck's fresher codes: a re-mint mid-game would strand
  // the table that already seated the old one.)
  await prisma.playCode.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - PLAY_CODE_REPORT_WINDOW_MS) } },
  });

  const playerName = user.email.split("@")[0];
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newPlayCode();
    try {
      const row = await prisma.playCode.create({
        data: {
          code,
          userId: user.id,
          deckId: deck.id,
          playerName,
          deckName: deck.name,
          commander: deck.commander,
          commanderImageUri,
          expiresAt: new Date(Date.now() + PLAY_CODE_TTL_MS),
        },
      });
      return NextResponse.json({ code: row.code, expiresAt: row.expiresAt, playerName });
    } catch {
      // Code collision — extraordinarily unlikely; roll again.
    }
  }
  return NextResponse.json({ error: "could not mint a code" }, { status: 500 });
}
