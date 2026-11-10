import { NextResponse } from "next/server";
import { jsonWithEtag } from "@/lib/http-cache";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { parseCollectionText } from "@/lib/collection-csv";
import { encodePrinting } from "@/lib/printing";
import { cachedUsdPrices, scryfallIdFromImage, usdPricesByIds, warmUsdPrices } from "@/lib/scryfall";
import { isUnrecognised } from "@/lib/collection-enrich";
import { ensureIndexing } from "@/lib/collection-indexer";

export const runtime = "nodejs";

const MAX_ENTRIES = 20000;
// Prices not yet known are fetched before answering only when that's a
// request or two; more are fetched in the background, and the answer says so.
const PRICE_NOW_MAX = 150;
// Cards the summary shows.
const SAMPLE = 7;
// Rows per transaction when an import adds to what's there.
const UPDATE_CHUNK = 500;

// The signed-in user's owned-card collection. Guests have none — GET returns an
// empty collection so deck pages can fetch it unconditionally. Cards an import
// added are matched to Scryfall by a background job (lib/collection-indexer.ts);
// a GET only makes sure that job is running, and `pending` / `indexing` let the
// client show progress. It returns at once, even mid-import.
//
// Three sizes of answer, so a page asks only for what it shows:
//   ?summary=1  the counts and a few cards with their images (the home page);
//               no rows are loaded beyond those few.
//   ?prices=0   every card, unpriced (a deck page: what you own, and how many).
//   (neither)   every card with its price (the collection screen, the iOS app).
//               Prices come from an in-memory cache that's empty after each
//               deploy; filling it for a big collection takes many Scryfall
//               requests, so beyond PRICE_NOW_MAX missing prices the answer
//               doesn't wait: it carries the prices already known, says
//               `pricing: true`, and the rest are fetched in the background
//               for the next request.
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ cards: [], unique: 0, total: 0, pending: 0 });
  const query = new URL(req.url).searchParams;

  if (query.get("summary")) {
    const where = { userId: user.id };
    const [unique, sum, pending] = await Promise.all([
      prisma.collectionCard.count({ where }),
      prisma.collectionCard.aggregate({ where, _sum: { quantity: true } }),
      prisma.collectionCard.count({ where: { ...where, enriched: false } }),
    ]);
    // A few cards to show, from a different place in the collection each time.
    const withArt = { ...where, imageUri: { not: null } };
    const pictured = unique ? await prisma.collectionCard.count({ where: withArt }) : 0;
    const sample = pictured
      ? await prisma.collectionCard.findMany({ where: withArt, select: { name: true, imageUri: true }, orderBy: { id: "asc" }, skip: Math.floor(Math.random() * Math.max(1, pictured - SAMPLE + 1)), take: SAMPLE })
      : [];
    const indexing = await ensureIndexing(user.id, pending);
    return NextResponse.json({ unique, total: sum._sum.quantity ?? 0, pending, sample, indexing });
  }

  const rows = await prisma.collectionCard.findMany({
    where: { userId: user.id },
    select: { name: true, quantity: true, colorIdentity: true, typeLine: true, manaCost: true, imageUri: true },
    orderBy: { name: "asc" },
  });

  // Price every resolved card server-side, the same way deck pages do: the
  // owned printing's id is in its image URL, so the client never has to fetch
  // prices itself (which is fragile on device).
  let priceMap = new Map<string, string>();
  let pricing = false;
  if (query.get("prices") !== "0") {
    const ids = rows.map((r) => scryfallIdFromImage(r.imageUri)).filter((id): id is string => id !== null);
    const known = cachedUsdPrices(ids);
    if (known.missing.length <= PRICE_NOW_MAX) priceMap = await usdPricesByIds(ids);
    else {
      priceMap = known.prices;
      pricing = true;
      warmUsdPrices(`collection:${user.id}`, known.missing);
    }
  }
  const cards = rows.map((r) => {
    const id = scryfallIdFromImage(r.imageUri);
    return { ...r, usdPrice: (id && priceMap.get(id)) || null };
  });

  const pending = await prisma.collectionCard.count({ where: { userId: user.id, enriched: false } });
  const indexing = await ensureIndexing(user.id, pending);
  const total = rows.reduce((s, r) => s + r.quantity, 0);
  // Names Scryfall had no card for, so the player can fix or retry them.
  const unrecognised = pending > 0 ? [] : rows.filter(isUnrecognised).map((r) => r.name);
  return jsonWithEtag(req, { cards, unique: rows.length, total, pending, unrecognised, indexing, ...(pricing ? { pricing } : {}) });
}

