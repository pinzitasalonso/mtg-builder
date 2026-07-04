// Client-side helpers for adding cards to a deck's pool. Shared by decklist
// import, bulk lands, AI-chat tap-to-add and name-mode add.

import { OutCard, collectionByName, resolveNamed } from "./scryfall";
import { enqueue } from "./offline-queue";

export type Board = "pool" | "deck";

// A pool row as the client sees it: card data + DB row id + copies held.
export interface PoolEntry extends OutCard {
  dbId: number;
  quantity: number;
  board: Board;
  role: string | null;
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
      colorIdentity: c.colorIdentity,
      legalities: c.legalities,
    });
  }
  return m;
}

export async function postCard(deckId: string, card: OutCard, qty: number): Promise<boolean> {
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
      colorIdentity: card.colorIdentity,
      legalities: card.legalities,
      quantity: qty,
    }),
  });
  return post.ok;
}

// Move a pool row between boards ("pool" ↔ "deck"). If the network is down the
// move is queued and replayed on reconnect (optimistic success).
export async function moveCard(deckId: string, dbId: number, board: Board): Promise<boolean> {
  try {
    const res = await fetch(`/api/decks/${deckId}/cards/${dbId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board }),
    });
    return res.ok; // 4xx (e.g. commander rule) is a real rejection — don't queue
  } catch {
    enqueue({ deckId, kind: "move", dbId, board });
    return true;
  }
}

// Set the exact copy count of a pool row. To drop the last copy, delete the row
// instead — the API rejects a quantity below 1.
export async function setQuantity(deckId: string, dbId: number, quantity: number): Promise<boolean> {
  const res = await fetch(`/api/decks/${deckId}/cards/${dbId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity }),
  });
  return res.ok;
}

// Remove a pool row entirely. Queued for replay if offline.
export async function deleteCard(deckId: string, dbId: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/decks/${deckId}/cards/${dbId}`, { method: "DELETE" });
    return res.ok;
  } catch {
    enqueue({ deckId, kind: "remove", dbId });
    return true;
  }
}

// Add many cards by name in one go: resolve them all with a single batched
// Scryfall lookup (75 names/request) instead of one fuzzy call each, then insert
// them in a single bulk request. Far faster and far less rate-limit-prone than
// looping resolveAndAdd. Names already in `known` (the pool) are reused without
// a Scryfall hit. Returns how many were added and which names couldn't resolve.
export async function addManyByName(
  deckId: string,
  names: string[],
  known: Map<string, OutCard>,
  board: Board = "pool"
): Promise<{ added: number; failed: string[] }> {
  const want = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (want.length === 0) return { added: 0, failed: [] };

  const cards: OutCard[] = [];
  const unresolved: string[] = [];
  // Names already pooled — reuse their card data, no Scryfall needed.
  const toResolve: string[] = [];
  for (const name of want) {
    const ex = known.get(name.toLowerCase());
    if (ex) cards.push(ex);
    else toResolve.push(name);
  }

  if (toResolve.length) {
    const resolved = await collectionByName(toResolve); // exact-name batch
    const missed: string[] = [];
    for (const name of toResolve) {
      const card = resolved.get(name.toLowerCase());
      if (card?.imageUri) cards.push(card);
      else missed.push(name);
    }
    // Fuzzy-resolve the few the exact batch didn't match (DFC names, etc).
    for (const name of missed) {
      const card = await resolveNamed(name);
      if (card?.imageUri) cards.push(card);
      else unresolved.push(name);
    }
  }

  if (cards.length === 0) return { added: 0, failed: unresolved };

  try {
    const res = await fetch(`/api/decks/${deckId}/cards/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        board,
        cards: cards.map((c) => ({
          scryfallId: c.id,
          name: c.name,
          imageUri: c.imageUri,
          manaCost: c.manaCost,
          typeLine: c.typeLine,
          oracleText: c.oracleText,
          colorIdentity: c.colorIdentity,
          legalities: c.legalities,
          quantity: 1,
        })),
      }),
    });
    if (!res.ok) return { added: 0, failed: names };
  } catch {
    return { added: 0, failed: names };
  }
  return { added: cards.length, failed: unresolved };
}

// Add `qty` copies of a card by name. If a card of that name is already in the
// pool we increment THAT row; otherwise we resolve it on Scryfall and create
// it. `known` is mutated so repeats within a batch merge.
export async function resolveAndAdd(
  deckId: string,
  name: string,
  qty: number,
  known: Map<string, OutCard>,
  opts?: { skipIfExists?: boolean }
): Promise<"added" | "exists" | "notfound" | "error"> {
  try {
    const existing = known.get(name.toLowerCase());
    if (existing) {
      if (opts?.skipIfExists) return "exists";
      return (await postCard(deckId, existing, qty)) ? "added" : "error";
    }
    const card = await resolveNamed(name);
    if (!card) return "notfound";
    if (!card.imageUri) return "error";
    // Fuzzy input may resolve to a card already in the deck under its full name.
    if (opts?.skipIfExists && known.has(card.name.toLowerCase())) return "exists";
    if (!(await postCard(deckId, card, qty))) return "error";
    known.set(card.name.toLowerCase(), card);
    return "added";
  } catch {
    return "error";
  }
}
