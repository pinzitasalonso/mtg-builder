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

// Make Claude the reasoning engine. It interprets the (possibly multi-faceted)
// request, leans on its own deep MTG knowledge, and uses web search whenever a
// lookup would help — EDHREC, Scryfall, Moxfield, Reddit, anything. It is NOT
// locked to a single source or page. The output is 15-20 specific, real card
// names that genuinely satisfy ALL the constraints in the prompt.
async function aiRecommend(anthropic: Anthropic, prompt: string): Promise<AiRecommendation> {
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 6000,
    thinking: { type: "enabled", budget_tokens: 3000 },
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    system:
      "You are a world-class Magic: The Gathering deckbuilding expert. A user describes the cards they want in " +
      "natural language. The request may be simple ('blue wizards that draw cards') or multi-faceted and " +
      "cross-cutting ('white cards that play well with Sagas and have a villain theme', 'budget black zombies " +
      "that regenerate for a Wilhelt deck'). Your job is to recommend the BEST real cards that genuinely satisfy " +
      "EVERY constraint in the request — the way an expert friend would, not a keyword filter.\n\n" +
      "How to think:\n" +
      "1. Break the prompt into its distinct constraints (color, type, mechanic, theme/flavor, commander, format, " +
      "budget, etc.). A good answer must satisfy ALL of them together, not just one.\n" +
      "2. Reason from your own MTG knowledge first — you know the card pool deeply. For the example 'white Sagas " +
      "with a villain theme', you'd think: white Saga cards (Enchanting Tales reprints, Eldraine/March of the " +
      "Machine sagas), villain-flavored white cards, sets with villain themes (Eldraine, LOTR, Wilds of Eldraine), " +
      "then narrow to cards that hit both the mechanical and flavor angles.\n" +
      "3. Use the web_search tool whenever a lookup would sharpen your picks — verify a card exists, find what " +
      "EDHREC/Moxfield/Reddit recommend for a commander or theme, confirm a card's color or text, or discover " +
      "cards you don't recall. Search multiple angles for multi-faceted prompts. You are free to pull from any " +
      "source; you are not required to use any particular one.\n" +
      "4. Prefer specific, real, playable cards that are well-regarded for the request. Avoid off-theme filler.\n\n" +
      "After reasoning, respond with ONLY a JSON object — no prose, no markdown fences — in exactly this shape:\n" +
      '{"summary": string, "cards": string[]}\n' +
      "- cards: 15-20 exact card names (English, as printed on the card). Real cards only.\n" +
      "- summary: one short sentence describing how you interpreted the request and why these cards fit.",
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = extractJson(text) as Partial<AiRecommendation> | null;
  const cards = Array.isArray(parsed?.cards) ? parsed!.cards.filter((c): c is string => typeof c === "string") : [];
  return {
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
