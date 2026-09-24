// Shared Scryfall types + helpers. Isomorphic: plain `fetch`, usable from route
// handlers and client components alike (browsers silently drop the User-Agent
// header, which is fine).

import { decodePrinting } from "./printing";

export interface ScryfallCard {
  id: string;
  name: string;
  image_uris?: { normal?: string; large?: string };
  card_faces?: {
    image_uris?: { normal?: string; large?: string };
    oracle_text?: string;
    mana_cost?: string;
    type_line?: string;
    power?: string;
    toughness?: string;
  }[];
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  color_identity?: string[];
  legalities?: Record<string, string>;
  set?: string;
  collector_number?: string;
  digital?: boolean;
  cmc?: number;
  power?: string;
  toughness?: string;
  keywords?: string[];
  produced_mana?: string[];
}

// The card shape the rest of the app speaks — API responses, pool rows, UI.
export interface OutCard {
  id: string;
  name: string;
  imageUri: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
  // WUBRG letters in canonical order; "" = colorless, null = unknown.
  colorIdentity: string | null;
  // Scryfall legalities map (format → "legal" | "not_legal" | …); null = unknown.
  legalities: Record<string, string> | null;
}

export const SCRYFALL_HEADERS = { "User-Agent": "mtg-builder/1.0", Accept: "application/json" };

