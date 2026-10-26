import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";

/* The signed-in player's decks that hold a card, for the card views: each
   deck with its copies on the deck board and in the pool. Matched by name, so
   every printing counts, and a double-faced card asked for by its front face
   ("Delver of Secrets") finds its full name too. Signed out: no decks. */

export interface CardInDeck {
  publicId: string;
  name: string;
  /** Copies in the decklist. */
  deck: number;
  /** Copies only being considered, in the pool. */
  pool: number;
}

export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name")?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ decks: [] });

  const rows = await prisma.poolCard.findMany({
    where: {
      deck: { userId: user.id, publicId: { not: null } },
      OR: [{ name }, { name: { startsWith: `${name} // ` } }],
    },
    select: { board: true, quantity: true, deck: { select: { publicId: true, name: true } } },
  });
  const byDeck = new Map<string, CardInDeck>();
  for (const r of rows) {
    const id = r.deck.publicId!;
    const d = byDeck.get(id) ?? { publicId: id, name: r.deck.name, deck: 0, pool: 0 };
    if (r.board === "deck") d.deck += r.quantity;
    else d.pool += r.quantity;
    byDeck.set(id, d);
  }
  // Decks that play it first, then the ones only considering it; A–Z within.
  const decks = [...byDeck.values()].sort((a, b) => Number(b.deck > 0) - Number(a.deck > 0) || a.name.localeCompare(b.name));
  return NextResponse.json({ decks });
}
