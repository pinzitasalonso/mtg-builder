import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { parseCollectionText } from "@/lib/collection-csv";
import { encodePrinting } from "@/lib/printing";
import { lookupCollection, lookupPrintings, NAMED_GAP_MS, normalizeCardKey, resolveNamedDetailed, scryfallIdFromImage, usdPricesByIds, type OutCard } from "@/lib/scryfall";
import { canonicalName, isUnrecognised, planEnrichment, type CardMeta } from "@/lib/collection-enrich";

export const runtime = "nodejs";

const MAX_ENTRIES = 20000;
// How many not-yet-resolved cards to enrich per GET. Bounded so a fresh import
// converges over a few quick polls rather than blocking one slow request.
const ENRICH_PER_CALL = 525; // 7 Scryfall requests of 75 names
// Names the exact lookup missed get a fuzzy try each ("Lim-Dul's Vault",
// "Jotun Grunt", a typo). One request apiece, so a handful per GET; the rest
// wait for the next poll.
const FUZZY_PER_CALL = 12;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Resolve a batch of un-matched rows and apply the result. Failed lookups are
// left for the next call — see lib/collection-enrich.ts for why that matters.
async function enrichBatch(userId: number) {
  const stale = await prisma.collectionCard.findMany({
    where: { userId, enriched: false },
    select: { id: true, name: true, nameKey: true, quantity: true, printing: true },
    take: ENRICH_PER_CALL,
  });
  if (stale.length === 0) return;

  // Rows an import pinned to a printing resolve by that printing first, so the
  // card shows (and is priced as) the version the player owns. A printing
  // Scryfall doesn't have falls back to the name; a failed request waits.
  const refs = stale.filter((r) => r.printing).map((r) => r.printing!);
  const byRef = refs.length ? await lookupPrintings(refs) : { found: new Map<string, OutCard>(), notFound: [], failed: [] };
  const refFailed = new Set(byRef.failed);
  const byNameRows = stale.filter((r) => !r.printing || (!byRef.found.has(r.printing) && !refFailed.has(r.printing)));

  const { found, notFound } = byNameRows.length ? await lookupCollection(byNameRows.map((r) => r.name)) : { found: new Map<string, OutCard>(), notFound: [] };
  const byName = new Map<string, OutCard>(found);
  const unknownNames = new Set<string>();
  const fuzzy = [...new Set(notFound.map(normalizeCardKey))].slice(0, FUZZY_PER_CALL);
  for (const [i, key] of fuzzy.entries()) {
    if (i > 0) await sleep(NAMED_GAP_MS);
    const r = await resolveNamedDetailed(key);
    if (r.status === "ok") byName.set(key, r.card);
    else if (r.status === "notfound") unknownNames.add(key);
    // "failed": neither — tried again next time.
  }

  const matched = new Map<number, CardMeta>();
  const unknown = new Set<number>();
  for (const r of stale) {
    const pinned = r.printing ? byRef.found.get(r.printing) : undefined;
    if (pinned) { matched.set(r.id, { ...pinned, name: canonicalName(pinned.name) }); continue; }
    if (r.printing && refFailed.has(r.printing)) continue;
    const k = normalizeCardKey(r.name);
    const card = byName.get(k);
    if (card) matched.set(r.id, { ...card, name: canonicalName(card.name) });
    else if (unknownNames.has(k)) unknown.add(r.id);
  }
  const renames = [...matched.entries()]
    .map(([id, c]) => ({ id, key: c.name.toLowerCase() }))
    .filter(({ id, key }) => stale.find((r) => r.id === id)!.nameKey !== key);
  const existing = renames.length
    ? await prisma.collectionCard.findMany({
        where: { userId, nameKey: { in: [...new Set(renames.map((r) => r.key))] }, id: { notIn: stale.map((r) => r.id) } },
        select: { id: true, nameKey: true, quantity: true },
      })
    : [];

  const ops = planEnrichment(stale, matched, unknown, existing);
  if (ops.length === 0) return;
  await prisma.$transaction(
    ops.map((op) =>
      op.kind === "delete"
        ? prisma.collectionCard.delete({ where: { id: op.id } })
        : op.kind === "quantity"
          ? prisma.collectionCard.update({ where: { id: op.id }, data: { quantity: op.quantity } })
          : prisma.collectionCard.update({ where: { id: op.id }, data: { ...op.data, printing: null } })
    )
  );
}

// The signed-in user's owned-card collection. Guests have none — GET returns an
// empty collection so deck pages can fetch it unconditionally. Each call resolves
// a batch of un-enriched cards against Scryfall and persists their metadata, so
// the browser's color/type/mana-value filters work on real stored data; the
// returned `pending` count lets the client poll until enrichment is complete.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ cards: [], unique: 0, total: 0, pending: 0 });

  // Enrichment is best-effort: a Scryfall failure must never keep the player
  // from seeing the collection they already have.
  await enrichBatch(user.id).catch((e) => console.error("[collection] enrich failed", e instanceof Error ? e.message : e));

  const rows = await prisma.collectionCard.findMany({
    where: { userId: user.id },
    select: { name: true, quantity: true, colorIdentity: true, typeLine: true, manaCost: true, imageUri: true },
    orderBy: { name: "asc" },
  });

  // Price every resolved card server-side, the same way deck pages do — the
  // owned printing's id is in its image URL. Batched + memoized in fetchUsdPrice's
  // cache, so a warm cache serves this for free and the client never has to
  // fetch prices itself (which is fragile on device).
  const priceMap = await usdPricesByIds(
    rows.map((r) => scryfallIdFromImage(r.imageUri)).filter((id): id is string => id !== null)
  );
  const cards = rows.map((r) => {
    const id = scryfallIdFromImage(r.imageUri);
    return { ...r, usdPrice: (id && priceMap.get(id)) || null };
  });

  const pending = await prisma.collectionCard.count({ where: { userId: user.id, enriched: false } });
  const total = rows.reduce((s, r) => s + r.quantity, 0);
  // Names Scryfall had no card for, so the player can fix or retry them.
  const unrecognised = pending > 0 ? [] : rows.filter(isUnrecognised).map((r) => r.name);
  return NextResponse.json({ cards, unique: rows.length, total, pending, unrecognised });
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
    const updates: { id: number; data: { quantity: number; printing?: string; enriched?: boolean } }[] = [];
    for (const e of entries) {
      const key = e.name.toLowerCase();
      const ex = byKey.get(key);
      const printing = encodePrinting(e.printing);
      // A printing named in the file is what the player owns: it replaces the
      // one shown, and the row resolves again to pick it up.
      if (ex) updates.push({ id: ex.id, data: printing ? { quantity: ex.quantity + e.qty, printing, enriched: false } : { quantity: ex.quantity + e.qty } });
      else creates.push({ userId: user.id, name: e.name, nameKey: key, quantity: e.qty, printing });
    }
    await prisma.$transaction([
      prisma.collectionCard.createMany({ data: creates }),
      ...updates.map((u) => prisma.collectionCard.update({ where: { id: u.id }, data: u.data })),
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
