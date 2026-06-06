import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

interface ScryfallCard {
  id: string;
  name: string;
  image_uris?: { normal?: string; large?: string };
  card_faces?: { image_uris?: { normal?: string; large?: string } }[];
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
}

export async function POST(req: Request) {
  const { prompt, filters, mode } = await req.json();
  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  const filterTerms: string[] = Array.isArray(filters) ? filters : [];

  let query: string;

  if (process.env.ANTHROPIC_API_KEY && mode !== "scryfall") {
    const anthropic = new Anthropic();
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system:
        "You are an expert Magic: The Gathering player. Convert the user's natural language description into a valid Scryfall search query string. Return ONLY the raw Scryfall query, nothing else. Examples: 'blue wizards' → 't:wizard c:u', 'black zombies that regenerate' → 't:zombie c:b o:regenerate', 'sagas that synergize with Tom Bombadil' → 't:saga'. Be smart about color identity, card types, keywords, and mechanics.",
      messages: [{ role: "user", content: prompt }],
    });
    query = (msg.content[0] as { type: string; text: string }).text.trim();
  } else {
    query = prompt.trim();
  }

  if (filterTerms.length > 0) {
    query = [query, ...filterTerms].join(" ");
  }

  // Scryfall paginates 175 cards/page. Follow next_page to return ALL matches,
  // capped at MAX_PAGES so a wildly broad query can't fetch tens of thousands.
  const MAX_PAGES = 7; // 7 * 175 = up to 1225 cards
  const raw: ScryfallCard[] = [];
  let pageUrl: string | null = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec`;
  let totalCards = 0;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES && pageUrl; page++) {
    const res: Response = await fetch(pageUrl, {
      headers: { "User-Agent": "mtg-builder/1.0" },
    });

    // Only surface an error if the very first page fails; otherwise return
    // whatever we've gathered so far.
    if (!res.ok) {
      if (page === 0) {
        const err = await res.json().catch(() => ({}));
        return NextResponse.json(
          { error: "Scryfall search failed", details: err, query },
          { status: 422 }
        );
      }
      break;
    }

    const data = await res.json();
    raw.push(...(data.data as ScryfallCard[]));
    totalCards = data.total_cards ?? raw.length;

    if (data.has_more && data.next_page) {
      pageUrl = data.next_page as string;
      // Respect Scryfall's rate-limit guidance between requests.
      await new Promise((r) => setTimeout(r, 100));
    } else {
      pageUrl = null;
    }
  }

  if (pageUrl) truncated = true; // hit MAX_PAGES with more available

  const cards = raw.map((c) => {
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
  });

  return NextResponse.json({ cards, query, totalCards, truncated });
}
