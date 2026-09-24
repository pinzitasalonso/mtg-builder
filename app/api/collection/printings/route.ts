import { NextResponse } from "next/server";
import { SCRYFALL_HEADERS } from "@/lib/scryfall";

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
const cache = new Map<string, { at: number; printings: CardPrinting[] }>();

export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name")?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const key = name.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ printings: hit.printings });

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
      res = await fetch(url, { headers: SCRYFALL_HEADERS });
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

  cache.set(key, { at: Date.now(), printings });
  return NextResponse.json({ printings });
}
