// Client-side helpers for the owned-card collection.

export interface CollectionCard {
  name: string;
  quantity: number;
}

export interface Collection {
  cards: CollectionCard[];
  unique: number;
  total: number;
}

export const EMPTY_COLLECTION: Collection = { cards: [], unique: 0, total: 0 };

export async function fetchCollection(): Promise<Collection> {
  try {
    const res = await fetch("/api/collection");
    if (!res.ok) return EMPTY_COLLECTION;
    return (await res.json()) as Collection;
  } catch {
    return EMPTY_COLLECTION;
  }
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  unique?: number;
  total?: number;
  imported?: number;
}

export async function importCollection(text: string, mode: "add" | "replace"): Promise<ImportResult> {
  try {
    const res = await fetch("/api/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, mode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? "Import failed." };
    return { ok: true, ...data };
  } catch {
    return { ok: false, error: "Network error." };
  }
}

// Set the exact owned quantity of a single card (0 removes it).
export async function setCollectionCard(name: string, quantity: number): Promise<boolean> {
  try {
    const res = await fetch("/api/collection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, quantity }),
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
