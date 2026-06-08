import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

interface ScryfallCard {
  id: string;
  name: string;
  image_uris?: { normal?: string; large?: string };
  card_faces?: { image_uris?: { normal?: string; large?: string } }[];
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
}

interface OutCard {
  id: string;
  name: string;
  imageUri: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
}

const SCRYFALL_HEADERS = { "User-Agent": "mtg-builder/1.0", Accept: "application/json" };

function toOutCard(c: ScryfallCard): OutCard {
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
  };
}

// Run `fn` over `items` with bounded concurrency, preserving order.
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ── Scryfall: resolve a loose card name to a full card object. Returns null when
// the name doesn't resolve (typo, double-faced quirk, not a real card) so the
// caller can simply skip it.
async function resolveNamed(name: string): Promise<OutCard | null> {
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

interface AiRecommendation {
  summary: string;
  cards: string[];
  sources: string[];
}

// Structured intent extracted from the user's natural-language prompt in step 1.
// Drives which community endpoints we hit in step 2.
interface Intent {
  commander: string | null;
  themes: string[];
  colors: string[];
  types: string[];
  mechanics: string[];
}

// Raw card-name pools gathered from each community source in step 2.
interface SourceData {
  edhrec: string[];
  reddit: string[];
  moxfield: string[];
}

// Pull a JSON object out of an LLM text response that may be wrapped in prose or
// ```json fences.
function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text].filter(Boolean) as string[];
  for (const c of candidates) {
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch {
      // try next candidate
    }
  }
  return null;
}

