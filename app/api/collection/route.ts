import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { parseDecklist } from "@/lib/decklist";
import { collectionByName } from "@/lib/scryfall";

export const runtime = "nodejs";

const MAX_ENTRIES = 20000;
// How many not-yet-resolved cards to enrich per GET. Bounded so a fresh import
// converges over a few quick polls rather than blocking one slow request.
const ENRICH_PER_CALL = 525; // 7 Scryfall requests of 75 names

// The signed-in user's owned-card collection. Guests have none — GET returns an
// empty collection so deck pages can fetch it unconditionally. Each call resolves
// a batch of un-enriched cards against Scryfall and persists their metadata, so
// the browser's color/type/mana-value filters work on real stored data; the
// returned `pending` count lets the client poll until enrichment is complete.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ cards: [], unique: 0, total: 0, pending: 0 });

  const stale = await prisma.collectionCard.findMany({
    where: { userId: user.id, enriched: false },
    select: { id: true, name: true },
    take: ENRICH_PER_CALL,
  });
  if (stale.length > 0) {
    const map = await collectionByName(stale.map((r) => r.name));
    await prisma.$transaction(
      stale.map((r) => {
        const m = map.get(r.name.toLowerCase());
        return prisma.collectionCard.update({
          where: { id: r.id },
          data: {
            enriched: true,
            colorIdentity: m?.colorIdentity ?? null,
            typeLine: m?.typeLine ?? null,
            manaCost: m?.manaCost ?? null,
            imageUri: m?.imageUri ?? null,
          },
        });
      })
    );
  }

  const rows = await prisma.collectionCard.findMany({
    where: { userId: user.id },
    select: { name: true, quantity: true, colorIdentity: true, typeLine: true, manaCost: true, imageUri: true },
    orderBy: { name: "asc" },
  });
  const pending = await prisma.collectionCard.count({ where: { userId: user.id, enriched: false } });
  const total = rows.reduce((s, r) => s + r.quantity, 0);
  return NextResponse.json({ cards: rows, unique: rows.length, total, pending });
}

// Import a pasted collection. `mode: "replace"` swaps the whole collection;
// "add" merges quantities into what's already there. Cards are stored by name
// only (no Scryfall resolution) so even huge collections import instantly.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to save a collection." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  const mode = body?.mode === "replace" ? "replace" : "add";

  const entries = parseDecklist(text).slice(0, MAX_ENTRIES);
  if (entries.length === 0) {
    return NextResponse.json({ error: "Nothing to import — paste a list first." }, { status: 400 });
  }

  if (mode === "replace") {
    await prisma.$transaction([
      prisma.collectionCard.deleteMany({ where: { userId: user.id } }),
      prisma.collectionCard.createMany({
        data: entries.map((e) => ({ userId: user.id, name: e.name, nameKey: e.name.toLowerCase(), quantity: e.qty })),
      }),
    ]);
  } else {
    const keys = entries.map((e) => e.name.toLowerCase());
    const existing = await prisma.collectionCard.findMany({
      where: { userId: user.id, nameKey: { in: keys } },
      select: { id: true, nameKey: true, quantity: true },
    });
    const byKey = new Map(existing.map((r) => [r.nameKey, r]));
    const creates: { userId: number; name: string; nameKey: string; quantity: number }[] = [];
    const updates: { id: number; quantity: number }[] = [];
    for (const e of entries) {
      const key = e.name.toLowerCase();
      const ex = byKey.get(key);
      if (ex) updates.push({ id: ex.id, quantity: ex.quantity + e.qty });
      else creates.push({ userId: user.id, name: e.name, nameKey: key, quantity: e.qty });
    }
    await prisma.$transaction([
      prisma.collectionCard.createMany({ data: creates }),
      ...updates.map((u) => prisma.collectionCard.update({ where: { id: u.id }, data: { quantity: u.quantity } })),
    ]);
  }

  const rows = await prisma.collectionCard.findMany({
    where: { userId: user.id },
    select: { quantity: true },
  });
  return NextResponse.json({
    unique: rows.length,
    total: rows.reduce((s, r) => s + r.quantity, 0),
    imported: entries.length,
    mode,
  });
}

// Set the exact quantity of a single card (by name). quantity <= 0 removes it.
// Used by the collection browser to edit/remove individual cards.
export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const quantity = Math.floor(Number(body?.quantity));
  if (!name || !Number.isFinite(quantity)) {
    return NextResponse.json({ error: "name and quantity required" }, { status: 400 });
  }
  const nameKey = name.toLowerCase();

  if (quantity <= 0) {
    await prisma.collectionCard.deleteMany({ where: { userId: user.id, nameKey } });
  } else {
    const qty = Math.min(quantity, 9999);
    await prisma.collectionCard.upsert({
      where: { userId_nameKey: { userId: user.id, nameKey } },
      create: { userId: user.id, name, nameKey, quantity: qty },
      update: { quantity: qty },
    });
  }
  return NextResponse.json({ ok: true });
}

// Clear the whole collection.
export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  await prisma.collectionCard.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ ok: true });
}