export function toOutCard(c: ScryfallCard): OutCard {
  const imageUri =
    c.image_uris?.normal ??
    c.image_uris?.large ??
    c.card_faces?.[0]?.image_uris?.normal ??
    c.card_faces?.[0]?.image_uris?.large ??
    "";
  return {
    id: c.id,
    name: c.name,
    imageUri,
    manaCost: c.mana_cost ?? null,
    typeLine: c.type_line ?? null,
    oracleText: c.oracle_text ?? null,
    colorIdentity: Array.isArray(c.color_identity)
      ? "WUBRG".split("").filter((l) => c.color_identity!.includes(l)).join("")
      : null,
    legalities: c.legalities ?? null,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Scryfall asks for ≤10 requests/second and answers bursts with 429. Between
// batch calls we leave a gap; after a throttle we wait what Retry-After says
// (or a second) before the single retry.
const COLLECTION_GAP_MS = 100;
const NAMED_GAP_MS = 120;
function retryDelayMs(res: Response | null): number {
  const after = Number(res?.headers.get("Retry-After"));
  return Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 5000) : 1000;
}
// A transient status worth one retry (as opposed to 404 = no such card).
const transient = (res: Response) => res.status === 429 || res.status >= 500;

// Lowercase lookup keys a card answers to: its full name and, for a
// double-faced/split card, its front face — Scryfall answers a request for
// "Dusk" with "Dusk // Dawn", and callers look up by what they asked for.
function nameKeys(fullName: string): string[] {
  const full = fullName.trim().toLowerCase();
  const front = fullName.split(" // ")[0]!.trim().toLowerCase();
  return front && front !== full ? [full, front] : [full];
}
// Canonical lookup key for a card name: trimmed, internal whitespace
// collapsed, lowercased. Every name map in the app is keyed through this.
export function normalizeCardKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Bulk name → card lookup via POST /cards/collection, 75 identifiers per call.
 *
 * Three explicit buckets, because "the request failed" and "no such card" must
 * not be reported the same way: a decklist import that hits a 429 mid-way would
 * otherwise tell the player that Sol Ring doesn't exist.
 *   found    — keyed by the name asked for, the card's full name, and its
 *              front-face name → card
 *   notFound — names the batch could not match: Scryfall listed them as
 *              not_found, or rejected the request outright (a non-transient
 *              4xx). The fuzzy endpoint is the tie-breaker for those.
 *   failed   — names whose request errored (429/5xx/network) even after a retry
 */
export interface CollectionLookup {
  found: Map<string, OutCard>;
  notFound: string[];
  failed: string[];
}

export async function lookupCollection(names: string[]): Promise<CollectionLookup> {
  const found = new Map<string, OutCard>();
  const notFound: string[] = [];
  const failed: string[] = [];
  for (let i = 0; i < names.length; i += 75) {
    if (i > 0) await sleep(COLLECTION_GAP_MS);
    const chunk = names.slice(i, i + 75);
    let data: { data?: ScryfallCard[]; not_found?: { name?: string }[] } | null = null;
    let rejected = false;
    for (let attempt = 0; attempt < 2 && !data && !rejected; attempt++) {
      let res: Response | null = null;
      try {
        res = await fetch("https://api.scryfall.com/cards/collection", {
          method: "POST",
          headers: { ...SCRYFALL_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
        });
        if (res.ok) data = await res.json();
        else if (!transient(res)) rejected = true; // 4xx other than 429: retrying won't help
      } catch {
        /* network blip — retry once */
      }
      if (!data && !rejected && attempt === 0) await sleep(retryDelayMs(res));
    }
    if (rejected) {
      // Not a throttle, so not retryable as-is — but not proof the names are
      // wrong either. Hand them to the per-name path.
      notFound.push(...chunk);
      continue;
    }
    if (!data) {
      failed.push(...chunk);
      continue;
    }
    // Scryfall lists the identifiers it couldn't match, and returns the rest
    // in the order asked. Keying a card by the name we ASKED for matters when
    // Scryfall's canonical name differs ("Lim-Dul's Vault" → "Lim-Dûl's Vault").
    const missing = new Set((data.not_found ?? []).map((n) => normalizeCardKey(n.name ?? "")));
    const asked = chunk.filter((name) => !missing.has(normalizeCardKey(name)));
    const cards = (data.data ?? []).filter((c) => c?.id);
    cards.forEach((c, i) => {
      const card = toOutCard(c);
      const keys = asked.length === cards.length ? [normalizeCardKey(asked[i]!), ...nameKeys(c.name)] : nameKeys(c.name);
      for (const k of keys) if (!found.has(k)) found.set(k, card);
    });
    for (const name of chunk) {
      const k = normalizeCardKey(name);
      if (missing.has(k) || (!found.has(k) && !found.has(normalizeCardKey(name.split(" // ")[0]!)))) {
        notFound.push(name);
      }
    }
  }
  return { found, notFound, failed };
}

/**
 * Exact printings via POST /cards/collection: by Scryfall id, or by set code
 * and collector number. Same three buckets as lookupCollection, keyed by the
 * encoded ref (lib/printing.ts). A printing Scryfall doesn't have is notFound,
 * and the caller falls back to the card's name.
 */
export async function lookupPrintings(refs: string[]): Promise<CollectionLookup> {
  const found = new Map<string, OutCard>();
  const notFound: string[] = [];
  const failed: string[] = [];
  const unique = [...new Set(refs)];
  for (let i = 0; i < unique.length; i += 75) {
    if (i > 0) await sleep(COLLECTION_GAP_MS);
    const chunk = unique.slice(i, i + 75);
    const identifiers = chunk.map((r) => {
      const p = decodePrinting(r);
      return p?.id ? { id: p.id } : { set: p?.set, collector_number: p?.number };
    });
    let data: { data?: ScryfallCard[] } | null = null;
    let rejected = false;
    for (let attempt = 0; attempt < 2 && !data && !rejected; attempt++) {
      let res: Response | null = null;
      try {
        res = await fetch("https://api.scryfall.com/cards/collection", {
          method: "POST",
          headers: { ...SCRYFALL_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ identifiers }),
        });
        if (res.ok) data = await res.json();
        else if (!transient(res)) rejected = true;
      } catch {
        /* network blip — retry once */
      }
      if (!data && !rejected && attempt === 0) await sleep(retryDelayMs(res));
    }
    if (rejected) { notFound.push(...chunk); continue; }
    if (!data) { failed.push(...chunk); continue; }
    for (const c of data.data ?? []) {
      if (!c?.id) continue;
      const card = toOutCard(c);
      found.set(`id:${c.id.toLowerCase()}`, card);
      if (c.set && c.collector_number) found.set(`set:${c.set.toLowerCase()}:${c.collector_number.toLowerCase()}`, card);
    }
    for (const r of chunk) if (!found.has(r)) notFound.push(r);
  }
  return { found, notFound, failed };
}

// The found map alone — for callers that treat every miss the same way.
export async function collectionByName(names: string[]): Promise<Map<string, OutCard>> {
  return (await lookupCollection(names)).found;
}

// Resolve a loose card name to a full card object via the fuzzy endpoint, with
// the same three-way answer: the card, "notfound" (404 — a typo or not a real
// card), or "failed" (throttled / down even after a retry).
export type NamedResult =
  | { status: "ok"; card: OutCard }
  | { status: "notfound" | "failed"; card: null };

export async function resolveNamedDetailed(name: string): Promise<NamedResult> {
  const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, { headers: SCRYFALL_HEADERS });
      if (res.ok) {
        const c = (await res.json()) as ScryfallCard;
        return c?.id ? { status: "ok", card: toOutCard(c) } : { status: "notfound", card: null };
      }
      if (!transient(res)) return { status: "notfound", card: null };
    } catch {
      /* network blip — retry once */
    }
    if (attempt === 0) await sleep(retryDelayMs(res));
  }
  return { status: "failed", card: null };
}

