import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

interface JudgeCard {
  name: string;
  manaCost?: string | null;
  typeLine?: string | null;
  quantity?: number;
}

interface JudgeResult {
  summary: string;
  working: string[];
  cuts: string[];
  missing: string[];
}

// Pull a JSON object out of an LLM text response that may be wrapped in prose or
// ```json fences. (Mirrors the helper in the search route.)
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

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim()) : [];

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI is not configured" }, { status: 503 });
  }

  const { cards, format, commander } = await req.json();
  if (!Array.isArray(cards) || cards.length === 0) {
    return NextResponse.json({ error: "no cards to judge — add some first" }, { status: 400 });
  }

  // Compact, deterministic card list: "{qty}x Name — {cost} — {type}" per line.
  let totalCopies = 0;
  const list = (cards as JudgeCard[])
    .map((c) => {
      const qty = Number.isFinite(c.quantity) && (c.quantity as number) > 0 ? Math.floor(c.quantity as number) : 1;
      totalCopies += qty;
      const bits = [qty > 1 ? `${qty}x ${c.name}` : c.name];
      if (c.manaCost) bits.push(c.manaCost);
      if (c.typeLine) bits.push(c.typeLine);
      return "- " + bits.join("  ·  ");
    })
    .join("\n");

  const context = [
    format ? `Format: ${format}.` : "",
    commander ? `Commander: ${commander}.` : "",
    `Pool size: ${totalCopies} cards (${cards.length} distinct).`,
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const anthropic = new Anthropic();
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system:
        "You are a world-class Magic: The Gathering deckbuilding expert reviewing a player's card pool. " +
        "Be concrete, concise, and honest. Judge synergy, curve, removal, ramp, card advantage and win conditions " +
        "relative to the stated format. When you name cards to cut or add, use exact English card names as printed.\n\n" +
        "Respond with ONLY a JSON object — no prose, no markdown fences — in exactly this shape:\n" +
        '{"summary": string, "working": string[], "cuts": string[], "missing": string[]}\n' +
        "- summary: one or two sentences on the pool's overall direction and biggest opportunity.\n" +
        "- working: 2-5 short bullet strings on what is strong / synergistic in the pool.\n" +
        "- cuts: 2-6 short strings, each starting with an exact card name from the pool, then a brief reason to cut it.\n" +
        "- missing: 3-8 exact English card names (just the names) of key cards that would improve the pool and aren't in it.",
      messages: [
        {
          role: "user",
          content: `${context}\n\nHere is the card pool:\n${list}\n\nAnalyze it and give recommendations.`,
        },
      ],
    });

    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const parsed = extractJson(text) as Partial<JudgeResult> | null;
    if (!parsed) {
      return NextResponse.json({ error: "AI returned an unreadable response" }, { status: 502 });
    }

    const result: JudgeResult = {
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
      working: arr(parsed.working),
      cuts: arr(parsed.cuts),
      missing: arr(parsed.missing),
    };
    return NextResponse.json(result);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "AI judge failed", details: detail }, { status: 502 });
  }
}
