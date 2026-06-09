import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { extractJson, messageText, strArr } from "@/lib/ai";

export const runtime = "nodejs";

// Keep prompts bounded — a Commander pool is ~100 distinct cards, so this cap
// only trips on abuse, not real use.
const MAX_CARDS = 500;
const MAX_FIELD = 200;

interface JudgeCard {
  name: string;
  manaCost: string | null;
  typeLine: string | null;
  quantity: number;
}

interface JudgeResult {
  summary: string;
  working: string[];
  cuts: string[];
  missing: string[];
}

// Coerce one client-supplied card entry; null drops invalid entries instead of
// letting `undefined` leak into the prompt.
function toJudgeCard(v: unknown): JudgeCard | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== "string" || !o.name.trim()) return null;
  const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.slice(0, MAX_FIELD) : null);
  const qty = typeof o.quantity === "number" && Number.isFinite(o.quantity) && o.quantity > 0 ? Math.floor(o.quantity) : 1;
  return { name: o.name.slice(0, MAX_FIELD), manaCost: str(o.manaCost), typeLine: str(o.typeLine), quantity: qty };
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI is not configured" }, { status: 503 });
  }

  const body = await req.json();
  const rawCards: unknown[] = Array.isArray(body.cards) ? body.cards : [];
  const cards = rawCards
    .map(toJudgeCard)
    .filter((c): c is JudgeCard => c !== null)
    .slice(0, MAX_CARDS);
  if (cards.length === 0) {
    return NextResponse.json({ error: "no cards to judge — add some first" }, { status: 400 });
  }
  const format = typeof body.format === "string" ? body.format.slice(0, MAX_FIELD) : null;
  const commander = typeof body.commander === "string" ? body.commander.slice(0, MAX_FIELD) : null;

  // Compact, deterministic card list: "{qty}x Name — {cost} — {type}" per line.
  let totalCopies = 0;
  const list = cards
    .map((c) => {
      totalCopies += c.quantity;
      const bits = [c.quantity > 1 ? `${c.quantity}x ${c.name}` : c.name];
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

    const parsed = extractJson(messageText(msg)) as Partial<JudgeResult> | null;
    if (!parsed) {
      return NextResponse.json({ error: "AI returned an unreadable response" }, { status: 502 });
    }

    const result: JudgeResult = {
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
      working: strArr(parsed.working),
      cuts: strArr(parsed.cuts),
      missing: strArr(parsed.missing),
    };
    return NextResponse.json(result);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "AI judge failed", details: detail }, { status: 502 });
  }
}
