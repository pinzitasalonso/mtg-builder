import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";

const MAX_QTY = 999;
const MAX_CARDS = 500;

// Add many cards in one request (used by AI "Add all" / bulk lands), so a batch
// is one round-trip instead of one POST per card. Each card upserts: a name
// already in the pool has its quantity incremented.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  const deck = await accessibleDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const deckId = deck.id;

  const body = await req.json().catch(() => null);
  const board = body?.board === "deck" ? "deck" : "pool";
  const list = Array.isArray(body?.cards) ? body.cards.slice(0, MAX_CARDS) : [];
  const str = (v: unknown) => (typeof v === "string" ? v : null);

  const ops = [];
  for (const c of list) {
    if (
      typeof c?.scryfallId !== "string" || !c.scryfallId ||
      typeof c?.name !== "string" || !c.name ||
      typeof c?.imageUri !== "string" || !c.imageUri
    ) {
      continue;
    }
    const qty = Math.min(MAX_QTY, Number.isFinite(c.quantity) && c.quantity > 0 ? Math.floor(c.quantity) : 1);
    const colorIdentity = typeof c.colorIdentity === "string" ? c.colorIdentity.toUpperCase().slice(0, 5) : null;
    const legalities =
      c.legalities && typeof c.legalities === "object" && !Array.isArray(c.legalities)
        ? JSON.stringify(c.legalities).slice(0, 4000)
        : null;
    ops.push(
      prisma.poolCard.upsert({
        where: { deckId_scryfallId: { deckId, scryfallId: c.scryfallId } },
        update: { quantity: { increment: qty } },
        create: {
          deckId,
          scryfallId: c.scryfallId,
          name: c.name,
          imageUri: c.imageUri,
          manaCost: str(c.manaCost),
          typeLine: str(c.typeLine),
          oracleText: str(c.oracleText),
          colorIdentity,
          legalities,
          board,
          quantity: qty,
        },
      })
    );
  }
  if (ops.length) await prisma.$transaction(ops);
  return NextResponse.json({ added: ops.length });
}
