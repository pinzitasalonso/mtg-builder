// Client-side helpers for the wishlist (app/api/wishlist).

import type { WishlistCard, WishlistInput } from "@/lib/wishlist";

export interface Wishlist {
  cards: WishlistCard[];
  unique: number;
  total: number;
  /** Copies still to get. */
  missing: number;
  /** What those cost, in USD, at the printings shown. */
  cost: number;
  /** Cards still to get that have no price. */
  unpriced: number;
  /** Cards on the list you now own at least one of. */
  owned: number;
}

export const EMPTY_WISHLIST: Wishlist = { cards: [], unique: 0, total: 0, missing: 0, cost: 0, unpriced: 0, owned: 0 };

/** Null when the request failed, so a list on screen can stay. */
export async function fetchWishlist(): Promise<Wishlist | null> {
  try {
    const res = await fetch("/api/wishlist", { cache: "no-store" });
    return res.ok ? ((await res.json()) as Wishlist) : null;
  } catch {
    return null;
  }
}

export async function fetchWishlistCount(): Promise<number> {
  try {
    const res = await fetch("/api/wishlist?count=1", { cache: "no-store" });
    return res.ok ? (((await res.json()) as { unique?: number }).unique ?? 0) : 0;
  } catch {
    return 0;
  }
}

export interface WishlistAddResult {
  ok: boolean;
  error?: string;
  added?: number;
  raised?: number;
  already?: number;
  unknown?: string[];
}

/** Add cards (by name alone, or with what's already known about them). */
export async function addToWishlist(cards: (Partial<WishlistInput> & { name: string })[]): Promise<WishlistAddResult> {
  try {
    const res = await fetch("/api/wishlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cards }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? (res.status === 401 ? "Sign in to keep a wishlist." : "Couldn’t add it. Try again."), unknown: data.unknown };
    return { ok: true, ...data };
  } catch {
    return { ok: false, error: "Couldn’t reach Spellpool. Try again." };
  }
}

const send = async (method: string, body?: unknown, query = ""): Promise<boolean> => {
  try {
    const res = await fetch(`/api/wishlist${query}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    return res.ok;
  } catch {
    return false;
  }
};

/** Copies wanted; 0 takes the card off the list. */
export const setWishlistQty = (name: string, quantity: number) => send("PATCH", { name, quantity });
/** You got it: it moves into your collection. */
export const gotWishlistCard = (name: string) => send("POST", { got: name });
export const clearWishlist = () => send("DELETE");
/** Take off the cards you now own enough of. */
export const clearOwnedFromWishlist = () => send("DELETE", undefined, "?owned=1");

/** "2 Sol Ring" lines for the copies still to get: a list to buy from. */
export function wishlistText(cards: Pick<WishlistCard, "name" | "quantity" | "owned">[]): string {
  return cards
    .map((c) => ({ name: c.name, n: Math.max(0, c.quantity - c.owned) }))
    .filter((c) => c.n > 0)
    .map((c) => `${c.n} ${c.name}`)
    .join("\n");
}
