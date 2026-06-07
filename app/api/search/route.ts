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

// ── EDHREC: the gold-standard source. Commander pages are reliably available as
// structured JSON at json.edhrec.com; theme/tribe pages are blocked there, so
// those are left to Claude's web_search instead.
function edhrecListRank(header: string): number {
  const h = (header ?? "").toLowerCase();
  if (h.includes("synergy")) return 3; // "High Synergy Cards" — most characteristic
  if (h.includes("top") || h.includes("signature") || h.includes("new")) return 2;
  return 1;
}

async function fetchEdhrecCommander(slug: string): Promise<string[]> {
  const clean = slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!clean) return [];
  try {
    const res = await fetch(`https://json.edhrec.com/pages/commanders/${clean}.json`, {
      headers: SCRYFALL_HEADERS,
    });
    if (!res.ok) return [];
    const data = await res.json();
    const cardlists: { header?: string; cardviews?: { name?: string }[] }[] =
      data?.container?.json_dict?.cardlists ?? [];
    const ordered = [...cardlists].sort((a, b) => edhrecListRank(b.header ?? "") - edhrecListRank(a.header ?? ""));
    const names: string[] = [];
    for (const list of ordered) {
      for (const cv of list.cardviews ?? []) {
        if (cv?.name) names.push(cv.name);
      }
    }
    return names;
  } catch {
    return [];
  }
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
  commanderSlug: string | null;
  summary: string;
  cards: string[];
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

// Ask Claude — acting as a knowledgeable MTG deckbuilder — to research real card
// recommendations from EDHREC / Moxfield / Reddit via web search, and to surface
// an EDHREC commander slug when the request maps to a specific commander.
async function aiRecommend(anthropic: Anthropic, prompt: string): Promise<AiRecommendation> {
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    system:
      "You are a deeply knowledgeable Magic: The Gathering deckbuilder. A user describes the cards they want " +
      "(a commander, a tribe, a theme, an effect, a color combination, etc.). Recommend the BEST real cards for " +
      "that request, the way an expert friend would — not a filter.\n\n" +
      "Use the web_search tool to ground your picks in real deckbuilding sources: EDHREC (edhrec.com — commander, " +
      "theme, and tribe pages are the gold standard), Moxfield decklists, and Reddit r/EDH. Search for the actual " +
      "card lists those sources recommend and pull genuine, popular, synergistic card names from them. If web " +
      "search is thin or unavailable, fall back to your own expert knowledge so you still return a strong list.\n\n" +
      "If the request clearly centers on ONE specific commander, also provide that commander's EDHREC slug " +
      "(lowercase, words joined by hyphens, no punctuation) so the app can pull the canonical EDHREC page. " +
      "Examples: 'Tom Bombadil' -> 'tom-bombadil', 'Atraxa, Praetors' Voice' -> 'atraxa-praetors-voice'. If the " +
      "request is not about a single commander, set commanderSlug to null.\n\n" +
      "Respond with ONLY a JSON object, no prose and no markdown fences, in exactly this shape:\n" +
      '{"commanderSlug": string | null, "summary": string, "cards": string[]}\n' +
      "- cards: 20-30 exact card names (English, as printed on the card).\n" +
      "- summary: one short sentence describing what you searched for and why these cards fit.",
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = extractJson(text) as Partial<AiRecommendation> | null;
  const cards = Array.isArray(parsed?.cards) ? parsed!.cards.filter((c): c is string => typeof c === "string") : [];
  return {
    commanderSlug: typeof parsed?.commanderSlug === "string" ? parsed.commanderSlug : null,
    summary: typeof parsed?.summary === "string" ? parsed.summary : "",
    cards,
  };
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

      // EDHREC commander page (gold standard) goes first; Claude's web/expert
      // picks fill in behind it.
      const edhrecNames = rec.commanderSlug ? await fetchEdhrecCommander(rec.commanderSlug) : [];

      // Dedupe names case-insensitively, preserving the EDHREC-first ordering,
      // and cap the candidate pool so a few Scryfall misses still leave us 20.
      const seenName = new Set<string>();
      const candidates: string[] = [];
      for (const name of [...edhrecNames, ...rec.cards]) {
        const key = name.toLowerCase().trim();
        if (!key || seenName.has(key)) continue;
        seenName.add(key);
        candidates.push(name);
        if (candidates.length >= 30) break;
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

      const sources: string[] = [];
      if (edhrecNames.length) sources.push(`EDHREC: ${rec.commanderSlug}`);
      sources.push("web search + expert picks");
      const query = rec.summary || `AI recommendations (${sources.join(", ")})`;

      return NextResponse.json({
        cards,
        query,
        totalCards: cards.length,
        truncated: false,
        sources,
        mode: "ai",
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