// ── Generic safe JSON fetch with a hard timeout. Returns null on ANY failure
// (404, network error, timeout, non-JSON body) so a dead source is simply
// skipped rather than failing the whole request. `cache: "no-store"` keeps the
// community data fresh — POST route handlers aren't memoized, but we're explicit.
async function fetchJsonSafe<T = unknown>(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<T | null> {
  const { headers, timeoutMs = 6000 } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// EDHREC / generic slug: "Tom Bombadil" -> "tom-bombadil", "Sagas" -> "sagas".
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Step 1: Claude reads the prompt and extracts structured intent. Quick, cheap,
// no tools. Failures degrade to an empty intent (sources then run on the raw
// prompt where they can).
async function analyzeIntent(anthropic: Anthropic, prompt: string): Promise<Intent> {
  const empty: Intent = { commander: null, themes: [], colors: [], types: [], mechanics: [] };
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system:
        "You extract structured search intent from a Magic: The Gathering card request. " +
        "Respond with ONLY a JSON object — no prose, no markdown fences — in exactly this shape:\n" +
        '{"commander": string|null, "themes": string[], "colors": string[], "types": string[], "mechanics": string[]}\n' +
        '- commander: exact name of a commander/legendary creature if the request names or clearly implies one, else null.\n' +
        '- themes: archetype/strategy/flavor tags, lowercase (e.g. "sagas", "enchantments", "aristocrats", "villains").\n' +
        '- colors: WUBRG letters the request implies, lowercase (e.g. ["w","g"]). Empty if unspecified.\n' +
        '- types: card types mentioned, lowercase (e.g. "enchantment", "creature", "instant").\n' +
        '- mechanics: keywords/mechanics mentioned, lowercase (e.g. "regenerate", "lifegain", "proliferate").\n' +
        "Infer reasonably, but do not invent constraints the user didn't ask for.",
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const parsed = extractJson(text) as Partial<Intent> | null;
    if (!parsed) return empty;
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
    return {
      commander:
        typeof parsed.commander === "string" && parsed.commander.trim() ? parsed.commander.trim() : null,
      themes: arr(parsed.themes),
      colors: arr(parsed.colors),
      types: arr(parsed.types),
      mechanics: arr(parsed.mechanics),
    };
  } catch {
    return empty;
  }
}

// EDHREC's json.edhrec.com pages nest card objects under `cardviews` arrays at
// varying depths. Walk the whole tree and collect the `name` of anything that
// looks like a card view (carries EDHREC's card-ish metadata).
function collectEdhrecNames(node: unknown, out: Set<string>, max: number): void {
  if (out.size >= max || node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectEdhrecNames(item, out, max);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (
    typeof obj.name === "string" &&
    ("sanitized" in obj || "num_decks" in obj || "inclusion" in obj || "potential_decks" in obj)
  ) {
    out.add(obj.name);
  }
  for (const v of Object.values(obj)) collectEdhrecNames(v, out, max);
}

// ── Step 2a — EDHREC. Hits the commander page (if any) and up to a few theme
// pages, in parallel. Each missing page just contributes nothing.
async function fetchEdhrec(intent: Intent): Promise<string[]> {
  const urls: string[] = [];
  if (intent.commander) {
    urls.push(`https://json.edhrec.com/pages/commanders/${slugify(intent.commander)}.json`);
  }
  for (const theme of intent.themes.slice(0, 3)) {
    const slug = slugify(theme);
    if (slug) urls.push(`https://json.edhrec.com/pages/themes/${slug}.json`);
  }
  if (urls.length === 0) return [];

  const names = new Set<string>();
  await Promise.all(
    urls.map(async (url) => {
      const data = await fetchJsonSafe(url, { headers: { "User-Agent": "mtg-builder/1.0" } });
      if (data) collectEdhrecNames(data, names, 250);
    })
  );
  return [...names].slice(0, 80);
}

interface RedditListing {
  data?: { children?: { data?: { title?: string; selftext?: string } }[] };
}

// ── Step 2b — Reddit. Searches r/EDH and r/magicTCG and pulls card names out of
// the [[Card Name]] bracket syntax the communities use to tag cards.
async function fetchReddit(prompt: string): Promise<string[]> {
  const q = encodeURIComponent(prompt);
  const headers = { "User-Agent": "mtg-builder/1.0 (deck recommender)" };
  const names = new Set<string>();
  await Promise.all(
    ["EDH", "magicTCG"].map(async (sub) => {
      const url = `https://www.reddit.com/r/${sub}/search.json?q=${q}&restrict_sr=1&sort=relevance&limit=5`;
      const data = await fetchJsonSafe<RedditListing>(url, { headers });
      for (const child of data?.data?.children ?? []) {
        const text = `${child.data?.title ?? ""}\n${child.data?.selftext ?? ""}`;
        for (const m of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
          const n = m[1].split("|")[0].trim();
          if (n) names.add(n);
        }
      }
    })
  );
  return [...names].slice(0, 60);
}

interface MoxSearchResp {
  data?: { publicId?: string }[];
}
interface MoxDeck {
  boards?: Record<string, { cards?: Record<string, { card?: { name?: string } }> }>;
}

// ── Step 2c — Moxfield. Finds popular decks matching the theme/commander, then
// reads the card lists of the top few. Moxfield sits behind Cloudflare and may
// block server requests entirely — that just yields no cards, which is fine.
async function fetchMoxfield(intent: Intent, prompt: string): Promise<string[]> {
  const headers = { "User-Agent": "mtg-builder/1.0", Accept: "application/json" };
  const query = encodeURIComponent(intent.commander || intent.themes.join(" ") || prompt);
  const search = await fetchJsonSafe<MoxSearchResp>(
    `https://api2.moxfield.com/v3/decks/search?q=${query}&pageSize=5&sortType=updated`,
    { headers }
  );
  const ids = (search?.data ?? [])
    .map((d) => d.publicId)
    .filter((id): id is string => Boolean(id))
    .slice(0, 3);
  if (ids.length === 0) return [];

  const names = new Set<string>();
  await Promise.all(
    ids.map(async (id) => {
      const deck = await fetchJsonSafe<MoxDeck>(`https://api2.moxfield.com/v3/decks/all/${id}`, { headers });
      for (const board of Object.values(deck?.boards ?? {})) {
        for (const entry of Object.values(board.cards ?? {})) {
          const n = entry.card?.name;
          if (typeof n === "string" && n) names.add(n);
        }
      }
    })
  );
  return [...names].slice(0, 100);
}

// ── Step 3 — Claude synthesizes. Given the raw card pools from every source, it
// picks the 15-20 that satisfy EVERY constraint in the original prompt, acting as
// the ranker/filter over real community data. With no source data it falls back
// to its own MTG knowledge.
async function synthesize(
  anthropic: Anthropic,
  prompt: string,
  data: SourceData
): Promise<{ summary: string; cards: string[] }> {
  const total = data.edhrec.length + data.reddit.length + data.moxfield.length;
  const sourceBlock =
    total > 0
      ? "Below are candidate card names gathered from real Magic community sources. Treat them as your primary " +
        "evidence — they reflect what real decks and players actually run — but YOU are the filter: keep a card " +
        "only if it genuinely satisfies EVERY constraint in the request, and discard off-theme noise. You may add a " +
        "few obvious staples from your own knowledge if they're missing, but prefer the sourced cards.\n\n" +
        `EDHREC (${data.edhrec.length}): ${data.edhrec.join(", ") || "—"}\n\n` +
        `Reddit (${data.reddit.length}): ${data.reddit.join(", ") || "—"}\n\n` +
        `Moxfield (${data.moxfield.length}): ${data.moxfield.join(", ") || "—"}`
      : "No community data could be retrieved for this request. Fall back entirely on your own expert Magic " +
        "knowledge to pick cards that satisfy EVERY constraint in the request.";

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system:
      "You are a world-class Magic: The Gathering deckbuilding expert acting as a ranker over community data. " +
      "The user describes the cards they want — possibly multi-faceted (color + type + mechanic + theme + " +
      "commander + budget). Pick the BEST 15-20 real cards that satisfy ALL of those constraints together.\n\n" +
      sourceBlock +
      "\n\nRespond with ONLY a JSON object — no prose, no markdown fences — in exactly this shape:\n" +
      '{"summary": string, "cards": string[]}\n' +
      "- cards: 15-20 exact English card names as printed on the card. Real cards only. Order best-first.\n" +
      "- summary: one short sentence on how you interpreted the request and why these cards fit.",
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const parsed = extractJson(text) as Partial<AiRecommendation> | null;
  const cards = Array.isArray(parsed?.cards) ? parsed!.cards.filter((c): c is string => typeof c === "string") : [];
  return { summary: typeof parsed?.summary === "string" ? parsed.summary : "", cards };
}

// Deterministic multi-source pipeline: analyze the prompt → fetch EDHREC, Reddit
// and Moxfield in parallel → let Claude rank/filter over the real data → resolve
// names on Scryfall (done by the caller). Every source degrades gracefully; if
// all come back empty, synthesis falls back to Claude's own knowledge.
async function aiRecommend(anthropic: Anthropic, prompt: string): Promise<AiRecommendation> {
  // Step 1 — structured intent.
  const intent = await analyzeIntent(anthropic, prompt);

  // Step 2 — every source in parallel; a thrown source becomes an empty list.
  const [edhrec, reddit, moxfield] = await Promise.all([
    fetchEdhrec(intent).catch(() => [] as string[]),
    fetchReddit(prompt).catch(() => [] as string[]),
    fetchMoxfield(intent, prompt).catch(() => [] as string[]),
  ]);

  const data: SourceData = { edhrec, reddit, moxfield };
  const sources: string[] = [];
  if (edhrec.length) sources.push("EDHREC");
  if (reddit.length) sources.push("Reddit");
  if (moxfield.length) sources.push("Moxfield");

  // Step 3 — synthesize/rank over the gathered data.
  const rec = await synthesize(anthropic, prompt, data);
  return { ...rec, sources };
}

// ── Scryfall direct-syntax search (unchanged behavior). Paginates and returns up
// to MAX_PAGES * 175 cards.
async function scryfallSearch(query: string) {
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

export async function POST(req: Request) {
  const { prompt, filters, mode } = await req.json();
  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  const filterTerms: string[] = Array.isArray(filters) ? filters : [];
  const useAi = mode !== "scryfall" && Boolean(process.env.ANTHROPIC_API_KEY);

  // ─────────────────────────────────────────────────────────────────────────
  // AI mode: research real recommendations, then resolve them on Scryfall.
  // ─────────────────────────────────────────────────────────────────────────
  if (useAi) {
    try {
      const anthropic = new Anthropic();
      const rec = await aiRecommend(anthropic, prompt);

      // Dedupe the names Claude recommended (case-insensitive), preserving its
      // ordering. Resolve a few extra so Scryfall misses still leave us ~20.
      const seenName = new Set<string>();
      const candidates: string[] = [];
      for (const name of rec.cards) {
        const key = name.toLowerCase().trim();
        if (!key || seenName.has(key)) continue;
        seenName.add(key);
        candidates.push(name);
        if (candidates.length >= 25) break;
      }

      const resolved = await mapPool(candidates, 6, resolveNamed);

      // Skip unresolved names and dedupe by Scryfall id, cap at 20.
      const seenId = new Set<string>();
      const cards: OutCard[] = [];
      for (const c of resolved) {
        if (!c || seenId.has(c.id)) continue;
        seenId.add(c.id);
        cards.push(c);
        if (cards.length >= 20) break;
      }

      const query = rec.summary || "AI recommendations";

      return NextResponse.json({
        cards,
        query,
        totalCards: cards.length,
        truncated: false,
        mode: "ai",
        sources: rec.sources,
      });
    } catch (e) {
      // If the AI/research path fails outright, fall through to a plain Scryfall
      // search of the raw prompt rather than erroring the whole request.
      const detail = e instanceof Error ? e.message : String(e);
      const fallback = await scryfallSearch(prompt.trim());
      if ("error" in fallback) {
        return NextResponse.json(
          { error: "AI search failed", details: detail },
          { status: 502 }
        );
      }
      return NextResponse.json({ ...fallback, query: prompt.trim(), mode: "scryfall-fallback" });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scryfall mode: treat the prompt as direct Scryfall syntax (unchanged).
  // ─────────────────────────────────────────────────────────────────────────
  let query = prompt.trim();
  if (filterTerms.length > 0) query = [query, ...filterTerms].join(" ");

  const result = await scryfallSearch(query);
  if ("error" in result) {
    return NextResponse.json(
      { error: "Scryfall search failed", details: result.error, query },
      { status: result.status }
    );
  }
  return NextResponse.json({ ...result, query, mode: "scryfall" });
}
