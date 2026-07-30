// Shared community-data + combo research pipeline. Given a natural-language
// prompt and the caller's current deck, it asks Claude for structured intent,
// then gathers candidate cards from EDHREC / Reddit / Moxfield and near-complete
// combos from Commander Spellbook — all in parallel, all best-effort (a dead
// source simply contributes nothing). Used by both the AI search and the
// conversational chat routes to ground Claude's answers in real decks.

import type Anthropic from "@anthropic-ai/sdk";
import { extractJson, messageText, strArr } from "./ai";

// Structured intent extracted from the user's prompt. Drives which community
// endpoints we hit.
export interface Intent {
  commander: string | null;
  themes: string[];
  colors: string[];
  types: string[];
  mechanics: string[];
  /// Whether answering needs a list of CANDIDATE CARDS at all.
  ///
  /// "What does Sol Ring do?" and "how do I pilot this?" don't — but they were
  /// still paying for an EDHREC page, a Moxfield search, a Reddit fetch and a
  /// combo lookup before a single byte could move. False skips all four.
  /// Defaults true everywhere it can't be determined, so the fallback is
  /// today's behaviour rather than an unresearched answer.
  needsCards: boolean;
}

// Snapshot of the caller's current deck so Claude can avoid suggesting
// duplicates, spot synergies, and find missing combo pieces.
export interface DeckContext {
  cards: { name: string; manaCost: string | null; typeLine: string | null; quantity: number }[];
  commander: string | null;
}

// Raw card-name pools gathered from each community source.
export interface SourceData {
  edhrec: string[];
  reddit: string[];
  moxfield: string[];
}

export interface AlmostCombo {
  cards: string[];
  missing: string[];
  produces: string[];
}

// Everything gatherContext returns: the raw pools, which sources had hits, and
// the near-complete combos.
export interface ResearchContext {
  data: SourceData;
  sources: string[];
  almostCombos: AlmostCombo[];
  /// Whether the community fetches actually ran, as opposed to being skipped
  /// because the ask needed no cards.
  ///
  /// Reported so latency can be diagnosed from OUTSIDE the server. The route
  /// puts it in a response header, which is the only way to tell a skip from a
  /// slow fetch without Railway's logs — and not having that is what turned the
  /// last round of tuning into guesswork.
  researched: boolean;
}

// ── The research memo, keyed on the URL.
//
// A chat conversation re-ran this whole pipeline on every follow-up turn to
// rebuild grounding that had barely moved. The commander's EDHREC page and the
// Moxfield search are the same request on turn 4 as on turn 1, so paying for
// them four times was pure waste.
//
// The key is the URL, deliberately, because the URL is what the answer actually
// depends on. Memoising per COMMANDER instead would look equivalent and isn't:
// EDHREC is also queried for theme pages, and the themes come from the intent
// call reading the player's message. A commander key would let turn 1's "what
// removal should I add?" pin a removal-flavoured pool and then serve it to turn
// 2's "what about card draw?" — and, since the memo is shared, to every other
// player on that commander for the next ten minutes. Keying on the URL cannot
// do that: a different question producing different themes is a different URL,
// and so a different entry.
//
// Reddit falls out of it for free. Its URL embeds the raw prompt, so it misses
// on every new question, which is exactly right for the source whose whole job
// is tracking what was just asked. Spellbook doesn't come through here at all
// (it's a POST), so combos stay live against a deck the player can edit
// mid-conversation.
//
// Per-process, like lib/ratelimit: right on one long-lived Railway instance,
// and a miss on a second costs only what every call used to cost.
const RESEARCH_TTL_MS = 10 * 60_000;
const MAX_RESEARCH_ENTRIES = 300;

const researchMemo = new Map<string, { at: number; value: unknown }>();

/* Test seam: drop everything memoised. */
export function resetResearchMemo(): void {
  researchMemo.clear();
}