// Null on any miss — for callers that can simply skip an unresolved name.
export async function resolveNamed(name: string): Promise<OutCard | null> {
  return (await resolveNamedDetailed(name)).card;
}

export { NAMED_GAP_MS };

// Market price (USD) for a single card by Scryfall id, memoized for the page's
// lifetime so the swipe review doesn't refetch the same card. Returns the raw
// price string (e.g. "1.23") or null when Scryfall has no USD price.
const usdPriceCache = new Map<string, string | null>();
export async function fetchUsdPrice(scryfallId: string): Promise<string | null> {
  if (usdPriceCache.has(scryfallId)) return usdPriceCache.get(scryfallId)!;
  try {
    const res = await fetch(`https://api.scryfall.com/cards/${scryfallId}`, { headers: SCRYFALL_HEADERS });
    if (!res.ok) {
      usdPriceCache.set(scryfallId, null);
      return null;
    }
    const c = (await res.json()) as { prices?: { usd?: string | null } };
    const usd = typeof c?.prices?.usd === "string" ? c.prices.usd : null;
    usdPriceCache.set(scryfallId, usd);
    return usd;
  } catch {
    return null;
  }
}

// The Scryfall id embedded in a card image URL — the filename is the id (a
// UUID). Null when the URL is missing or not in that shape. Lets us price a
// collection card (which stores only its owned printing's image) without a
// separate id column.
export function scryfallIdFromImage(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const m = uri.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}

// Batched USD prices for many Scryfall ids, memoized in the same cache as
// fetchUsdPrice so the two interoperate. Returns id → price string for the
// cards Scryfall priced; ids with no USD price (or that Scryfall didn't return)
// are cached as null so they aren't refetched. Used to price a whole collection
// server-side in a few /cards/collection calls instead of one lookup per card.
export async function usdPricesByIds(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    if (usdPriceCache.has(id)) {
      const cached = usdPriceCache.get(id)!;
      if (cached) out.set(id, cached);
    } else {
      missing.push(id);
    }
  }
  for (let i = 0; i < missing.length; i += 75) {
    const chunk = missing.slice(i, i + 75);
    try {
      const res = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { ...SCRYFALL_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: chunk.map((id) => ({ id })) }),
      });
      if (!res.ok) continue; // leave this chunk uncached; a later request retries
      const data = (await res.json()) as {
        data?: Array<{ id: string; prices?: { usd?: string | null } }>;
      };
      const seen = new Set<string>();
      for (const c of data.data ?? []) {
        const usd = typeof c.prices?.usd === "string" ? c.prices.usd : null;
        usdPriceCache.set(c.id, usd);
        seen.add(c.id);
        if (usd) out.set(c.id, usd);
      }
      for (const id of chunk) if (!seen.has(id)) usdPriceCache.set(id, null);
    } catch {
      // Network hiccup — leave the chunk uncached so the next GET can retry.
    }
  }
  return out;
}

// A concrete printing of a card — what's needed to locate it in another
// marketplace's catalog (set code + collector number).
export interface ScryfallPrinting {
  name: string;
  set: string;
  collectorNumber: string;
}

const toPrinting = (c: ScryfallCard): ScryfallPrinting | null =>
  c.set && c.collector_number ? { name: c.name, set: c.set, collectorNumber: c.collector_number } : null;

