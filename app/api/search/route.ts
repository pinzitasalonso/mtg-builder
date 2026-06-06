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
  const { prompt, filters } = await req.json();
  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  const filterTerms: string[] = Array.isArray(filters) ? filters : [];

  let query: string;

  if (process.env.ANTHROPIC_API_KEY) {
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

  const scryfallUrl = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec`;
  const scryfallRes = await fetch(scryfallUrl, {
    headers: { "User-Agent": "mtg-builder/1.0" },
  });

  if (!scryfallRes.ok) {
    const err = await scryfallRes.json().catch(() => ({}));
    return NextResponse.json(
      { error: "Scryfall search failed", details: err, query },
      { status: 422 }
    );
  }

  const data = await scryfallRes.json();
  const cards = (data.data as ScryfallCard[]).slice(0, 20).map((c) => {
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

  return NextResponse.json({ cards, query });
}