// ── Generic safe JSON fetch with a hard timeout. Returns null on ANY failure
// (404, network error, timeout, non-JSON body) so a dead source is simply
// skipped rather than failing the whole request.
async function fetchJsonSafe<T = unknown>(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<T | null> {
  const hit = researchMemo.get(url);
  if (hit) {
    if (Date.now() - hit.at <= RESEARCH_TTL_MS) return hit.value as T;
    researchMemo.delete(url);
  }

  const { headers, timeoutMs = 6000 } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as T;
    // Only a real answer is stored. Caching a failure would pin a source
    // outage in place for ten minutes instead of retrying past a blip — which
    // is why the two `return null` paths here skip the write entirely.
    //
    // Insertion-ordered Map + delete-before-set makes this an LRU: re-writing
    // a live key moves it to the back, so eviction drops the coldest.
    researchMemo.delete(url);
    researchMemo.set(url, { at: Date.now(), value: body });
    while (researchMemo.size > MAX_RESEARCH_ENTRIES) {
      const oldest = researchMemo.keys().next();
      if (oldest.done) break;
      researchMemo.delete(oldest.value);
    }
    return body;
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
export async function analyzeIntent(anthropic: Anthropic, prompt: string): Promise<Intent> {
  const empty: Intent = {
    commander: null, themes: [], colors: [], types: [], mechanics: [], needsCards: true,
  };
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system:
        "You extract structured search intent from a Magic: The Gathering card request. " +
        "Respond with ONLY a JSON object — no prose, no markdown fences — in exactly this shape:\n" +
        '{"commander": string|null, "themes": string[], "colors": string[], "types": string[], "mechanics": string[], "needsCards": boolean}\n' +
        '- commander: exact name of a commander/legendary creature if the request names or clearly implies one, else null.\n' +
        '- needsCards: true if answering means SUGGESTING OR FINDING CARDS (build, improve, tune, "what should I add", "what fits"). ' +
        'false for questions answered from knowledge alone: what a card does, a rules or interaction question, how to pilot a deck, ' +
        'general strategy or theory. When unsure, true.\n' +
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
      // Only an explicit false skips the research. A missing or malformed
      // field leaves the answer grounded, which is the safer way to be wrong.
      needsCards: parsed.needsCards !== false,
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

// Calls Commander Spellbook directly from the server to find combos that are
// one card away from being complete. Returns at most MAX_ALMOST results.
// Silently returns [] on any failure — this is best-effort context.
export async function fetchAlmostCombos(ctx: DeckContext): Promise<AlmostCombo[]> {
  if (ctx.cards.length === 0) return [];
  const MAX_ALMOST = 10;
  try {
    const main = ctx.cards.slice(0, 500).map((c) => ({ card: c.name, quantity: Math.max(1, c.quantity) }));
    const commanders = ctx.commander ? [ctx.commander] : [];
    const res = await fetch("https://backend.commanderspellbook.com/find-my-combos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        main,
        commanders: commanders.map((card) => ({ card, quantity: 1 })),
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const owned = new Set([...main.map((m) => m.card), ...commanders].map((n) => n.toLowerCase()));
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

// ── The whole pipeline: intent, then the sources that read it, alongside the
// two that don't. Every source degrades gracefully; if all come back empty,
// callers fall back to Claude's own knowledge.
//
// Reddit and the combo lookup used to sit behind the intent call even though
// neither reads the intent, so this is a latency win too: nothing waits on
// Haiku now except the two sources that actually need what it returns.
//
// Repeat cost is handled a layer down, in fetchJsonSafe's URL memo — see the
// note there for why the key is the URL and not the commander.
export async function gatherContext(
  anthropic: Anthropic,
  prompt: string,
  deckCtx: DeckContext
): Promise<ResearchContext> {
  // Reddit and the combos start immediately; only EDHREC and Moxfield wait on
  // the intent call, because only they read what it returns.
  const redditP = fetchReddit(prompt).catch(() => [] as string[]);
  const combosP = fetchAlmostCombos(deckCtx).catch(() => [] as AlmostCombo[]);

  const intentPrompt = deckCtx.commander ? `${prompt} (commander: ${deckCtx.commander})` : prompt;
  const intent = await analyzeIntent(anthropic, intentPrompt);
  if (!intent.commander && deckCtx.commander) intent.commander = deckCtx.commander;

  // A question answered from knowledge alone gets no research. "What does Sol
  // Ring do?" was paying for an EDHREC page and a Moxfield search before its
  // first byte, and none of it reached the answer.
  //
  // Reddit and the combo lookup are already in flight by now — deliberately, so
  // they overlap the intent call. They aren't awaited here, so they cost this
  // request nothing but their own completion; both already carry a `.catch`.
  if (!intent.needsCards) {
    return { data: { edhrec: [], reddit: [], moxfield: [] }, sources: [], almostCombos: [], researched: false };
  }

  const [edhrec, moxfield, reddit, almostCombos] = await Promise.all([
    fetchEdhrec(intent).catch(() => [] as string[]),
    fetchMoxfield(intent, prompt).catch(() => [] as string[]),
    redditP,
    combosP,
  ]);

  const data: SourceData = { edhrec, reddit, moxfield };
  const sources: string[] = [];
  if (data.edhrec.length) sources.push("EDHREC");
  if (data.reddit.length) sources.push("Reddit");
  if (data.moxfield.length) sources.push("Moxfield");

  return { data, sources, almostCombos, researched: true };
}

// ── Prompt-block builders. Shared so the search ranker and the chat assistant
// describe the same grounding data identically.

export function buildSourceBlock(data: SourceData): string {
  const total = data.edhrec.length + data.reddit.length + data.moxfield.length;
  if (total === 0) {
    return (
      "No community data could be retrieved for this request. Fall back entirely on your own expert Magic " +
      "knowledge to pick cards that satisfy EVERY constraint in the request."
    );
  }
  return (
    "Below are candidate card names gathered from real Magic community sources. Treat them as your primary " +
    "evidence — they reflect what real decks and players actually run — but YOU are the filter: keep a card " +
    "only if it genuinely satisfies EVERY constraint in the request, and discard off-theme noise. You may add a " +
    "few obvious staples from your own knowledge if they're missing, but prefer the sourced cards.\n\n" +
    `EDHREC (${data.edhrec.length}): ${data.edhrec.join(", ") || "—"}\n\n` +
    `Reddit (${data.reddit.length}): ${data.reddit.join(", ") || "—"}\n\n` +
    `Moxfield (${data.moxfield.length}): ${data.moxfield.join(", ") || "—"}`
  );
}

// Whether a chat request is the "suggest a deck from my collection" build —
// the one flow where community research costs seconds of dead air before the
// first streamed byte and adds little, because the answer is meant to come out
// of cards the player already owns.
//
// The tell is a MISSING `currentDeck`, not an empty one. The iOS suggest flow
// omits it entirely (the deck doesn't exist yet); every other caller — the deck
// assistant on both clients and the web deck page — always sends the object,
// even for an empty deck. Testing emptiness instead would wrongly strip
// research from an assistant conversation about a brand-new deck.
export function isCollectionBuild(currentDeck: unknown, collection: string[]): boolean {
  return (currentDeck === undefined || currentDeck === null) && collection.length > 0;
}

// The grounding preamble for a build that deliberately skipped research. The
// empty case of buildSourceBlock says community data "could be retrieved" —
// true when a fetch failed, misleading when we chose not to fetch. Framing a
// deliberate skip as a degraded state invites the model to hedge, so say plainly
// that the player's collection (supplied earlier in the prompt) is the ground
// truth here.
//
// "listed above", not below: the chat route orders its system blocks
// stable-first for prompt caching, which puts the collection ahead of this
// preamble. A pointer that walks the model the wrong way is worse than none.
export function buildCollectionFirstBlock(): string {
  return (
    "No community data was gathered for this request — it is a build from the player's own collection, " +
    "which is listed above and is your primary evidence. Use it together with your own expert Magic " +
    "knowledge to pick cards that satisfy EVERY constraint in the request."
  );
}

export function buildDeckBlock(deckCtx: DeckContext): string {
  if (deckCtx.cards.length === 0 && !deckCtx.commander) return "";
  const commanderLine = deckCtx.commander ? `COMMANDER: ${deckCtx.commander}\n` : "";
  // Count actual copies, not rows: a deck with 20 basics is 20 cards, not 1.
  const totalCopies = deckCtx.cards.reduce((n, c) => n + Math.max(1, c.quantity), 0);
  const cardLines = deckCtx.cards
    .map((c) => `  ${c.quantity > 1 ? `${c.quantity}x ` : ""}${c.name}${c.typeLine ? ` (${c.typeLine})` : ""}`)
    .join("\n");
  return (
    "\n\nCURRENT DECK COMPOSITION — these cards are ALREADY in the player's pool. " +
    "Do NOT suggest any of them. Use this list to understand the deck's strategy, mana curve, " +
    "and synergies so your suggestions complement what's already built. The count in front of a " +
    "card is how many copies it runs (e.g. basic lands):\n" +
    commanderLine +
    `${totalCopies} cards total (${deckCtx.cards.length} unique):\n${cardLines}`
  );
}

export function buildComboBlock(almostCombos: AlmostCombo[]): string {
  if (almostCombos.length === 0) return "";
  const lines = almostCombos.map(
    (c) => `  Missing: ${c.missing.join(", ")} | Full combo: ${c.cards.join(" + ")} → ${c.produces.join(", ")}`
  );
  return (
    "\n\nALMOST-COMPLETE COMBOS — Commander Spellbook found these combos where the player has all " +
    "pieces EXCEPT the listed missing card(s). If any missing card fits the conversation, " +
    "strongly prefer recommending it and explain the combo it completes:\n" +
    lines.join("\n")
  );
}

// The player's owned-card collection, for grounding suggestions in what they
// already have. Capped so a huge collection doesn't blow up the prompt.
const MAX_COLLECTION_NAMES = 800;

export function buildCollectionBlock(names: string[]): string {
  if (names.length === 0) return "";
  const shown = names.slice(0, MAX_COLLECTION_NAMES);
  const more = names.length - shown.length;
  const counted = more > 0 ? `showing ${shown.length} of ${names.length} owned` : `${names.length} owned`;
  return (
    "\n\nPLAYER'S COLLECTION — cards the player physically OWNS. Strongly prefer recommending cards from " +
    "this list when they fit the request, since the player can add them at no cost. When you do recommend a " +
    "card they do NOT own, you may briefly note it's a new purchase. Do NOT write your own ownership labels " +
    "like \"owned\" or a ✅ next to cards — the app already marks owned cards automatically. And no matter what, " +
    "the card name itself MUST still be wrapped in [[double brackets]] so it stays a clickable link. " +
    `(${counted}):\n` +
    shown.join(", ")
  );
}

// Parse a request body's `collection` (array of names) into a clean string list.
export function parseCollection(collection: unknown): string[] {
  if (!Array.isArray(collection)) return [];
  return collection
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    .map((n) => n.trim())
    .slice(0, MAX_COLLECTION_NAMES);
}

// Parse a request body's `currentDeck` into a clean DeckContext (best-effort).
export function parseDeckContext(currentDeck: unknown): DeckContext {
  const cd = currentDeck as { commander?: unknown; cards?: unknown } | null | undefined;
  return {
    commander: typeof cd?.commander === "string" ? cd.commander : null,
    cards: Array.isArray(cd?.cards)
      ? (cd!.cards as { name?: unknown; manaCost?: unknown; typeLine?: unknown; quantity?: unknown }[])
          .filter((c) => typeof c?.name === "string" && c.name)
          .map((c) => ({
            name: c.name as string,
            manaCost: typeof c.manaCost === "string" ? c.manaCost : null,
            typeLine: typeof c.typeLine === "string" ? c.typeLine : null,
            quantity: typeof c.quantity === "number" && c.quantity > 0 ? Math.floor(c.quantity) : 1,
          }))
          .slice(0, 500)
      : [],
  };
}
