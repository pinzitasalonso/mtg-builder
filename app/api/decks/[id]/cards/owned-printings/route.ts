import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";
import { ownedPrintingsFor } from "@/lib/owned-printings";

export const runtime = "nodejs";

// Switch a deck's cards to the printings the player owns. Cards added from now
// on take the owned printing as they come in; this catches up a deck built
// before (or before the collection was imported). A card whose owned printing
// is already a separate row in the deck is left alone rather than merged.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to use your collection." }, { status: 401 });
  const deck = await accessibleDeckByPublicId((await params).id, user.id);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });

  const rows = await prisma.poolCard.findMany({ where: { deckId: deck.id }, select: { id: true, name: true, scryfallId: true } });
  const owned = await ownedPrintingsFor(user.id, rows.map((r) => r.name));
  const taken = new Set(rows.map((r) => r.scryfallId));
  let changed = 0;
  for (const r of rows) {
    const o = owned.get(r.name.trim().replace(/\s+/g, " ").toLowerCase());
    if (!o || o.scryfallId === r.scryfallId || taken.has(o.scryfallId)) continue;
    await prisma.poolCard.update({ where: { id: r.id }, data: { scryfallId: o.scryfallId, imageUri: o.imageUri } });
    taken.delete(r.scryfallId);
    taken.add(o.scryfallId);
    changed++;
  }
  return NextResponse.json({ changed });
}
