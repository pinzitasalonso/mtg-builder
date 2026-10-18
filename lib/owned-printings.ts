import prisma from "@/lib/prisma";
import { scryfallIdFromImage } from "@/lib/scryfall";

/* The printing a player owns of a card, from their collection, so a card
   they add to a deck shows the copy they actually have rather than
   Scryfall's default printing.

   The collection stores only the owned printing's image URL; its Scryfall id
   is inside it. Every printing of a card shares its name, cost, type and
   rules text, so swapping printings is just the id and the image. */

export interface OwnedPrinting {
  scryfallId: string;
  imageUri: string;
}

const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Owned printings for these card names (by lowercase name), for one player. */
export async function ownedPrintingsFor(userId: number, names: string[]): Promise<Map<string, OwnedPrinting>> {
  const keys = [...new Set(names.map(key).filter(Boolean))];
  const out = new Map<string, OwnedPrinting>();
  if (!keys.length) return out;
  const rows = await prisma.collectionCard.findMany({
    where: { userId, nameKey: { in: keys }, imageUri: { not: null } },
    select: { nameKey: true, imageUri: true },
  });
  for (const r of rows) {
    const id = scryfallIdFromImage(r.imageUri);
    if (id && r.imageUri) out.set(r.nameKey, { scryfallId: id, imageUri: r.imageUri });
  }
  return out;
}

/** The card as the player's own printing, when they own one. */
export function asOwned<T extends { name: string; scryfallId: string; imageUri: string }>(card: T, owned: Map<string, OwnedPrinting>): T {
  const o = owned.get(key(card.name));
  return o ? { ...card, scryfallId: o.scryfallId, imageUri: o.imageUri } : card;
}
