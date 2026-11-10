import { clientIp, rateLimit } from "@/lib/ratelimit";
import { NextResponse } from "next/server";
import { SCRYFALL_HEADERS } from "@/lib/scryfall";
import { scryfallFetch } from "@/lib/scryfall-limit";

export const runtime = "nodejs";

// Every paper printing of one card, for the collection's version picker:
// newest first, with what the picker shows (art, set, number, finish, price).
// Server-side so the browser makes one request to us, not a Scryfall search,
// and so repeat opens of the same card are served from memory.

export interface CardPrinting {
  id: string;
  name: string;
  set: string;
  setName: string;
  number: string;
  released: string | null;
  imageUri: string;
  finishes: string[];
  usd: string | null;
  usdFoil: string | null;
}

interface ScryfallPrint {
  id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  released_at?: string;
  digital?: boolean;
  finishes?: string[];
  image_uris?: { normal?: string };
  card_faces?: { image_uris?: { normal?: string } }[];
  prices?: { usd?: string | null; usd_foil?: string | null };
}

const TTL_MS = 60 * 60 * 1000;
// Capped, oldest out first: every name asked for (a made-up one too: it's
// remembered as having no printings) takes an entry.
const CACHE_MAX = 2000;
const cache = new Map<string, { at: number; printings: CardPrinting[] }>();
// Uncached lookups one address may start a minute. Each is one or two
// Scryfall searches in the slow lane, which the whole server shares: without
// a limit, a burst of made-up names queued everyone's searches behind it.
const LOOKUPS_PER_MINUTE = 30;

export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name")?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const key = name.toLowerCase();
  if (name.length > 300) return NextResponse.json({ error: "name too long" }, { status: 400 });
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ printings: hit.printings });
  if (!rateLimit(`printings:${clientIp(req)}`, LOOKUPS_PER_MINUTE, 60_000)) {
    return NextResponse.json({ error: "Too many lookups. Try again in a minute." }, { status: 429 });
  }

  // Exact name, every print, paper only. A double-faced card is searched by
  // its front face, which Scryfall matches to the whole card.
  const front = name.split(" // ")[0];
  const q = `!"${front.replace(/"/g, "")}" game:paper`;
  const printings: CardPrinting[] = [];
  let url: string | null =
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=released&dir=desc`;
  // Two pages (350 printings) covers every card there is, basics aside.
  for (let page = 0; url && page < 2; page++) {
    let res: Response;
    try {
      res = await scryfallFetch(url, { headers: SCRYFALL_HEADERS });
    } catch {
      return NextResponse.json({ error: "Couldn’t reach Scryfall." }, { status: 502 });
    }
    if (res.status === 404) break; // no printings by that name
    if (!res.ok) return NextResponse.json({ error: "Scryfall didn’t answer. Try again." }, { status: 502 });
    const data = (await res.json()) as { data?: ScryfallPrint[]; has_more?: boolean; next_page?: string };
    for (const c of data.data ?? []) {
      if (c.digital) continue;
      const imageUri = c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal ?? "";
      if (!imageUri) continue;
      printings.push({
        id: c.id,
        name: c.name,
        set: c.set,
        setName: c.set_name,
        number: c.collector_number,
        released: c.released_at ?? null,
        imageUri,
        finishes: c.finishes ?? [],
        usd: c.prices?.usd ?? null,
        usdFoil: c.prices?.usd_foil ?? null,
      });
    }
    url = data.has_more && data.next_page ? data.next_page : null;
  }

  cache.delete(key);
  cache.set(key, { at: Date.now(), printings });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return NextResponse.json({ printings });
}
