import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { newPublicId } from "@/lib/deck-id";

// One-time: assign an unguessable publicId to any deck created before this
// column existed, so every deck has a stable URL. No-op once all are filled.
async function backfillPublicIds() {
  const stale = await prisma.deck.findMany({ where: { publicId: null }, select: { id: true } });
  for (const d of stale) {
    await prisma.deck.update({ where: { id: d.id }, data: { publicId: newPublicId() } });
  }
}

// Public decks (userId null) are listed for everyone; signed-in users see
// their own private decks by default. ?public=1 forces the public gallery
// (used for the "public brews" section while signed in).
export async function GET(req: Request) {
  const user = await currentUser();
  await backfillPublicIds();
  const wantPublic = new URL(req.url).searchParams.get("public") === "1";
  const decks = await prisma.deck.findMany({
    where: user && !wantPublic ? { userId: user.id } : { userId: null },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  // Aggregate each deck's color identity (WUBRG order) and its real deck size.
  // The card count must reflect only cards promoted to the decklist (board
  // "deck"), not pool candidates — and summed by quantity, matching the deck
  // page — so the home progress bar shows actual progress toward the format.
  const cards = await prisma.poolCard.findMany({
    where: { deckId: { in: decks.map((d) => d.id) } },
    select: { deckId: true, colorIdentity: true, board: true, quantity: true },
  });
  const colorsByDeck = new Map<number, Set<string>>();
  const deckCountByDeck = new Map<number, number>();
  for (const c of cards) {
    if (c.board === "deck") {
      deckCountByDeck.set(c.deckId, (deckCountByDeck.get(c.deckId) ?? 0) + c.quantity);
    }
    if (!c.colorIdentity) continue;
    const set = colorsByDeck.get(c.deckId) ?? new Set<string>();
    for (const ch of c.colorIdentity) if ("WUBRG".includes(ch)) set.add(ch);
    colorsByDeck.set(c.deckId, set);
  }
  return NextResponse.json(
    decks.map((d) => ({
      ...d,
      _count: { cards: deckCountByDeck.get(d.id) ?? 0 },
      colors: ["W", "U", "B", "R", "G"].filter((ch) => colorsByDeck.get(d.id)?.has(ch)),
    }))
  );
}

export async function POST(req: Request) {
  const user = await currentUser();
  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const format = typeof body.format === "string" && body.format.trim() ? body.format.trim() : "commander";
  const commander = typeof body.commander === "string" && body.commander.trim() ? body.commander.trim() : null;
  // Signed out → a public deck, owned by nobody and editable by anybody.
  const deck = await prisma.deck.create({
    data: { name, format, commander, userId: user?.id ?? null, publicId: newPublicId() },
  });
  return NextResponse.json(deck, { status: 201 });
}
