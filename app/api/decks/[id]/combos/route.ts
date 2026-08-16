import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";
import { findCombos } from "@/lib/combos";

export const runtime = "nodejs";

// Combos this deck can assemble, via Commander Spellbook.
//
// The DECK board only, matching iOS: a combo you could build if you promoted
// three cards out of the pool is not a combo the deck has.
//
// Best-effort. Spellbook being slow or down returns an empty list, not an
// error — the deck page simply shows no combos, which is also what a deck
// without any looks like.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  const deck = await accessibleDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });

  const rows = await prisma.poolCard.findMany({
    where: { deckId: deck.id, board: "deck" },
    select: { name: true, quantity: true },
  });

  // Commanders are sent separately because Spellbook treats them as always
  // available rather than as cards that have to be drawn. The deck stores one
  // or two joined by " + ", the same form the iOS app writes.
  const commanderKeys = new Set(
    (deck.commander ?? "")
      .split("+")
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean)
  );

  const result = await findCombos(
    rows.map((r) => ({
      name: r.name,
      quantity: Math.max(1, r.quantity),
      isCommander: commanderKeys.has(r.name.trim().toLowerCase()),
    }))
  );

  return NextResponse.json(result);
}
