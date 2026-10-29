/* MTGTop8 (mtgtop8.com): tournament results, for the assistant's
   tournament_meta tool.

   There's no API, so this reads the site's pages, the way a browser would:
   - format?f=MO is a format's metagame, each archetype's share of the top
     finishes in a period (the page offers "Last 2 Weeks", "Last 2 Months",
     …; we use two months, which is steadier than two weeks);
   - cEDH's breakdown, the most played commanders, comes from the page's
     own cEDH_decks request;
   - archetype?a=…&meta=…&f=… lists an archetype's (or a cEDH commander's)
     latest top finishes: deck, player, event, its size in stars, rank, date;
   - mtgo?d=… is one deck as a plain-text list.

   Politely: one request at a time, a short gap between them, our name in
   the User-Agent, and everything kept for six hours. The pages are
   ISO-8859-1. The parsers are pure, and tested on the markup as it is. */

export const MTGTOP8 = "https://mtgtop8.com";

/** Our format names → the site's codes. */
export const MTGTOP8_FORMATS: Record<string, { code: string; label: string }> = {
  standard: { code: "ST", label: "Standard" },
  pioneer: { code: "PI", label: "Pioneer" },
  modern: { code: "MO", label: "Modern" },
  legacy: { code: "LE", label: "Legacy" },
  vintage: { code: "VI", label: "Vintage" },
  pauper: { code: "PAU", label: "Pauper" },
  premodern: { code: "PREM", label: "Premodern" },
  cedh: { code: "cEDH", label: "cEDH" },
};

export interface Period {
  id: string;
  label: string;
}
export interface ArchetypeShare {
  id: string;
  name: string;
  /** Percent of the period's top-finishing decks. */
  share: number;
  /** Its style, where the site groups them: "aggro", "control", "combo". */
  group?: string;
}
export interface Metagame {
  decks: number | null;
  /** Aggro / control / combo …, where the site groups them. */
  groups: { label: string; share: number }[];
  archetypes: ArchetypeShare[];
}
export interface DeckRow {
  eventId: string;
  deckId: string;
  name: string;
  player: string;
  event: string;
  /** The event's size on the site's scale: 1–3 stars. */
  stars: number;
  /** "1", "2", "3-4", "5-8" … */
  rank: string;
  /** dd/mm/yy, as the site writes it. */
  date: string;
}

const clean = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** The periods a format page offers. */
export function parsePeriods(html: string): Period[] {
  const out: Period[] = [];
  for (const m of html.matchAll(/<a href="\?f=\w+&meta=(\d+)&a="><div[^>]*>([^<]+)<\/div>/g)) {
    if (!out.some((p) => p.id === m[1])) out.push({ id: m[1]!, label: clean(m[2]!) });
  }
  return out;
}

/** The period to read: two months when offered, else the page's first. */
export function pickPeriod(periods: Period[]): Period | null {
  return periods.find((p) => /^last 2 months$/i.test(p.label)) ?? periods[0] ?? null;
}

/** A constructed format's metagame, from its format page: the page lists
    archetypes under their style (aggro, then control, then combo); these
    come back biggest first, each tagged with its style. */
export function parseMetagame(html: string): Metagame {
  const decks = html.match(/class=S14 align=center[^>]*>(\d+) decks</);
  const headers = [...html.matchAll(/class=meta_arch[^>]*>\s*([A-Za-z ]+?)\s+(\d+)\s*%/g)].map((m) => ({
    at: m.index!,
    label: clean(m[1]!),
    share: Number(m[2]),
  }));
  const archetypes: ArchetypeShare[] = [];
  for (const m of html.matchAll(/<a href=archetype\?a=(\d+)&meta=\d+&f=\w+>([^<]+)<\/a><\/div>\s*<div>\s*<div[^>]*>\s*([\d.]+)\s*%/g)) {
    const group = headers.filter((h) => h.at < m.index!).at(-1)?.label.toLowerCase();
    archetypes.push({ id: m[1]!, name: clean(m[2]!), share: Number(m[3]), ...(group ? { group } : {}) });
  }
  archetypes.sort((a, b) => b.share - a.share);
  return { decks: decks ? Number(decks[1]) : null, groups: headers.map(({ label, share }) => ({ label, share })), archetypes };
}

/** cEDH's most played commanders, from the page's cEDH_decks request. The
    site gives shares per mille; these are percent. */
export function parseCedhMetagame(html: string): Metagame {
  const decks = html.match(/>(\d+) decks</);
  const archetypes: ArchetypeShare[] = [];
  for (const m of html.matchAll(/<a href=archetype\?a=(\d+)&meta=\d+&f=cEDH[^>]*>([^<]+)<\/a>[\s\S]*?class=S14 align=center>\s*([\d.]+)\s*<span[^>]*>&permil;/g)) {
    archetypes.push({ id: m[1]!, name: clean(m[2]!), share: Math.round(Number(m[3]) * 10) / 100 });
  }
  return { decks: decks ? Number(decks[1]) : null, groups: [], archetypes };
}

