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
