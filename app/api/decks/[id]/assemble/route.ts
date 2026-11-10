import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";

export const runtime = "nodejs";

/* "Assemble deck": ticking off the physical cards as they go into the deck.
   GET says which of the deck's cards are ticked and, for the deck's owner,
   which of their other decks hold each card (and whether it's ticked there:
   that's where the cardboard probably is). POST ticks or unticks cards, or
   resets the deck. */

export interface CardElsewhere {
  publicId: string;
  name: string;
  /** Copies in that deck's list (0: only in its pool). */
  deck: number;
  /** Ticked as assembled there. */
  assembled: boolean;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  const { id } = await params;
  const deck = await accessibleDeckByPublicId(id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const cards = await prisma.poolCard.findMany({ where: { deckId: deck.id, board: "deck" }, select: { id: true, name: true, assembled: true } });
  const elsewhere: Record<string, CardElsewhere[]> = {};
  if (user && deck.userId === user.id && cards.length) {
    const rows = await prisma.poolCard.findMany({
      where: { name: { in: cards.map((c) => c.name) }, deck: { userId: user.id, id: { not: deck.id }, publicId: { not: null } } },
      select: { name: true, board: true, quantity: true, assembled: true, deck: { select: { publicId: true, name: true } } },
    });
    for (const r of rows) {
      const key = r.name.toLowerCase();
      const list = (elsewhere[key] ??= []);
      const had = list.find((d) => d.publicId === r.deck.publicId);
      const inDeck = r.board === "deck";
      if (had) {
        if (inDeck) had.deck += r.quantity;
        had.assembled ||= inDeck && r.assembled;
      } else list.push({ publicId: r.deck.publicId!, name: r.deck.name, deck: inDeck ? r.quantity : 0, assembled: inDeck && r.assembled });
    }
    // Where it's ticked first, then where it's played, then pools; A–Z within.
    for (const list of Object.values(elsewhere)) list.sort((a, b) => Number(b.assembled) - Number(a.assembled) || Number(b.deck > 0) - Number(a.deck > 0) || a.name.localeCompare(b.name));
  }
  return NextResponse.json({ assembled: cards.filter((c) => c.assembled).map((c) => c.id), elsewhere });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  const { id } = await params;
  const deck = await accessibleDeckByPublicId(id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (body?.reset === true) {
    await prisma.poolCard.updateMany({ where: { deckId: deck.id }, data: { assembled: false } });
    return NextResponse.json({ ok: true });
  }
  const ids = Array.isArray(body?.cardIds) ? body.cardIds.filter((n: unknown): n is number => Number.isInteger(n)).slice(0, 1000) : [];
  if (!ids.length || typeof body?.assembled !== "boolean") return NextResponse.json({ error: "cardIds and assembled required" }, { status: 400 });
  const res = await prisma.poolCard.updateMany({ where: { deckId: deck.id, id: { in: ids } }, data: { assembled: body.assembled } });
  return NextResponse.json({ ok: true, updated: res.count });
}
