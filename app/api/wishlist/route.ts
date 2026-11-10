import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { cachedUsdPrices, lookupCollection, normalizeCardKey, scryfallIdFromImage, usdPricesByIds, warmUsdPrices } from "@/lib/scryfall";
import { MAX_WANTED, MAX_WISHLIST, parseWishlistAdd, wishlistSummary, type WishlistCard } from "@/lib/wishlist";

export const runtime = "nodejs";

// The signed-in player's wishlist: cards they want and don't have yet. It
// lives next to the collection: each card comes back with the copies they
// own now, so the list shows what they've since got, and "got it" moves a
// card into the collection. Signed out: an empty list.

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ cards: [], unique: 0, total: 0, missing: 0, cost: 0, unpriced: 0, owned: 0 });
  // The home page only needs the count.
  if (new URL(req.url).searchParams.get("count")) {
    return NextResponse.json({ unique: await prisma.wishlistCard.count({ where: { userId: user.id } }) });
  }
  const rows = await prisma.wishlistCard.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } });
  const owned = await prisma.collectionCard.findMany({
    where: { userId: user.id, nameKey: { in: rows.map((r) => r.nameKey) } },
    select: { nameKey: true, quantity: true },
  });
  const ownedBy = new Map(owned.map((o) => [o.nameKey, o.quantity]));
  // Priced by the printing shown, as the collection is: at once when it's a
  // request or two, otherwise from what's cached while the rest is fetched
  // in the background (the list can hold 2,000 cards).
  const ids = rows.map((r) => scryfallIdFromImage(r.imageUri)).filter((id): id is string => id !== null);
  const known = cachedUsdPrices(ids);
  const prices = known.missing.length <= 150 ? await usdPricesByIds(ids) : known.prices;
  if (known.missing.length > 150) warmUsdPrices(`wishlist:${user.id}`, known.missing);
  const cards: WishlistCard[] = rows.map((r) => {
    const id = scryfallIdFromImage(r.imageUri);
    return {
      name: r.name,
      quantity: r.quantity,
      imageUri: r.imageUri,
      typeLine: r.typeLine,
      manaCost: r.manaCost,
      colorIdentity: r.colorIdentity,
      owned: ownedBy.get(r.nameKey) ?? 0,
      usdPrice: (id && prices.get(id)) || null,
      addedAt: r.addedAt.toISOString(),
    };
  });
  return NextResponse.json({ cards, ...wishlistSummary(cards) });
}

