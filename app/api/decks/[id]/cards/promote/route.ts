import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";

// Move every card in the pool onto the deck board in one request — the
// "add all to deck" button. Quantities travel with the rows; nothing is
// created or capped, so there is no singleton rule to apply here.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  const deck = await accessibleDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const { count } = await prisma.poolCard.updateMany({
    where: { deckId: deck.id, board: "pool" },
    data: { board: "deck" },
  });
  return NextResponse.json({ moved: count });
}
