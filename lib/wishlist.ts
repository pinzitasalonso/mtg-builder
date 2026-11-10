// The wishlist: cards a player wants and doesn't have yet, kept next to the
// collection. The pure half (cleaning what's added, the totals); the route is
// app/api/wishlist, the client lib/wishlist-client.ts.

/** Different cards one wishlist holds. */
export const MAX_WISHLIST = 2000;
/** Copies of one card. */
export const MAX_WANTED = 99;

/** A card to add, as the route stores it. */
export interface WishlistInput {
  name: string;
  quantity: number;
  imageUri: string | null;
  typeLine: string | null;
  manaCost: string | null;
  colorIdentity: string | null;
}

/** A card on the list, as the route sends it. */
export interface WishlistCard extends WishlistInput {
  /** Copies in your collection now. */
  owned: number;
  /** USD for the printing shown, when priced. */
  usdPrice: string | null;
  addedAt: string;
}

// Only a Scryfall card image: it's shown as is, and its printing (and price)
// is read back off it.
const SCRYFALL_IMAGE = /^https:\/\/([a-z0-9-]+\.)*scryfall\.(io|com)\//i;

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** What a POST asks to add: `{ cards: [...] }` or one `{ name }`. Cleaned,
    one entry per name (quantities add up, to MAX_WANTED), and at most
    MAX_WISHLIST of them. */
export function parseWishlistAdd(body: unknown): WishlistInput[] {
  const b = body as { cards?: unknown; name?: unknown } | null;
  const raw = Array.isArray(b?.cards) ? b.cards : b && typeof b === "object" && "name" in b ? [b] : [];
  const byKey = new Map<string, WishlistInput>();
  for (const r of raw.slice(0, MAX_WISHLIST * 2)) {
    const c = r as Record<string, unknown> | null;
    const name = text(c?.name, 200);
    if (!name) continue;
    const q = Math.floor(Number(c?.quantity ?? 1));
    const quantity = Number.isFinite(q) && q > 0 ? Math.min(q, MAX_WANTED) : 1;
    const imageUri = typeof c?.imageUri === "string" && SCRYFALL_IMAGE.test(c.imageUri) ? c.imageUri.slice(0, 500) : null;
    const key = name.toLowerCase();
    const had = byKey.get(key);
    if (had) {
      had.quantity = Math.min(MAX_WANTED, had.quantity + quantity);
      continue;
    }
    byKey.set(key, {
      name,
      quantity,
      imageUri,
      typeLine: text(c?.typeLine, 200),
      manaCost: text(c?.manaCost, 100),
      colorIdentity: typeof c?.colorIdentity === "string" ? c.colorIdentity.replace(/[^WUBRG]/g, "").slice(0, 5) : null,
    });
  }
  return [...byKey.values()].slice(0, MAX_WISHLIST);
}

/** Copies still to get: wanted, less those in your collection. */
export const stillWanted = (c: Pick<WishlistCard, "quantity" | "owned">) => Math.max(0, c.quantity - c.owned);

/** The list's totals: cards, copies wanted, copies still to get, and what
    those cost at the shown printings' prices (cards without a price aren't
    counted, and say so). */
export function wishlistSummary(cards: Pick<WishlistCard, "quantity" | "owned" | "usdPrice">[]) {
  let cost = 0;
  let unpriced = 0;
  let missing = 0;
  for (const c of cards) {
    const n = stillWanted(c);
    missing += n;
    if (!n) continue;
    const usd = c.usdPrice ? Number(c.usdPrice) : NaN;
    if (Number.isFinite(usd)) cost += usd * n;
    else unpriced += 1;
  }
  return {
    unique: cards.length,
    total: cards.reduce((s, c) => s + c.quantity, 0),
    missing,
    cost: Math.round(cost * 100) / 100,
    unpriced,
    owned: cards.filter((c) => c.owned > 0).length,
  };
}