// Add cards: `{ cards: [{ name, quantity?, imageUri?, … }] }` or one
// `{ name }`. A card already on the list is raised to the quantity asked for,
// never lowered (adding a deck's missing cards twice doesn't double them). A
// card sent by name only is looked up on Scryfall, so it has its image and
// its proper name; a name Scryfall doesn't know isn't added.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to keep a wishlist." }, { status: 401 });
  const body = await req.json().catch(() => null);

  // "Got it": the card moves into the collection (the copies still wanted,
  // at least one), and leaves the list.
  if (typeof body?.got === "string") {
    const nameKey = body.got.trim().toLowerCase();
    const row = await prisma.wishlistCard.findUnique({ where: { userId_nameKey: { userId: user.id, nameKey } } });
    if (!row) return NextResponse.json({ error: "That card isn't on your wishlist." }, { status: 404 });
    const have = await prisma.collectionCard.findUnique({ where: { userId_nameKey: { userId: user.id, nameKey } }, select: { quantity: true } });
    const add = Math.max(1, row.quantity - (have?.quantity ?? 0));
    await prisma.$transaction([
      prisma.collectionCard.upsert({
        where: { userId_nameKey: { userId: user.id, nameKey } },
        // The printing wished for is the one now owned.
        create: { userId: user.id, name: row.name, nameKey, quantity: add, imageUri: row.imageUri, typeLine: row.typeLine, manaCost: row.manaCost, colorIdentity: row.colorIdentity, enriched: !!row.imageUri },
        update: { quantity: { increment: add } },
      }),
      prisma.wishlistCard.delete({ where: { id: row.id } }),
    ]);
    return NextResponse.json({ ok: true, added: add });
  }

  const entries = parseWishlistAdd(body);
  if (!entries.length) return NextResponse.json({ error: "Name a card to add." }, { status: 400 });

  // Names without details: one Scryfall lookup for them all.
  const bare = entries.filter((e) => !e.imageUri || !e.typeLine);
  const unknown: string[] = [];
  if (bare.length) {
    const lookup = await lookupCollection(bare.map((e) => e.name));
    for (const e of bare) {
      const card = lookup.found.get(normalizeCardKey(e.name));
      if (!card) {
        unknown.push(e.name);
        continue;
      }
      e.name = card.name;
      e.imageUri = e.imageUri ?? card.imageUri;
      e.typeLine = card.typeLine;
      e.manaCost = card.manaCost;
      e.colorIdentity = card.colorIdentity;
    }
  }
  const known = entries.filter((e) => !unknown.includes(e.name));
  if (!known.length) return NextResponse.json({ error: `Scryfall doesn't know ${unknown.length === 1 ? `"${unknown[0]}"` : "those cards"}. Check the spelling.`, unknown }, { status: 404 });

  const keys = known.map((e) => e.name.toLowerCase());
  const existing = await prisma.wishlistCard.findMany({ where: { userId: user.id, nameKey: { in: keys } }, select: { id: true, nameKey: true, quantity: true } });
  const byKey = new Map(existing.map((r) => [r.nameKey, r]));
  const count = await prisma.wishlistCard.count({ where: { userId: user.id } });
  const fresh = known.filter((e) => !byKey.has(e.name.toLowerCase()));
  if (count + fresh.length > MAX_WISHLIST) {
    return NextResponse.json({ error: `A wishlist holds ${MAX_WISHLIST.toLocaleString("en-US")} different cards. Remove some to add more.` }, { status: 409 });
  }
  const raises = known.flatMap((e) => {
    const had = byKey.get(e.name.toLowerCase());
    return had && e.quantity > had.quantity ? [{ id: had.id, quantity: Math.min(MAX_WANTED, e.quantity) }] : [];
  });
  await prisma.$transaction([
    prisma.wishlistCard.createMany({
      data: fresh.map((e) => ({ userId: user.id, name: e.name, nameKey: e.name.toLowerCase(), quantity: e.quantity, imageUri: e.imageUri, typeLine: e.typeLine, manaCost: e.manaCost, colorIdentity: e.colorIdentity })),
    }),
    ...raises.map((r) => prisma.wishlistCard.update({ where: { id: r.id }, data: { quantity: r.quantity } })),
  ]);
  return NextResponse.json({ ok: true, added: fresh.length, raised: raises.length, already: known.length - fresh.length - raises.length, unknown });
}

// Set how many copies of a card are wanted; 0 or less takes it off the list.
export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const quantity = Math.floor(Number(body?.quantity));
  if (!name || !Number.isFinite(quantity)) return NextResponse.json({ error: "name and quantity required" }, { status: 400 });
  const nameKey = name.toLowerCase();
  if (quantity <= 0) await prisma.wishlistCard.deleteMany({ where: { userId: user.id, nameKey } });
  else await prisma.wishlistCard.updateMany({ where: { userId: user.id, nameKey }, data: { quantity: Math.min(quantity, MAX_WANTED) } });
  return NextResponse.json({ ok: true });
}

// Clear the list, or with ?owned=1 only the cards you now own enough of.
export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!new URL(req.url).searchParams.get("owned")) {
    await prisma.wishlistCard.deleteMany({ where: { userId: user.id } });
    return NextResponse.json({ ok: true });
  }
  const rows = await prisma.wishlistCard.findMany({ where: { userId: user.id }, select: { id: true, nameKey: true, quantity: true } });
  const owned = await prisma.collectionCard.findMany({ where: { userId: user.id, nameKey: { in: rows.map((r) => r.nameKey) } }, select: { nameKey: true, quantity: true } });
  const ownedBy = new Map(owned.map((o) => [o.nameKey, o.quantity]));
  const done = rows.filter((r) => (ownedBy.get(r.nameKey) ?? 0) >= r.quantity).map((r) => r.id);
  await prisma.wishlistCard.deleteMany({ where: { id: { in: done } } });
  return NextResponse.json({ ok: true, removed: done.length });
}
