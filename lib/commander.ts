import prisma from "@/lib/prisma";
import { resolveNamed } from "@/lib/scryfall";

type DeckLike = { id: number; format: string; commander: string | null };

// True when a card is the deck's commander (commander format only).
export function isCommanderCard(deck: DeckLike | null | undefined, cardName: string): boolean {
  if (!deck || deck.format.toLowerCase() !== "commander") return false;
  const c = deck.commander?.trim().toLowerCase();
  return Boolean(c) && cardName.trim().toLowerCase() === c;
}

// Basic lands are the only cards that may stack in a singleton deck.
export function isBasicLand(typeLine: string | null | undefined): boolean {
  return !!typeLine && /\bbasic\b/i.test(typeLine) && /\bland\b/i.test(typeLine);
}

// In commander (a singleton format) only one copy of any non-basic card is
// allowed. Returns true when this card must be capped at a single copy.
export function singletonCapped(format: string, typeLine: string | null | undefined): boolean {
  return format.toLowerCase() === "commander" && !isBasicLand(typeLine);
}


// Ensure a commander-format deck has its commander on the deck board. Idempotent
// and best-effort: a name that doesn't resolve on Scryfall is simply skipped, and
// the Scryfall lookup only runs when the card isn't already present.
export async function ensureCommanderCard(deck: DeckLike): Promise<void> {
  if (deck.format.toLowerCase() !== "commander" || !deck.commander?.trim()) return;
  const want = deck.commander.trim().toLowerCase();
  const onDeck = await prisma.poolCard.findMany({
    where: { deckId: deck.id, board: "deck" },
    select: { name: true },
  });
  if (onDeck.some((c) => c.name.toLowerCase() === want)) return;

  const card = await resolveNamed(deck.commander.trim());
  if (!card) return;
  // Upsert so a commander already sitting in the pool is promoted to the deck
  // rather than duplicated.
  await prisma.poolCard.upsert({
    where: { deckId_scryfallId: { deckId: deck.id, scryfallId: card.id } },
    update: { board: "deck" },
    create: {
      deckId: deck.id,
      scryfallId: card.id,
      name: card.name,
      imageUri: card.imageUri,
      manaCost: card.manaCost,
      typeLine: card.typeLine,
      oracleText: card.oracleText,
      colorIdentity: card.colorIdentity,
      legalities: card.legalities ? JSON.stringify(card.legalities).slice(0, 4000) : null,
      board: "deck",
      quantity: 1,
    },
  });
}
