import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";
import { isPro } from "@/lib/limits";

export const runtime = "nodejs";

// GET /api/decks/[id]/games — the deck's game history, newest first.
//
// PRO, and the OWNER'S. A shared deck's page shows its record because that is
// part of the deck; who its owner sat across from on a Tuesday is not, so this
// answers only to the account that owns it.
//
// A free account gets an empty list and `pro: false` rather than a 403. There
// is nothing to hide — the history was never written — and a client can render
// "keep a history with Pro" from a plain answer without treating it as an
// error.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  const deck = await accessibleDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });

  const owns = user?.id != null && deck.userId === user.id;
  if (!owns || !isPro(user)) {
    return NextResponse.json({ games: [], pro: isPro(user), owns });
  }

  const rows = await prisma.gameLog.findMany({
    where: { deckId: deck.id },
    orderBy: { playedAt: "desc" },
    take: 200,
  });

  return NextResponse.json({
    pro: true,
    owns: true,
    games: rows.map((r) => ({
      id: r.id,
      won: r.won,
      // Stored as JSON because SQLite has no array type. A row written before
      // this shipped, or by hand, should not take the page down.
      opponents: safeNames(r.opponents),
      note: r.note,
      isManual: r.isManual,
      playedAt: r.playedAt.toISOString(),
    })),
  });
}

function safeNames(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}
