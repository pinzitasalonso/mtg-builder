import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";
import { ensureCommanderCard } from "@/lib/commander";

const MAX_QTY = 999;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  const deck = await accessibleDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  // Commander decks always carry their commander on the deck board.
  await ensureCommanderCard(deck);
  const cards = await prisma.poolCard.findMany({
    where: { deckId: deck.id },
    orderBy: { addedAt: "asc" },
  });
  return NextResponse.json(cards);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  const deck = await accessibleDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const deckId = deck.id;
  const body = await req.json();
  const { scryfallId, name, imageUri, manaCost, typeLine, oracleText } = body;
  if (
    typeof scryfallId !== "string" || !scryfallId ||
    typeof name !== "string" || !name ||
    typeof imageUri !== "string" || !imageUri
  ) {
    return NextResponse.json({ error: "scryfallId, name, imageUri required" }, { status: 400 });
  }

  // quantity is how many copies to add; defaults to 1, clamped so a bad client
  // can't create absurd stacks. Adding a card already in the pool increments
  // its count rather than erroring (basics & decklist merges).
  const qty = Math.min(
    MAX_QTY,
    Number.isFinite(body.quantity) && body.quantity > 0 ? Math.floor(body.quantity) : 1
  );
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  // legalities arrives as an object; stored JSON-encoded. colorIdentity is
  // WUBRG letters ("" = colorless is meaningful, so keep empty strings).
  const colorIdentity =
    typeof body.colorIdentity === "string" ? body.colorIdentity.toUpperCase().slice(0, 5) : null;
  const legalities =
    body.legalities && typeof body.legalities === "object" && !Array.isArray(body.legalities)
      ? JSON.stringify(body.legalities).slice(0, 4000)
      : null;
  const card = await prisma.poolCard.upsert({
    where: { deckId_scryfallId: { deckId, scryfallId } },
    update: { quantity: { increment: qty } },
    create: {
      deckId,
      scryfallId,
      name,
      imageUri,
      manaCost: str(manaCost),
      typeLine: str(typeLine),
      oracleText: str(oracleText),
      colorIdentity,
      legalities,
      quantity: qty,
    },
  });
  return NextResponse.json(card, { status: 201 });
}
