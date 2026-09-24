import prisma from "@/lib/prisma";
import type { VersionCard } from "@/lib/deck-diff";
import { lookupCollection, lookupPrintings } from "@/lib/scryfall";

// Enough to keep a build's history; a deck is not a git repo.
export const MAX_VERSIONS = 30;
export const MAX_VERSION_LABEL = 80;

export type SnapshotResult =
  | { ok: true; version: { id: number; label: string | null; createdAt: Date; deckCount: number; poolCount: number } }
  | { ok: false; error: string };

/** Save a deck's cards as they are now, as a version. Shared by the versions
 *  route and the assistant, which saves one before every edit it makes. */
export async function snapshotDeck(deckId: number, label: string | null): Promise<SnapshotResult> {
  const count = await prisma.deckVersion.count({ where: { deckId } });
  if (count >= MAX_VERSIONS) {
    return { ok: false, error: `A deck keeps at most ${MAX_VERSIONS} versions — delete one first.` };
  }
  const rows = await prisma.poolCard.findMany({
    where: { deckId },
    select: { name: true, quantity: true, board: true, scryfallId: true },
    orderBy: { addedAt: "asc" },
  });
  const cards: VersionCard[] = rows.map((r) => ({
    name: r.name,
    quantity: r.quantity,
    board: r.board === "deck" ? "deck" : "pool",
    scryfallId: r.scryfallId,
  }));
  const deckCount = cards.filter((c) => c.board === "deck").reduce((n, c) => n + c.quantity, 0);
  const poolCount = cards.filter((c) => c.board === "pool").reduce((n, c) => n + c.quantity, 0);
  const version = await prisma.deckVersion.create({
    data: { deckId, label: label?.trim().slice(0, MAX_VERSION_LABEL) || null, cards: JSON.stringify(cards), deckCount, poolCount },
    select: { id: true, label: true, createdAt: true, deckCount: true, poolCount: true },
  });
  return { ok: true, version };
}

export type RestoreResult =
  | { ok: true; cards: number; missing: string[]; backup: string | null }
  | { ok: false; error: string; status: number };

/**
 * Put a deck back the way a saved version had it: the same cards, counts and
 * boards. The deck as it is now is saved as a version first, so a restore can
 * itself be undone.
 *
 * Cards still in the deck keep their rows (only counts and boards change).
 * Cards that were removed since are looked up on Scryfall again — by the
 * saved printing's id, or by name for versions saved without one — and all
 * of that happens BEFORE anything is changed, so a Scryfall outage leaves the
 * deck untouched rather than half-restored.
 */
export async function restoreVersion(deckId: number, versionId: number): Promise<RestoreResult> {
  const v = await prisma.deckVersion.findFirst({ where: { id: versionId, deckId } });
  if (!v) return { ok: false, error: "That version doesn't exist.", status: 404 };
  let saved: VersionCard[] = [];
  try {
    saved = (JSON.parse(v.cards) as VersionCard[]).filter((c) => c && typeof c.name === "string" && c.quantity > 0);
  } catch {
    return { ok: false, error: "That version can't be read.", status: 400 };
  }

  const rows = await prisma.poolCard.findMany({ where: { deckId }, select: { id: true, name: true, scryfallId: true } });
  const byId = new Map(rows.map((r) => [r.scryfallId, r]));
  const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r]));
  const rowFor = (c: VersionCard) => (c.scryfallId && byId.get(c.scryfallId)) || byName.get(c.name.toLowerCase()) || null;

  // Look up everything that has to be re-created, first.
  const gone = saved.filter((c) => !rowFor(c));
  const withId = gone.filter((c) => c.scryfallId);
  const byNameOnly = gone.filter((c) => !c.scryfallId);
  const [printings, named] = await Promise.all([
    withId.length ? lookupPrintings(withId.map((c) => `id:${c.scryfallId}`)) : null,
    byNameOnly.length ? lookupCollection(byNameOnly.map((c) => c.name)) : null,
  ]);
  if ((printings?.failed.length ?? 0) + (named?.failed.length ?? 0) > 0) {
    return { ok: false, error: "Scryfall didn't answer, so nothing was changed. Try again in a moment.", status: 502 };
  }

  const backup = await snapshotDeck(deckId, `Before restoring ${v.label ?? "a version"}`);
  if (!backup.ok) return { ok: false, error: `${backup.error} (A restore saves the current deck first.)`, status: 400 };

  const keep = new Set<number>();
  const ops = [];
  const missing: string[] = [];
  for (const c of saved) {
    const board = c.board === "deck" ? "deck" : "pool";
    const row = rowFor(c);
    if (row) {
      keep.add(row.id);
      ops.push(prisma.poolCard.update({ where: { id: row.id }, data: { quantity: c.quantity, board } }));
      continue;
    }
    const card = c.scryfallId
      ? printings?.found.get(`id:${c.scryfallId.toLowerCase()}`)
      : named?.found.get(c.name.trim().replace(/\s+/g, " ").toLowerCase());
    if (!card) { missing.push(c.name); continue; }
    ops.push(
      prisma.poolCard.create({
        data: {
          deckId,
          scryfallId: card.id,
          name: card.name,
          imageUri: card.imageUri,
          manaCost: card.manaCost,
          typeLine: card.typeLine,
          oracleText: card.oracleText,
          colorIdentity: card.colorIdentity,
          legalities: card.legalities ? JSON.stringify(card.legalities).slice(0, 4000) : null,
          board,
          quantity: c.quantity,
        },
      })
    );
  }
  const drop = rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
  await prisma.$transaction([prisma.poolCard.deleteMany({ where: { id: { in: drop } } }), ...ops]);
  return { ok: true, cards: saved.length - missing.length, missing, backup: backup.version.label };
}