// Bulk name → default printing via /cards/collection. Keys are lowercase: the
// full card name plus the front-face name for double-faced/split cards, so
// callers can look up whichever form they hold.
export async function defaultPrintingsByName(names: string[]): Promise<Map<string, ScryfallPrinting>> {
  const out = new Map<string, ScryfallPrinting>();
  for (let i = 0; i < names.length; i += 75) {
    const chunk = names.slice(i, i + 75);
    try {
      const res = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { ...SCRYFALL_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const c of (data.data ?? []) as ScryfallCard[]) {
        const p = toPrinting(c);
        if (!p) continue;
        out.set(c.name.toLowerCase(), p);
        const front = c.name.split(" // ")[0].toLowerCase();
        if (!out.has(front)) out.set(front, p);
      }
    } catch {
      // skip the chunk — callers treat missing entries as unresolved
    }
    if (i + 75 < names.length) await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}

// All paper printings of an exactly-named card, newest first (first page only —
// 175 printings is plenty for fallback lookups).
export async function printingsOf(name: string): Promise<ScryfallPrinting[]> {
  try {
    const q = `!"${name}" game:paper`;
    const res = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=released&dir=desc`,
      { headers: SCRYFALL_HEADERS }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return ((data.data ?? []) as ScryfallCard[])
      .filter((c) => !c.digital)
      .map(toPrinting)
      .filter((p): p is ScryfallPrinting => p !== null);
  } catch {
    return [];
  }
}

// ── Forgiving Scryfall input. The Scryfall box expects real syntax
// (`t:creature c:u mv=1`), but people type plain English like
// "1 mana blue creatures", which Scryfall 404s on. This maps bare words to the
// equivalent tokens while leaving anything that already looks like syntax
// (carries `:`, `=`, `<`, `>`, `!`, or quotes) untouched, so power queries pass
// through verbatim and casual phrasing still finds cards.
const COLOR_WORDS: Record<string, string> = {
  white: "w", blue: "u", black: "b", red: "r", green: "g", colorless: "c",
};
const TYPE_WORDS: Record<string, string> = {
  creature: "creature", creatures: "creature",
  instant: "instant", instants: "instant",
  sorcery: "sorcery", sorceries: "sorcery",
  enchantment: "enchantment", enchantments: "enchantment",
  artifact: "artifact", artifacts: "artifact",
  planeswalker: "planeswalker", planeswalkers: "planeswalker",
  land: "land", lands: "land",
  legendary: "legendary",
};
const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
// Dropped — they only connect the meaningful words ("1 mana blue creatures").
const FILLER_WORDS = new Set([
  "mana", "cost", "costs", "cmc", "cards", "card", "with", "that", "for", "and", "the", "a", "an", "of",
]);

export function naturalToScryfall(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const tokens = trimmed.split(/\s+/);
  // Already real syntax? Leave it entirely alone.
  if (tokens.some((t) => /[:=<>!"]/.test(t))) return trimmed;

  const colors: string[] = [];
  const out: string[] = [];
  for (const tok of tokens) {
    const w = tok.toLowerCase();
    if (FILLER_WORDS.has(w)) continue;
    if (w in COLOR_WORDS) {
      const letter = COLOR_WORDS[w];
      if (!colors.includes(letter)) colors.push(letter);
      continue;
    }
    if (w in TYPE_WORDS) {
      out.push(`t:${TYPE_WORDS[w]}`);
      continue;
    }
    const num = /^\d+$/.test(w) ? Number(w) : WORD_NUMBERS[w];
    if (num !== undefined && Number.isFinite(num)) {
      out.push(`mv=${num}`);
      continue;
    }
    // Unrecognized word — keep it (name search) so nothing is silently lost.
    out.push(tok);
  }
  if (colors.length) out.unshift(`c:${colors.join("")}`);
  return out.join(" ") || trimmed;
}

export interface ScryfallSearchResult {
  cards: OutCard[];
  totalCards: number;
  truncated: boolean;
}

export interface ScryfallSearchError {
  error: unknown;
  status: 422;
}

// Direct-syntax Scryfall search. Paginates and returns up to MAX_PAGES * 175 cards.
export async function scryfallSearch(query: string): Promise<ScryfallSearchResult | ScryfallSearchError> {
  const MAX_PAGES = 7; // 7 * 175 = up to 1225 cards
  const raw: ScryfallCard[] = [];
  let pageUrl: string | null = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec`;
  let totalCards = 0;

  for (let page = 0; page < MAX_PAGES && pageUrl; page++) {
    const res: Response = await fetch(pageUrl, { headers: SCRYFALL_HEADERS });
    if (!res.ok) {
      if (page === 0) {
        const err = await res.json().catch(() => ({}));
        return { error: err as unknown, status: 422 as const };
      }
      break;
    }
    const data = await res.json();
    raw.push(...(data.data as ScryfallCard[]));
    totalCards = data.total_cards ?? raw.length;
    if (data.has_more && data.next_page) {
      pageUrl = data.next_page as string;
      await new Promise((r) => setTimeout(r, 100));
    } else {
      pageUrl = null;
    }
  }

  return { cards: raw.map(toOutCard), totalCards, truncated: Boolean(pageUrl) };
}

// ---------------------------------------------------------------------------
// Card facts for scoring
// ---------------------------------------------------------------------------

/**
 * What CRISPI needs about a card that a PoolCard row does not store: mana
 * value as Scryfall computes it, power and toughness, keywords, the mana a
 * permanent produces, and the oracle text of BOTH faces of a double-faced or
 * adventure card (the row keeps only the front).
 */
export interface CardFacts {
  id: string;
  name: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
  manaValue: number;
  power: number | null;
  toughness: number | null;
  keywords: string[];
  producedMana: string[];
}

const parseStat = (raw: string | undefined): number | null => {
  if (raw == null) return null;
  const n = Number.parseInt(raw.replace(/[^\d-]/g, "") || "0", 10);
  return Number.isFinite(n) ? n : 0;
};

export function toCardFacts(c: ScryfallCard): CardFacts {
  const faces = c.card_faces ?? [];
  const front = faces[0];
  const oracle =
    c.oracle_text ??
    (faces.length ? faces.map((f) => f.oracle_text ?? "").filter(Boolean).join("\n//\n") : null);
  return {
    id: c.id,
    name: c.name,
    manaCost: c.mana_cost ?? front?.mana_cost ?? null,
    typeLine: c.type_line ?? front?.type_line ?? null,
    oracleText: oracle,
    manaValue: typeof c.cmc === "number" ? c.cmc : 0,
    power: parseStat(c.power ?? front?.power),
    toughness: parseStat(c.toughness ?? front?.toughness),
    keywords: Array.isArray(c.keywords) ? c.keywords : [],
    producedMana: Array.isArray(c.produced_mana) ? c.produced_mana : [],
  };
}

// Per-process, a day: a card's rules text does not change, and the same deck
// is scored on every visit to its Stats pane.
const factsCache = new Map<string, { at: number; facts: CardFacts }>();
const FACTS_TTL_MS = 24 * 60 * 60_000;

/* Test seam. */
export function resetCardFactsCache(): void {
  factsCache.clear();
}

/**
 * Bulk id → facts via /cards/collection (75 per request).
 *
 * Best-effort: an id Scryfall does not return is simply absent, and the caller
 * scores that card from the row it already holds. A whole chunk failing loses
 * only that chunk.
 */
export async function cardFactsByIds(ids: string[]): Promise<Map<string, CardFacts>> {
  const out = new Map<string, CardFacts>();
  const missing: string[] = [];
  const now = Date.now();
  for (const id of new Set(ids)) {
    const hit = factsCache.get(id);
    if (hit && now - hit.at < FACTS_TTL_MS) out.set(id, hit.facts);
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 75) {
    const chunk = missing.slice(i, i + 75);
    try {
      const res = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { ...SCRYFALL_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: chunk.map((id) => ({ id })) }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const c of (data.data ?? []) as ScryfallCard[]) {
        if (!c?.id) continue;
        const facts = toCardFacts(c);
        factsCache.set(c.id, { at: now, facts });
        out.set(c.id, facts);
      }
    } catch {
      // skip the chunk — the caller falls back to the stored row
    }
    if (i + 75 < missing.length) await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}