// Import a pasted list or a CSV export (Moxfield, ManaBox, Deckbox, TCGplayer…
// — the columns are found by header). `mode: "replace"` swaps the whole collection;
// "add" merges quantities into what's already there. Cards are stored by name
// only (no Scryfall resolution) so even huge collections import instantly.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to save a collection." }, { status: 401 });

  const body = await req.json().catch(() => null);

  // "Try again" on unrecognised names: queue them for another lookup. Also
  // recovers rows an old failed lookup left blank.
  if (body?.rematch === true) {
    const res = await prisma.collectionCard.updateMany({
      where: { userId: user.id, enriched: true, typeLine: null, imageUri: null },
      data: { enriched: false },
    });
    await ensureIndexing(user.id);
    return NextResponse.json({ requeued: res.count });
  }

  const text = typeof body?.text === "string" ? body.text : "";
  const mode = body?.mode === "replace" ? "replace" : "add";

  const parsed = parseCollectionText(text);
  const entries = parsed.slice(0, MAX_ENTRIES);
  const truncated = parsed.length - entries.length;
  if (entries.length === 0) {
    return NextResponse.json({ error: "Nothing to import — paste a list or choose a CSV first." }, { status: 400 });
  }

  if (mode === "replace") {
    await prisma.$transaction([
      prisma.collectionCard.deleteMany({ where: { userId: user.id } }),
      prisma.collectionCard.createMany({
        data: entries.map((e) => ({ userId: user.id, name: e.name, nameKey: e.name.toLowerCase(), quantity: e.qty, printing: encodePrinting(e.printing) })),
      }),
    ]);
  } else {
    const keys = entries.map((e) => e.name.toLowerCase());
    const existing = await prisma.collectionCard.findMany({
      where: { userId: user.id, nameKey: { in: keys } },
      select: { id: true, nameKey: true, quantity: true },
    });
    const byKey = new Map(existing.map((r) => [r.nameKey, r]));
    const creates: { userId: number; name: string; nameKey: string; quantity: number; printing: string | null }[] = [];
    const updates: { id: number; data: { quantity: { increment: number }; printing?: string; enriched?: boolean } }[] = [];
    for (const e of entries) {
      const key = e.name.toLowerCase();
      const ex = byKey.get(key);
      const printing = encodePrinting(e.printing);
      // A printing named in the file is what the player owns: it replaces the
      // one shown, and the row resolves again to pick it up.
      // Added to the row as it is when this is written, not to the quantity
      // read above: the matching job or another edit may have changed it.
      if (ex) updates.push({ id: ex.id, data: printing ? { quantity: { increment: e.qty }, printing, enriched: false } : { quantity: { increment: e.qty } } });
      else creates.push({ userId: user.id, name: e.name, nameKey: key, quantity: e.qty, printing });
    }
    // In transactions of a few hundred rows: one of 20,000 statements held
    // the database's only writer for the whole import.
    await prisma.collectionCard.createMany({ data: creates });
    for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
      // A row the matching job merged away meanwhile is skipped (updateMany).
      await prisma.$transaction(updates.slice(i, i + UPDATE_CHUNK).map((u) => prisma.collectionCard.updateMany({ where: { id: u.id, userId: user.id }, data: u.data })));
    }
  }

  // Start matching now, so it runs whether or not anyone polls.
  await ensureIndexing(user.id);

  const after = await prisma.collectionCard.aggregate({ where: { userId: user.id }, _count: true, _sum: { quantity: true } });
  return NextResponse.json({
    unique: after._count,
    total: after._sum.quantity ?? 0,
    imported: entries.length,
    // Different cards past the cap, which weren't saved — said out loud rather
    // than dropped silently.
    truncated,
    mode,
  });
}

// Set the exact quantity of a single card (by name). quantity <= 0 removes it.
// An optional imageUri pins the printing the player owns — the owned version is
// read back off this image, so persisting it is how a version change sticks.
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
  // Only a Scryfall card image: it's shown as-is, and the printing (and its
  // price) is read back off it.
  const imageUri =
    typeof body?.imageUri === "string" && /^https:\/\/([a-z0-9-]+\.)*scryfall\.(io|com)\//i.test(body.imageUri) ? body.imageUri : null;

  if (quantity <= 0) {
    await prisma.collectionCard.deleteMany({ where: { userId: user.id, nameKey } });
  } else {
    const qty = Math.min(quantity, 9999);
    // Pinning an image counts as enriched, so the nightly name-enrich won't
    // overwrite the player's chosen printing.
    const pinned = imageUri ? { imageUri, enriched: true, printing: null } : {};
    await prisma.collectionCard.upsert({
      where: { userId_nameKey: { userId: user.id, nameKey } },
      create: { userId: user.id, name, nameKey, quantity: qty, ...pinned },
      update: { quantity: qty, ...pinned },
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
