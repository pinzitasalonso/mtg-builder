import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { mapPool } from "@/lib/async";
import { currentUser } from "@/lib/auth";
import { ANON_LIMIT_MSG, anonAiAllowed } from "@/lib/ratelimit";
import { extractJson, messageText, strArr } from "@/lib/ai";
import { OutCard, naturalToScryfall, resolveNamed, scryfallSearch } from "@/lib/scryfall";

export const runtime = "nodejs";

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

// Snapshot of the caller's current deck sent with the search request so Claude
// can avoid suggesting duplicates and spot synergies / missing combo pieces.
interface DeckContext {
  cards: { name: string; manaCost: string | null; typeLine: string | null }[];
  commander: string | null;
}

interface AlmostCombo {
  cards: string[];
  missing: string[];
  produces: string[];
}

// Calls Commander Spellbook directly from the server to find combos that are
// one card away from being complete. Returns at most MAX_ALMOST results.
// Silently returns [] on any failure — this is best-effort context.
async function fetchAlmostCombos(ctx: DeckContext): Promise<AlmostCombo[]> {
  if (ctx.cards.length === 0) return [];
  const MAX_ALMOST = 10;
  try {
    const names = ctx.cards.map((c) => c.name).slice(0, 500);
    const commanders = ctx.commander ? [ctx.commander] : [];
    const res = await fetch("https://backend.commanderspellbook.com/find-my-combos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        main: names.map((card) => ({ card, quantity: 1 })),
        commanders: commanders.map((card) => ({ card, quantity: 1 })),
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const owned = new Set([...names, ...commanders].map((n) => n.toLowerCase()));
    const almost: { uses?: { card?: { name?: string } }[]; produces?: { feature?: { name?: string } }[] }[] =
      data?.results?.almostIncluded ?? [];
    return almost.slice(0, MAX_ALMOST).map((c) => {
      const cards = (c.uses ?? []).map((u) => u.card?.name).filter((n): n is string => Boolean(n));
      return {
        cards,
        missing: cards.filter((n) => !owned.has(n.toLowerCase())),
        produces: (c.produces ?? []).map((p) => p.feature?.name).filter((n): n is string => Boolean(n)),
      };
    });
  } catch {
    return [];
  }
}

// Raw card-name pools gathered from each community source in step 2.
interface SourceData {
  edhrec: string[];
  reddit: string[];
  moxfield: string[];
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
    const parsed = extractJson(messageText(msg)) as Partial<Intent> | null;
    if (!parsed) return empty;
    return {
      commander:
        typeof parsed.commander === "string" && parsed.commander.trim() ? parsed.commander.trim() : null,
      themes: strArr(parsed.themes),
      colors: strArr(parsed.colors),
      types: strArr(parsed.types),
      mechanics: strArr(parsed.mechanics),
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
// to its own MTG knowledge. When deck context is available, Claude uses it to
// avoid duplicates, surface synergies, and prioritize combo-completing cards.
async function synthesize(
  anthropic: Anthropic,
  prompt: string,
  data: SourceData,
  deckCtx: DeckContext,
  almostCombos: AlmostCombo[]
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

  // Deck context block — only appended when caller sent pool data.
  let deckBlock = "";
  if (deckCtx.cards.length > 0 || deckCtx.commander) {
    const commanderLine = deckCtx.commander ? `COMMANDER: ${deckCtx.commander}\n` : "";
    const cardLines = deckCtx.cards
      .map((c) => `  ${c.name}${c.typeLine ? ` (${c.typeLine})` : ""}`)
      .join("\n");
    deckBlock =
      "\n\nCURRENT DECK COMPOSITION — these cards are ALREADY in the player's pool. " +
      "Do NOT suggest any of them. Use this list to understand the deck's strategy, mana curve, " +
      "and synergies so your suggestions complement what's already built:\n" +
      commanderLine +
      `${deckCtx.cards.length} cards:\n${cardLines}`;
  }

  // Combo context — only appended when Spellbook found near-complete combos.
  let comboBlock = "";
  if (almostCombos.length > 0) {
    const lines = almostCombos.map((c) =>
      `  Missing: ${c.missing.join(", ")} | Full combo: ${c.cards.join(" + ")} → ${c.produces.join(", ")}`
    );
    comboBlock =
      "\n\nALMOST-COMPLETE COMBOS — Commander Spellbook found these combos where the player has all " +
      "pieces EXCEPT the listed missing card(s). If any missing card also satisfies the user's request, " +
      "strongly prefer it and mention the combo in your summary:\n" +
      lines.join("\n");
  }

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system:
      "You are a world-class Magic: The Gathering deckbuilding expert acting as a ranker over community data. " +
      "The user describes the cards they want — possibly multi-faceted (color + type + mechanic + theme + " +
      "commander + budget). Pick the BEST 15-20 real cards that satisfy ALL of those constraints together.\n\n" +
      sourceBlock +
      deckBlock +
      comboBlock +
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

// Deterministic multi-source pipeline: analyze the prompt → fetch EDHREC, Reddit,
// Moxfield, and Commander Spellbook combos in parallel → let Claude rank/filter
// over the real data with full awareness of the current deck → resolve names on
// Scryfall (done by the caller). Every source degrades gracefully; if all come
// back empty, synthesis falls back to Claude's own knowledge.
async function aiRecommend(
  anthropic: Anthropic,
  prompt: string,
  deckCtx: DeckContext
): Promise<AiRecommendation> {
  // Step 1 — structured intent (use commander from deck context as a hint if present).
  const intentPrompt =
    deckCtx.commander ? `${prompt} (commander: ${deckCtx.commander})` : prompt;
  const intent = await analyzeIntent(anthropic, intentPrompt);
  if (!intent.commander && deckCtx.commander) intent.commander = deckCtx.commander;

  // Step 2 — every source in parallel; a thrown source becomes an empty list.
  // Also fetch almost-complete combos from Commander Spellbook in the same wave.
  const [edhrec, reddit, moxfield, almostCombos] = await Promise.all([
    fetchEdhrec(intent).catch(() => [] as string[]),
    fetchReddit(prompt).catch(() => [] as string[]),
    fetchMoxfield(intent, prompt).catch(() => [] as string[]),
    fetchAlmostCombos(deckCtx).catch(() => [] as AlmostCombo[]),
  ]);

  const data: SourceData = { edhrec, reddit, moxfield };
  const sources: string[] = [];
  if (edhrec.length) sources.push("EDHREC");
  if (reddit.length) sources.push("Reddit");
  if (moxfield.length) sources.push("Moxfield");

  // Step 3 — synthesize/rank over the gathered data with deck context.
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

  // Build deck context from the caller's current pool (best-effort; no error if absent).
  const deckCtx: DeckContext = {
    commander: typeof currentDeck?.commander === "string" ? currentDeck.commander : null,
    cards: Array.isArray(currentDeck?.cards)
      ? (currentDeck.cards as { name?: unknown; manaCost?: unknown; typeLine?: unknown }[])
          .filter((c) => typeof c?.name === "string" && c.name)
          .map((c) => ({
            name: c.name as string,
            manaCost: typeof c.manaCost === "string" ? c.manaCost : null,
            typeLine: typeof c.typeLine === "string" ? c.typeLine : null,
          }))
          .slice(0, 500)
      : [],
  };

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
