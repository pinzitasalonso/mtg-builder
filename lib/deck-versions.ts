import prisma from "@/lib/prisma";
import type { VersionCard } from "@/lib/deck-diff";

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
