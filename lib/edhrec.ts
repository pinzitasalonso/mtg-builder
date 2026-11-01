// EDHREC's average decks: for any commander, the cards most of its decks
// play, as one 100-card list, overall or for one power bracket. Read from
// json.edhrec.com, the JSON EDHREC's own pages load (there's no API key).
// Cached six hours, like the MTGTop8 reader.

const BASE = "https://json.edhrec.com/pages/average-decks";
const TTL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

/** EDHREC's bracket pages, by their slug. */
export const EDHREC_LEVELS = {
  exhibition: { bracket: 1, label: "Exhibition" },
  core: { bracket: 2, label: "Core" },
  upgraded: { bracket: 3, label: "Upgraded" },
  optimized: { bracket: 4, label: "Optimized" },
  cedh: { bracket: 5, label: "cEDH" },
} as const;
export type EdhrecLevel = keyof typeof EDHREC_LEVELS;

export const isEdhrecLevel = (v: unknown): v is EdhrecLevel => typeof v === "string" && v in EDHREC_LEVELS;

/** A commander's page name on EDHREC: the front face, accents and
    apostrophes dropped ("K'rrik, Son of Yawgmoth" → krrik-son-of-yawgmoth).
    Partners ("Kraum + Tymna") share one page, named in alphabetical order. */
export function edhrecSlug(commander: string): string {
  return commander
    .split("+")
    .map((name) =>
      name
        .split(" // ")[0]!
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .filter(Boolean)
    .sort()
    .join("-");
}

export interface AverageDeck {
  commanders: string[];
  /** The 99 (the commanders aren't in it). */
  cards: { name: string; quantity: number }[];
  /** How many decks it's the average of. */
  decks: number;
  /** Decks with a declared bracket, by bracket (1–5). */
  bracketCounts: Record<number, number>;
}

interface Page {
  deck?: { commander?: unknown; cards?: unknown };
  bracket_counts?: unknown;
  container?: { json_dict?: { card?: { num_decks?: unknown } } };
}

/** The page's deck, if it has one: an empty bracket comes back with no cards. */
export function parseAverageDeck(page: unknown): AverageDeck | null {
  const p = page as Page | null;
  const commanders = Array.isArray(p?.deck?.commander) ? p.deck.commander.filter((c): c is string => typeof c === "string") : [];
  const groups = p?.deck?.cards && typeof p.deck.cards === "object" ? Object.values(p.deck.cards as Record<string, unknown>) : [];
  const cards: AverageDeck["cards"] = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const row of group) {
      if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "number") continue;
      const quantity = Math.max(1, Math.min(99, Math.round(row[1])));
      cards.push({ name: row[0], quantity });
    }
  }
  const total = cards.reduce((n, c) => n + c.quantity, 0);
  if (!commanders.length || total < 80) return null;
  const bracketCounts: Record<number, number> = {};
  if (p?.bracket_counts && typeof p.bracket_counts === "object") {
    for (const [k, v] of Object.entries(p.bracket_counts as Record<string, unknown>)) {
      const b = Number(k);
      if (Number.isInteger(b) && b >= 1 && b <= 5 && typeof v === "number" && v > 0) bracketCounts[b] = v;
    }
  }
  const n = p?.container?.json_dict?.card?.num_decks;
  return { commanders, cards, decks: typeof n === "number" && n > 0 ? n : 0, bracketCounts };
}

const cache = new Map<string, { at: number; deck: AverageDeck | null }>();

/** A commander's average deck, overall (level null) or for one bracket.
    Null when EDHREC has no such deck (not a commander, or nobody has
    registered one at that level). */
export async function fetchAverageDeck(commander: string, level: EdhrecLevel | null = null): Promise<AverageDeck | null> {
  const slug = edhrecSlug(commander);
  if (!slug) return null;
  const url = `${BASE}/${slug}${level ? `/${level}` : ""}.json`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.deck;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Spellpool/1.0 (+https://www.spellpool.com)" }, signal: ctrl.signal, cache: "no-store" });
    // A missing page is a 403 or 404: remember it, it won't appear soon.
    if (res.status === 403 || res.status === 404) {
      cache.set(url, { at: Date.now(), deck: null });
      return null;
    }
    if (!res.ok) return null;
    const deck = parseAverageDeck(await res.json());
    cache.set(url, { at: Date.now(), deck });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return deck;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
