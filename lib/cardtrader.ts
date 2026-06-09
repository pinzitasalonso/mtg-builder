// Server-side client for the CardTrader Full API.
// Reference: https://www.cardtrader.com/docs/api/full/reference
// Auth is a personal bearer token (cardtrader.com → Settings → API) read from
// CARDTRADER_API_TOKEN — never log or return it.

const BASE = "https://api.cardtrader.com/api/v2";

export const MAGIC_GAME_ID = 1;

export interface CtPrice {
  cents: number;
  currency: string;
}

export interface CtProduct {
  id: number;
  blueprint_id?: number;
  quantity: number;
  bundle_size?: number;
  price: CtPrice;
  user?: { username?: string; can_sell_via_hub?: boolean };
}

export interface CtWishlistItem {
  quantity: number;
  blueprint_id?: number;
  meta_name?: string;
  name?: string;
  expansion_code?: string;
  collector_number?: string;
}

interface CtExpansion {
  id: number;
  code: string;
  game_id?: number;
}

interface CtBlueprint {
  id: number;
  name: string;
  collector_number?: string;
  fixed_properties?: Record<string, string | null>;
}

export const ctConfigured = () => Boolean(process.env.CARDTRADER_API_TOKEN);

export async function ct<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const token = process.env.CARDTRADER_API_TOKEN;
  if (!token) throw new Error("CARDTRADER_API_TOKEN is not set");
  const { json, ...rest } = init ?? {};
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...rest.headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`CardTrader ${res.status} on ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Name → blueprint resolution ─────────────────────────────────────────────
// The Full API has no card-name search, but POST /wishlists accepts a plain
// text decklist and resolves it server-side. Wishlist items may come back
// without a blueprint_id though (just meta_name + expansion_code +
// collector_number) — in that case we look the blueprint up in the
// expansion's export, cached per process.

let expansionsByCode: Map<string, number> | null = null;
const blueprintCache = new Map<number, CtBlueprint[]>();

async function expansionId(code: string): Promise<number | null> {
  if (!expansionsByCode) {
    const all = await ct<CtExpansion[]>("/expansions");
    expansionsByCode = new Map(
      all.filter((e) => (e.game_id ?? MAGIC_GAME_ID) === MAGIC_GAME_ID).map((e) => [e.code.toLowerCase(), e.id])
    );
  }
  return expansionsByCode.get(code.toLowerCase()) ?? null;
}

async function blueprintsFor(expId: number): Promise<CtBlueprint[]> {
  const hit = blueprintCache.get(expId);
  if (hit) return hit;
  const bps = await ct<CtBlueprint[]>(`/blueprints/export?expansion_id=${expId}`);
  blueprintCache.set(expId, bps);
  return bps;
}

export async function blueprintIdFor(item: CtWishlistItem): Promise<number | null> {
  if (item.blueprint_id) return item.blueprint_id;
  if (!item.expansion_code) return null;
  const expId = await expansionId(item.expansion_code);
  if (expId === null) return null;
  const bps = await blueprintsFor(expId);
  if (item.collector_number) {
    const byNum = bps.find(
      (b) => (b.fixed_properties?.collector_number ?? b.collector_number) === item.collector_number
    );
    if (byNum) return byNum.id;
  }
  const nm = (item.meta_name ?? item.name ?? "").toLowerCase();
  return bps.find((b) => b.name.toLowerCase() === nm)?.id ?? null;
}

/* Resolve a decklist to wishlist items via a throwaway wishlist. Lines that
   match nothing are silently dropped by CardTrader — the caller diffs the
   returned names against what it asked for. */
export async function resolveDecklist(text: string): Promise<CtWishlistItem[]> {
  const created = await ct<Record<string, unknown>>("/wishlists", {
    method: "POST",
    json: {
      deck: { game_id: MAGIC_GAME_ID, name: "Spellpool order (temp)", public: false, deck_items_from_text_deck: text },
    },
  });
  // The response may be the wishlist itself or wrapped — normalise both.
  const wl = (created.deck ?? created.wishlist ?? created) as { id?: number; items?: CtWishlistItem[]; deck_items?: CtWishlistItem[] };
  let items: CtWishlistItem[] = wl.items ?? wl.deck_items ?? [];
  if (items.length === 0 && wl.id) {
    const got = await ct<{ items?: CtWishlistItem[]; deck_items?: CtWishlistItem[] }>(`/wishlists/${wl.id}`);
    items = got.items ?? got.deck_items ?? [];
  }
  if (wl.id) ct(`/wishlists/${wl.id}`, { method: "DELETE" }).catch(() => {});
  return items;
}
