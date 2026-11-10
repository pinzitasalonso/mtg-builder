import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { scanVersionURL } from "@/lib/scan-url";
import { SCRYFALL_HEADERS, toOutCard, type ScryfallCard } from "@/lib/scryfall";
import { scryfallFetch } from "@/lib/scryfall-limit";

export const runtime = "nodejs";

/** A commander the search found. */
export interface CommanderHit {
  name: string;
  typeLine: string | null;
  /** Its art, for the row. */
  image: string | null;
  colors: string | null;
}

// The picker's commander search: cards that can be a commander whose name
// has what was typed, the most played first. (The card-name autocomplete it
// replaces offered any card: "Atraxa's Fall" isn't an opponent.) One
// Scryfall search a query, remembered six hours.
const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; hits: CommanderHit[] }>();

/** What was typed, as a Scryfall query: each word must be in the name. */
export function commanderQuery(typed: string): string | null {
  const words = typed
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’,\- ]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[,\-]+|[,\-]+$/g, ""))
    .filter(Boolean)
    .slice(0, 6);
  if (words.join("").length < 2) return null;
  return `is:commander ${words.map((w) => `name:"${w}"`).join(" ")}`;
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to play against the AI." }, { status: 401 });
  const typed = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  const q = commanderQuery(typed);
  if (!q) return NextResponse.json({ hits: [] });
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ hits: hit.hits });
  // Each new query is a request to Scryfall.
  if (!rateLimit(`practice-commanders:${user.id}`, 40, 60_000)) return NextResponse.json({ error: "Too many searches. Try again in a minute." }, { status: 429 });
  try {
    const res = await scryfallFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=edhrec&unique=cards`, { headers: SCRYFALL_HEADERS });
    // Scryfall answers 404 when nothing matches.
    if (res.status === 404) {
      cache.set(q, { at: Date.now(), hits: [] });
      return NextResponse.json({ hits: [] });
    }
    if (!res.ok) return NextResponse.json({ error: "Scryfall is busy right now. Try again in a moment." }, { status: 503 });
    const data = (await res.json()) as { data?: ScryfallCard[] };
    const hits = (data.data ?? []).slice(0, 8).map((c): CommanderHit => {
      const card = toOutCard(c);
      return { name: card.name, typeLine: card.typeLine, image: card.imageUri ? (scanVersionURL(card.imageUri, "art_crop") ?? card.imageUri) : null, colors: card.colorIdentity };
    });
    cache.set(q, { at: Date.now(), hits });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return NextResponse.json({ hits });
  } catch {
    return NextResponse.json({ error: "Couldn't search right now. Try again." }, { status: 503 });
  }
}
