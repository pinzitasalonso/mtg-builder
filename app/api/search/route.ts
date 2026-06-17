import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { mapPool } from "@/lib/async";
import { currentUser } from "@/lib/auth";
import { ANON_LIMIT_MSG, anonAiAllowed } from "@/lib/ratelimit";
import { extractJson, messageText, strArr } from "@/lib/ai";
import { OutCard, naturalToScryfall, resolveNamed, scryfallSearch } from "@/lib/scryfall";
import {
  AlmostCombo,
  DeckContext,
  SourceData,
  buildComboBlock,
  buildDeckBlock,
  buildSourceBlock,
  gatherContext,
  parseDeckContext,
} from "@/lib/research";

export const runtime = "nodejs";

interface AiRecommendation {
  summary: string;
  cards: string[];
  sources: string[];
}

// ── Claude synthesizes. Given the raw card pools from every source, it picks the
// 15-20 that satisfy EVERY constraint in the original prompt, acting as the
// ranker/filter over real community data. With no source data it falls back to
// its own MTG knowledge. Deck and combo context steer it away from duplicates and
// toward combo-completing cards.
async function synthesize(
  anthropic: Anthropic,
  prompt: string,
  data: SourceData,
  deckCtx: DeckContext,
  almostCombos: AlmostCombo[]
): Promise<{ summary: string; cards: string[] }> {
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system:
      "You are a world-class Magic: The Gathering deckbuilding expert acting as a ranker over community data. " +
      "The user describes the cards they want — possibly multi-faceted (color + type + mechanic + theme + " +
      "commander + budget). Pick the BEST 15-20 real cards that satisfy ALL of those constraints together.\n\n" +
      buildSourceBlock(data) +
      buildDeckBlock(deckCtx) +
      buildComboBlock(almostCombos) +
      "\n\nRespond with ONLY a JSON object — no prose, no markdown fences — in exactly this shape:\n" +
      '{"summary": string, "cards": string[]}\n' +
      "- cards: 15-20 exact English card names as printed on the card. Real cards only. Order best-first.\n" +
      "- summary: one short sentence on how you interpreted the request and why these cards fit. " +
      "If a combo-completing card is included, mention it briefly.",
    messages: [{ role: "user", content: prompt }],
  });

  const parsed = extractJson(messageText(msg)) as Partial<AiRecommendation> | null;
  return { summary: typeof parsed?.summary === "string" ? parsed.summary : "", cards: strArr(parsed?.cards) };
}

// Deterministic multi-source pipeline: gather EDHREC/Reddit/Moxfield/Spellbook
// context → let Claude rank/filter over the real data with full awareness of the
// current deck → resolve names on Scryfall (done by the caller).
async function aiRecommend(
  anthropic: Anthropic,
  prompt: string,
  deckCtx: DeckContext
): Promise<AiRecommendation> {
  const { data, sources, almostCombos } = await gatherContext(anthropic, prompt, deckCtx);
  const rec = await synthesize(anthropic, prompt, data, deckCtx, almostCombos);
  return { ...rec, sources };
}

export async function POST(req: Request) {
  // Publicly deployed: anonymous visitors may search, but they share one
  // small per-minute AI budget so drive-bys can't burn the Anthropic key.
  if (!(await currentUser()) && !anonAiAllowed()) {
    return NextResponse.json({ error: ANON_LIMIT_MSG }, { status: 429 });
  }
  const { prompt, filters, mode, currentDeck } = await req.json();
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }
  if (prompt.length > 1000) {
    return NextResponse.json({ error: "prompt too long (max 1000 characters)" }, { status: 400 });
  }

  const deckCtx = parseDeckContext(currentDeck);
  const filterTerms = strArr(filters);
  const useAi = mode !== "scryfall" && Boolean(process.env.ANTHROPIC_API_KEY);

  // ─────────────────────────────────────────────────────────────────────────
  // AI mode: research real recommendations, then resolve them on Scryfall.
  // ─────────────────────────────────────────────────────────────────────────
  if (useAi) {
    try {
      const anthropic = new Anthropic();
      const rec = await aiRecommend(anthropic, prompt, deckCtx);

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
  // Scryfall mode: treat the prompt as Scryfall syntax. Real syntax passes
  // through untouched; plain English ("1 mana blue creatures") is mapped to the
  // equivalent tokens so the box still finds cards instead of 404-ing.
  // ─────────────────────────────────────────────────────────────────────────
  let query = naturalToScryfall(prompt.trim());
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
