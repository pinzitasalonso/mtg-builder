import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser, viewableDeckByPublicId } from "@/lib/auth";
import { tokensForDeck } from "@/lib/deck-tokens";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// GET /api/decks/<id>/tokens — the tokens, emblems and markers the decklist
// puts on the table, for anyone who can see the deck. The first ask for a
// deck goes to Scryfall (a few requests); after that it is kept for a day.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  const deck = await viewableDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  if (!rateLimit(`tokens:${clientIp(req)}`, 40, 10 * 60_000)) return NextResponse.json({ error: "Too many requests. Wait a few minutes." }, { status: 429 });
  const cards = await prisma.poolCard.findMany({ where: { deckId: deck.id, board: "deck" }, select: { name: true, typeLine: true, oracleText: true }, orderBy: { name: "asc" } });
  return NextResponse.json(await tokensForDeck(cards));
}
