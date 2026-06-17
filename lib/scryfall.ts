// Shared Scryfall types + helpers. Isomorphic: plain `fetch`, usable from route
// handlers and client components alike (browsers silently drop the User-Agent
// header, which is fine).

export interface ScryfallCard {
  id: string;
  name: string;
  image_uris?: { normal?: string; large?: string };
  card_faces?: { image_uris?: { normal?: string; large?: string } }[];
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  color_identity?: string[];
  legalities?: Record<string, string>;
  set?: string;
  collector_number?: string;
  digital?: boolean;
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

// Bulk name → card lookup via /cards/collection (75 identifiers per request).
// Returns a lowercase-name → OutCard map; names that don't resolve are absent.
export async function collectionByName(names: string[]): Promise<Map<string, OutCard>> {
  const out = new Map<string, OutCard>();
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
        if (c?.id) out.set(c.name.toLowerCase(), toOutCard(c));
      }
    } catch {
      // skip the chunk — callers treat missing entries as unresolved
    }
    if (i + 75 < names.length) await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}

// Resolve a loose card name to a full card object. Returns null when the name
// doesn't resolve (typo, double-faced quirk, not a real card) so the caller can
// simply skip it.
export async function resolveNamed(name: string): Promise<OutCard | null> {
  try {
    const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`, {
      headers: SCRYFALL_HEADERS,
    });
    if (!res.ok) return null;
    const c = (await res.json()) as ScryfallCard;
    if (!c?.id) return null;
    return toOutCard(c);
  } catch {
    return null;
  }
}

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
