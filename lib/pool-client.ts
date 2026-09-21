// Client-side helpers for adding cards to a deck's pool. Shared by decklist
// import, bulk lands, AI-chat tap-to-add and name-mode add.

import { NAMED_GAP_MS, OutCard, cardNameKey, lookupCollection, resolveNamed, resolveNamedDetailed } from "./scryfall";
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

export interface ImportEntry {
  name: string;
  qty: number;
}

export interface ImportResult {
  /** Copies inserted (quantities summed). */
  added: number;
  /** Names Scryfall doesn't know — a typo or not a real card. Needs a human fix. */
  notFound: string[];
  /** Entries whose lookup or insert errored (Scryfall busy, offline). Safe to
      retry exactly as they are — nothing about the name is wrong. */
  failed: ImportEntry[];
}

// The bulk route accepts this many cards per request.
const BULK_INSERT_MAX = 500;

/**
 * Import many named cards, with quantities, as few requests as possible.
 *
 * A 100-card decklist used to be ~100 fuzzy lookups fired in a burst, and
 * Scryfall's 429s were reported as "card not found" — Sol Ring, allegedly
 * missing. Now: names already in the pool (`known`) need no lookup at all;
 * the rest go through POST /cards/collection, 75 per call; only the names
 * that batch genuinely can't match (typos, odd DFC spellings) fall back to a
 * fuzzy lookup, one at a time with a gap; and everything resolved is inserted
 * in one bulk request. "Not found" and "failed" are kept apart so the caller
 * can offer a retry for the latter.
 */
export async function importByName(
  deckId: string,
  entries: ImportEntry[],
  known: Map<string, OutCard>,
  board: Board = "pool"
): Promise<ImportResult> {
  // Merge repeats so "2 Plains" twice is one entry of 4.
  const merged = new Map<string, ImportEntry>();
  for (const e of entries) {
    const name = e.name.trim();
    if (!name) continue;
    const qty = Math.max(1, Math.floor(e.qty || 1));
    const prev = merged.get(cardNameKey(name));
    if (prev) prev.qty += qty;
    else merged.set(cardNameKey(name), { name, qty });
  }
  const want = [...merged.values()];
  const result: ImportResult = { added: 0, notFound: [], failed: [] };
  if (want.length === 0) return result;

  const resolved: { entry: ImportEntry; card: OutCard }[] = [];
  const toResolve: ImportEntry[] = [];
  for (const entry of want) {
    const ex = known.get(cardNameKey(entry.name));
    if (ex) resolved.push({ entry, card: ex });
    else toResolve.push(entry);
  }

  if (toResolve.length) {
    const lookup = await lookupCollection(toResolve.map((e) => e.name));
    const failedKeys = new Set(lookup.failed.map(cardNameKey));
    const fuzzy: ImportEntry[] = [];
    for (const entry of toResolve) {
      const card =
        lookup.found.get(cardNameKey(entry.name)) ??
        lookup.found.get(cardNameKey(entry.name.split(" // ")[0]!));
      if (card?.imageUri) resolved.push({ entry, card });
      else if (failedKeys.has(cardNameKey(entry.name))) result.failed.push(entry);
      else fuzzy.push(entry);
    }
    // Exact-name misses get one fuzzy try each, spaced out — these are the few
    // typos and quirks, not the whole list.
    for (let i = 0; i < fuzzy.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, NAMED_GAP_MS));
      const entry = fuzzy[i];
      const r = await resolveNamedDetailed(entry.name);
      if (r.status === "ok" && r.card.imageUri) resolved.push({ entry, card: r.card });
      else if (r.status === "failed") result.failed.push(entry);
      else result.notFound.push(entry.name);
    }
  }

  for (let i = 0; i < resolved.length; i += BULK_INSERT_MAX) {
    const batch = resolved.slice(i, i + BULK_INSERT_MAX);
    let ok = false;
    try {
      const res = await fetch(`/api/decks/${deckId}/cards/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          board,
          cards: batch.map(({ entry, card }) => ({
            scryfallId: card.id,
            name: card.name,
            imageUri: card.imageUri,
            manaCost: card.manaCost,
            typeLine: card.typeLine,
            oracleText: card.oracleText,
            colorIdentity: card.colorIdentity,
            legalities: card.legalities,
            quantity: entry.qty,
          })),
        }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      result.failed.push(...batch.map((b) => b.entry));
      continue;
    }
    for (const { entry, card } of batch) {
      result.added += entry.qty;
      // So a later call in the same session merges into this row without a lookup.
      known.set(cardNameKey(card.name), card);
    }
  }
  return result;
}

// Add one copy each of many names — the AI "Add all" path. Any miss, whether
// unknown or throttled, comes back in `failed` so the caller can name it.
export async function addManyByName(
  deckId: string,
  names: string[],
  known: Map<string, OutCard>,
  board: Board = "pool"
): Promise<{ added: number; failed: string[] }> {
  const r = await importByName(deckId, names.map((name) => ({ name, qty: 1 })), known, board);
  return { added: r.added, failed: [...r.notFound, ...r.failed.map((f) => f.name)] };
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
