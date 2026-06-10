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

// ── Printing → blueprint resolution ─────────────────────────────────────────
// The Full API has no card-name search, so callers resolve names to concrete
// printings (set code + collector number) via Scryfall first, then map those
// onto CardTrader's catalog here. Expansion codes match Scryfall set codes,
// and blueprints are matched by collector number (with a normalized-name
// fallback for codes that drift). Both catalogs are cached per process.

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

// Collapse name variants ("Sol Ring" / "sol-ring" / "Fire // Ice") to one form.
export const normalizeCardName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export async function findBlueprintId(setCode: string, collectorNumber: string, name: string): Promise<number | null> {
  const expId = await expansionId(setCode);
  if (expId === null) return null;
  const bps = await blueprintsFor(expId);
  const byNum = bps.find((b) => (b.fixed_properties?.collector_number ?? b.collector_number) === collectorNumber);
  if (byNum) return byNum.id;
  const full = normalizeCardName(name);
  const front = normalizeCardName(name.split(" // ")[0]);
  return bps.find((b) => {
    const n = normalizeCardName(b.name);
    return n === full || n === front;
  })?.id ?? null;
}
