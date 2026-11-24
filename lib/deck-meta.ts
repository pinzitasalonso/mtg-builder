// Search and share metadata for a deck page. Only for decks anyone may open
// (ownerless public decks, and decks their owner shared): a private deck's
// name never reaches a crawler or a link preview.

import prisma from "@/lib/prisma";
import { deckFace } from "@/lib/deck-face";
import type { PublicDeckSummary } from "@/lib/deck-meta-text";

export { deckDescription, formatName, type PublicDeckSummary } from "@/lib/deck-meta-text";

export async function publicDeckSummary(publicId: string): Promise<PublicDeckSummary | null> {
  if (!publicId) return null;
  const deck = await prisma.deck
    .findFirst({
      where: { publicId, OR: [{ userId: null }, { shared: true }] },
      select: {
        publicId: true,
        name: true,
        format: true,
        commander: true,
        cards: { where: { board: "deck" }, select: { name: true, quantity: true, typeLine: true, colorIdentity: true, imageUri: true, manaCost: true } },
      },
    })
    .catch(() => null);
  if (!deck?.publicId) return null;
  const colors = new Set<string>();
  for (const c of deck.cards) for (const l of c.colorIdentity ?? "") colors.add(l);
  const highlights = deck.cards
    .filter((c) => !c.typeLine?.includes("Land") && c.name !== deck.commander)
    .slice(0, 4)
    .map((c) => c.name);
  // The deck's face, as its tile and its page show it. A commander that
  // isn't in the list has no stored picture: the list's own face stands in.
  const cover = deckFace(deck.commander, deck.cards) ?? deckFace(null, deck.cards);
  return {
    publicId: deck.publicId,
    name: deck.name,
    format: deck.format,
    commander: deck.commander,
    count: deck.cards.reduce((n, c) => n + c.quantity, 0),
    colors: "WUBRG".split("").filter((l) => colors.has(l)).join(""),
    highlights,
    coverImage: cover ? cover.imageUri : null,
  };
}
