// Client-side helpers for the owned-card collection.

export interface CollectionCard {
  name: string;
  quantity: number;
  // Scryfall metadata, resolved server-side; null/undefined until enriched.
  colorIdentity?: string | null;
  typeLine?: string | null;
  manaCost?: string | null;
  imageUri?: string | null;
  // USD for the owned printing (read off imageUri server-side), when priced.
  usdPrice?: string | null;
}

export interface Collection {
  cards: CollectionCard[];
  unique: number;
  total: number;
  // Cards still awaiting server-side enrichment; poll GET until this is 0.
  pending: number;
  // Names Scryfall has no card for (sent once nothing is pending).
  unrecognised?: string[];
}

export const EMPTY_COLLECTION: Collection = { cards: [], unique: 0, total: 0, pending: 0 };

export async function fetchCollection(): Promise<Collection> {
  return (await tryFetchCollection()) ?? EMPTY_COLLECTION;
}

// Null when the request failed, so a caller showing a collection can keep it
// rather than blank the screen over one dropped request.
export async function tryFetchCollection(): Promise<Collection | null> {
  try {
    const res = await fetch("/api/collection");
    if (!res.ok) return null;
    return (await res.json()) as Collection;
  } catch {
    return null;
  }
}

// Queue the unrecognised names for another lookup.
export async function rematchCollection(): Promise<boolean> {
  try {
    const res = await fetch("/api/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rematch: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  unique?: number;
  total?: number;
  imported?: number;
  truncated?: number;
}

export async function importCollection(text: string, mode: "add" | "replace"): Promise<ImportResult> {
  try {
    const res = await fetch("/api/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, mode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? `Import failed (${res.status}). Your list is still in the box — try again.` };
    return { ok: true, ...data };
  } catch {
    return { ok: false, error: "Couldn’t reach Spellpool. Your list is still in the box — try again." };
  }
}

// Set the exact owned quantity of a single card (0 removes it). An imageUri
// pins the printing owned — the version is read back off that image.
export async function setCollectionCard(name: string, quantity: number, imageUri?: string): Promise<boolean> {
  try {
    const res = await fetch("/api/collection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(imageUri ? { name, quantity, imageUri } : { name, quantity }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function clearCollection(): Promise<boolean> {
  try {
    const res = await fetch("/api/collection", { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

// Lowercased-name set for O(1) "do I own this?" checks against card names.
export function ownedNameSet(cards: CollectionCard[]): Set<string> {
  return new Set(cards.map((c) => c.name.toLowerCase()));
}

// Every paper printing of a card, newest first (see /api/collection/printings).
export interface CardPrinting {
  id: string;
  name: string;
  set: string;
  setName: string;
  number: string;
  released: string | null;
  imageUri: string;
  finishes: string[];
  usd: string | null;
  usdFoil: string | null;
}

export async function fetchPrintings(name: string): Promise<CardPrinting[] | null> {
  try {
    const res = await fetch(`/api/collection/printings?name=${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    return ((await res.json()).printings ?? []) as CardPrinting[];
  } catch {
    return null;
  }
}
