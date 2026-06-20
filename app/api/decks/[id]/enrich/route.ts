import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";
import { collectionByName } from "@/lib/scryfall";

export const runtime = "nodejs";

// Backfill colorIdentity / legalities for rows created before those columns
// existed. Idempotent: only touches rows where colorIdentity is still null.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  const deck = await accessibleDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const deckId = deck.id;

  const stale = await prisma.poolCard.findMany({
    where: { deckId, colorIdentity: null },
    select: { id: true, name: true },
  });
  if (stale.length === 0) return NextResponse.json({ enriched: 0 });

  const resolved = await collectionByName([...new Set(stale.map((c) => c.name))]);
  let enriched = 0;
  for (const row of stale) {
    const card = resolved.get(row.name.toLowerCase());
    if (!card || card.colorIdentity === null) continue;
    await prisma.poolCard.update({
      where: { id: row.id },
      data: {
        colorIdentity: card.colorIdentity,
        legalities: card.legalities ? JSON.stringify(card.legalities).slice(0, 4000) : null,
      },
    });
    enriched++;
  }
  return NextResponse.json({ enriched, missing: stale.length - enriched });
}
