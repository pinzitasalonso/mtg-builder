// Client-side helpers for adding cards to a deck's pool. Shared by decklist
// import, bulk lands, AI-judge tap-to-add and name-mode add.

import { OutCard, resolveNamed } from "./scryfall";

// A pool row as the client sees it: card data + DB row id + copies held.
export interface PoolEntry extends OutCard {
  dbId: number;
  quantity: number;
}

// Build a lowercase-name → card map of the current pool. Matching by NAME (not
// scryfall id) matters: Scryfall's fuzzy lookup may resolve to a different
// printing's id than the pooled copy, and we want to increment that row.
export function poolByName(pool: OutCard[]): Map<string, OutCard> {
  const m = new Map<string, OutCard>();
  for (const c of pool) {
    m.set(c.name.toLowerCase(), {
      id: c.id,
      name: c.name,
      imageUri: c.imageUri,
      manaCost: c.manaCost,
      typeLine: c.typeLine,
      oracleText: c.oracleText,
    });
  }
  return m;
}

export async function postCard(deckId: number, card: OutCard, qty: number): Promise<boolean> {
  const post = await fetch(`/api/decks/${deckId}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scryfallId: card.id,
      name: card.name,
      imageUri: card.imageUri,
      manaCost: card.manaCost,
      typeLine: card.typeLine,
      oracleText: card.oracleText,
      quantity: qty,
    }),
  });
  return post.ok;
}

// Add `qty` copies of a card by name. If a card of that name is already in the
// pool we increment THAT row; otherwise we resolve it on Scryfall and create
// it. `known` is mutated so repeats within a batch merge.
export async function resolveAndAdd(
  deckId: number,
  name: string,
  qty: number,
  known: Map<string, OutCard>
): Promise<"added" | "notfound" | "error"> {
  try {
    const existing = known.get(name.toLowerCase());
    if (existing) {
      return (await postCard(deckId, existing, qty)) ? "added" : "error";
    }
    const card = await resolveNamed(name);
    if (!card) return "notfound";
    if (!card.imageUri) return "error";
    if (!(await postCard(deckId, card, qty))) return "error";
    known.set(card.name.toLowerCase(), card);
    return "added";
  } catch {
    return "error";
  }
}
