import prisma from "@/lib/prisma";
import { lookupCollection, lookupPrintings, NAMED_GAP_MS, normalizeCardKey, resolveNamedDetailed, scryfallIdFromImage, usdPricesByIds, type OutCard } from "@/lib/scryfall";
import { canonicalName, planEnrichment, type CardMeta } from "@/lib/collection-enrich";

// Server-side collection indexing: matching imported rows to Scryfall.
//
// It used to run inside GET /api/collection, one batch per request. So it only
// advanced while a browser kept polling: a reload, a closed tab or a locked
// phone stopped it, and after ~30s without progress the client gave up for
// good. Now an import (or any GET that finds cards pending) starts a job in
// the server process that runs until nothing is left. The client only polls
// to show progress. The job:
//   - runs once per user at a time (a second start joins the first);
//   - backs off when a pass makes no progress (Scryfall down or throttling),
//     and pauses after several such passes; a GET after a short cool-down
//     starts it again, so a pause is never permanent;
//   - dies with the process on a deploy, and the next GET restarts it.
//     Progress lives in the database, so nothing is lost.

// Cards resolved per pass: 7 Scryfall requests of 75 names.
const ENRICH_PER_CALL = 525;
// Names the exact lookup missed get a fuzzy try each ("Lim-Dul's Vault",
// "Jotun Grunt", a typo). One request apiece, so a handful per pass; the rest
// wait for the next.
const FUZZY_PER_CALL = 12;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Resolve a batch of un-matched rows and apply the result. Failed lookups are
// left for the next call — see lib/collection-enrich.ts for why that matters.
export async function enrichBatch(userId: number) {
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

export interface IndexerStatus {
  running: boolean;
  // Scryfall stopped answering; the job paused and will retry after a cool-down.
  paused: boolean;
}

const MAX_IDLE_PASSES = 5;
const RESTART_COOLDOWN_MS = 60_000;
const jobs = new Map<number, Promise<void>>();
const pausedAt = new Map<number, number>();

const pendingCount = (userId: number) => prisma.collectionCard.count({ where: { userId, enriched: false } });

async function run(userId: number) {
  let idle = 0;
  for (;;) {
    const before = await pendingCount(userId);
    if (before === 0) {
      pausedAt.delete(userId);
      await warmPrices(userId);
      return;
    }
    try {
      await enrichBatch(userId);
    } catch (e) {
      console.error("[collection] index pass failed", e instanceof Error ? e.message : e);
    }
    const after = await pendingCount(userId);
    if (after < before) { idle = 0; continue; }
    if (++idle >= MAX_IDLE_PASSES) {
      pausedAt.set(userId, Date.now());
      console.warn(`[collection] indexing paused for user ${userId}: ${after} left`);
      return;
    }
    await sleep(Math.min(2000 * 2 ** idle, 30_000));
  }
}

// Price every matched printing while no one is waiting, so the next GET is
// served from the price cache instead of ~35 Scryfall calls for a big import.
async function warmPrices(userId: number) {
  const rows = await prisma.collectionCard.findMany({ where: { userId }, select: { imageUri: true } });
  await usdPricesByIds(rows.map((r) => scryfallIdFromImage(r.imageUri)).filter((id): id is string => id !== null)).catch(() => {});
}

/** Start the user's indexing job if cards are pending and none is running.
 *  After a pause it waits out a cool-down first, so polling can't hammer a
 *  Scryfall that's down. */
export async function ensureIndexing(userId: number, pending?: number): Promise<IndexerStatus> {
  if (jobs.has(userId)) return { running: true, paused: false };
  const left = pending ?? (await pendingCount(userId));
  if (left === 0) return { running: false, paused: false };
  const paused = pausedAt.get(userId);
  if (paused && Date.now() - paused < RESTART_COOLDOWN_MS) return { running: false, paused: true };
  pausedAt.delete(userId);
  const job = run(userId)
    .catch((e) => console.error("[collection] indexing job failed", e instanceof Error ? e.message : e))
    .finally(() => jobs.delete(userId));
  jobs.set(userId, job);
  return { running: true, paused: false };
}
