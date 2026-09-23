import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";
import { singletonCapped } from "@/lib/commander";

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

  // Which of these are already in the pool — a capped (singleton) card that
  // is already there adds no copies, and the response says so.
  const ids: string[] = [];
  for (const c of list) if (typeof c?.scryfallId === "string" && c.scryfallId) ids.push(c.scryfallId);
  const present = new Set(
    (await prisma.poolCard.findMany({ where: { deckId, scryfallId: { in: [...new Set(ids)] } }, select: { scryfallId: true } })).map((r) => r.scryfallId)
  );
  let copies = 0;
  const ops = [];
  for (const c of list) {
    if (
      typeof c?.scryfallId !== "string" || !c.scryfallId ||
      typeof c?.name !== "string" || !c.name ||
      typeof c?.imageUri !== "string" || !c.imageUri
    ) {
      continue;
    }
    const reqQty = Math.min(MAX_QTY, Number.isFinite(c.quantity) && c.quantity > 0 ? Math.floor(c.quantity) : 1);
    const capped = singletonCapped(deck.format, c.typeLine);
    const qty = capped ? 1 : reqQty;
    copies += capped ? (present.has(c.scryfallId) ? 0 : 1) : qty;
    present.add(c.scryfallId);
    const colorIdentity = typeof c.colorIdentity === "string" ? c.colorIdentity.toUpperCase().slice(0, 5) : null;
    const legalities =
      c.legalities && typeof c.legalities === "object" && !Array.isArray(c.legalities)
        ? JSON.stringify(c.legalities).slice(0, 4000)
        : null;
    ops.push(
      prisma.poolCard.upsert({
        where: { deckId_scryfallId: { deckId, scryfallId: c.scryfallId } },
        update: capped ? { quantity: 1 } : { quantity: { increment: qty } },
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
  // `added` is rows touched (kept for older clients); `copies` is what the
  // pool actually gained.
  return NextResponse.json({ added: ops.length, copies });
}