/** An archetype page's latest top finishes. */
export function parseDeckRows(html: string): DeckRow[] {
  const rows: DeckRow[] = [];
  const re =
    /<a href=\/event\?e=(\d+)&d=(\d+)&f=\w+>([^<]*)<\/a><\/td>\s*<td><a class=player[^>]*>([^<]*)<\/a><\/td>\s*<td><a href=\/event\?e=\d+&f=\w+>([^<]*)<\/a><\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/g;
  for (const m of html.matchAll(re)) {
    rows.push({
      eventId: m[1]!,
      deckId: m[2]!,
      name: clean(m[3]!),
      player: clean(m[4]!),
      event: clean(m[5]!),
      stars: (m[6]!.match(/star/g) ?? []).length,
      rank: clean(m[7]!),
      date: clean(m[8]!),
    });
  }
  return rows;
}

/** The best finishes first: rank, then the bigger event, then the newer. */
export function bestFinishes(rows: DeckRow[], n: number): DeckRow[] {
  const low = (rank: string) => Number(rank.split("-")[0]) || 999;
  const day = (d: string) => {
    const [dd, mm, yy] = d.split("/").map(Number);
    return (yy ?? 0) * 10000 + (mm ?? 0) * 100 + (dd ?? 0);
  };
  const seen = new Set<string>();
  return [...rows]
    .sort((a, b) => low(a.rank) - low(b.rank) || b.stars - a.stars || day(b.date) - day(a.date))
    .filter((r) => !seen.has(r.deckId) && seen.add(r.deckId))
    .slice(0, n);
}

/** The archetype a player means: exact, then one name inside the other,
    then the most words in common. */
export function findArchetype(list: ArchetypeShare[], asked: string): ArchetypeShare | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const q = norm(asked);
  if (!q) return null;
  const exact = list.find((a) => norm(a.name) === q);
  if (exact) return exact;
  const inside = list.find((a) => norm(a.name).includes(q) || q.includes(norm(a.name)));
  if (inside) return inside;
  const words = new Set(q.split(" ").filter((w) => w.length > 2));
  let best: ArchetypeShare | null = null;
  let score = 0;
  for (const a of list) {
    const s = norm(a.name).split(" ").filter((w) => words.has(w)).length;
    if (s > score) {
      best = a;
      score = s;
    }
  }
  return best;
}

// ── Fetching ────────────────────────────────────────────────────────────

const HEADERS = { "User-Agent": "Spellpool/1.0 (+https://www.spellpool.com)", Accept: "text/html,text/plain" };
const TTL_MS = 6 * 60 * 60 * 1000;
const GAP_MS = 300;
const cache = new Map<string, { at: number; text: string }>();
let queue: Promise<unknown> = Promise.resolve();

/** One page, one at a time and kept for six hours. Null on any failure. */
async function page(path: string, method: "GET" | "POST" = "GET"): Promise<string | null> {
  const key = `${method} ${path}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
  const run = queue.then(async () => {
    try {
      const res = await fetch(`${MTGTOP8}/${path}`, { method, headers: HEADERS, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const text = new TextDecoder("latin1").decode(await res.arrayBuffer());
      if (cache.size >= 200) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: Date.now(), text });
      return text;
    } catch {
      return null;
    } finally {
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  });
  queue = run.catch(() => null);
  return run;
}

/** A format's metagame over its period (two months where offered). */
export async function fetchMetagame(format: string): Promise<{ period: Period; meta: Metagame; url: string } | null> {
  const f = MTGTOP8_FORMATS[format];
  if (!f) return null;
  const front = await page(`format?f=${f.code}`);
  if (!front) return null;
  const period = pickPeriod(parsePeriods(front));
  if (!period) return null;
  const url = `${MTGTOP8}/format?f=${f.code}&meta=${period.id}`;
  if (f.code === "cEDH") {
    const html = await page(`cEDH_decks?f=cEDH&show=pop&cid=&meta=${period.id}&gamerid1=&gamerid2=&cEDH_cp=1`, "POST");
    return html ? { period, meta: parseCedhMetagame(html), url } : null;
  }
  const html = await page(`format?f=${f.code}&meta=${period.id}`);
  return html ? { period, meta: parseMetagame(html), url } : null;
}

/** An archetype's latest top finishes in a format's period. */
export async function fetchArchetypeDecks(format: string, archetypeId: string, periodId: string): Promise<DeckRow[] | null> {
  const f = MTGTOP8_FORMATS[format];
  if (!f) return null;
  const html = await page(`archetype?a=${archetypeId}&meta=${periodId}&f=${f.code}`);
  return html ? parseDeckRows(html) : null;
}

/** One deck as a plain list ("4 Lightning Bolt" lines, then "Sideboard"). */
export async function fetchDecklist(deckId: string): Promise<string | null> {
  const text = await page(`mtgo?d=${deckId}`);
  return text && /^\d+ /m.test(text) ? text.trim() : null;
}

export const deckUrl = (format: string, r: DeckRow) => `${MTGTOP8}/event?e=${r.eventId}&d=${r.deckId}&f=${MTGTOP8_FORMATS[format]?.code ?? ""}`;
