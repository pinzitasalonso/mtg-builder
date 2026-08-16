import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";
import { isPro } from "@/lib/limits";

export const runtime = "nodejs";

/** Opponent names in, a clean JSON array out. Mirrors iOS's parseOpponents. */
function opponentsJson(value: unknown): string {
  const names = Array.isArray(value)
    ? value.filter((n): n is string => typeof n === "string")
    : typeof value === "string"
      ? value.split(",")
      : [];
  return JSON.stringify(names.map((n) => n.trim()).filter(Boolean).slice(0, 12));
}

// POST /api/decks/[id]/record {won, opponents?, note?, isManual?} — the
// owner's own tracker logging a finished game on this deck, so the server
// record covers games hosted on their phone as well as games joined by play
// code elsewhere.
//
// THE RUNNING COUNT IS FREE. THE LOG BEHIND IT IS PRO.
//
// That split used to live only in the iOS client, which wrapped its insert in
// `if isPro`. A gate in a client is a suggestion: the web, or anyone with
// curl, could keep a full history without paying for one. It is enforced here
// now — the counters increment for everybody, the GameLog row is written only
// for a pro account.
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

  // The deck's owner, and pro. A play-code result reported by a FRIEND'S
  // tracker still bumps the counters above — that is the deck's record — but
  // it is not that friend's history to write, and `user` there is whoever
  // resolved the code rather than the deck's owner.
  const logged = isPro(user) && user?.id != null && deck.userId === user.id;
  if (logged) {
    await prisma.gameLog.create({
      data: {
        deckId: deck.id,
        won,
        opponents: opponentsJson(body.opponents),
        note: typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null,
        isManual: body.isManual === true,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    gamesPlayed: updated.gamesPlayed,
    gamesWon: updated.gamesWon,
    // So a client can tell "we kept the detail" from "we counted it only",
    // rather than inferring the plan and getting it wrong.
    logged,
  });
}
