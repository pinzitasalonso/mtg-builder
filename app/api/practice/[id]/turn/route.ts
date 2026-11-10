import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { extractJson } from "@/lib/ai";
import { recordEvent } from "@/lib/analytics";
import { currentUser } from "@/lib/auth";
import { PRACTICE_AI_TURNS } from "@/lib/limits";
import { fallbackPlan } from "@/lib/practice/ai";
import { cleanPlan, PLAN_SCHEMA, sinceLastTurn, systemPrompt, turnBrief, type DeckLine } from "@/lib/practice/brief";
import type { CardBook, PracticeGame, TurnPlan } from "@/lib/practice/types";

export const runtime = "nodejs";

// The AI's turn in a practice game (docs/practice-vs-ai.md). The browser
// sends the game as it stands; the card text comes from what the start route
// stored, never from the browser. One model call plans the whole turn as
// JSON (structured outputs), and the engine in the browser plays it out,
// checking every move. Anything that goes wrong — no key, a refusal, a
// timeout, the game's AI turns used up — and the built-in planner takes the
// turn instead, so the game never stalls.

const MODEL = "claude-opus-5-5";

interface Setup {
  book: CardBook;
  oppDeck: DeckLine[];
  oppCommander: string | null;
}

const ZONES = ["library", "hand", "battlefield", "graveyard", "exile", "command"] as const;
// A double-faced card's full name and type line fit well inside this.
const MAX_TEXT = 300;
const MAX_LOG_LINES = 200;

/** The game the browser sent, if it has the shape of one. */
function asGame(v: unknown): PracticeGame | null {
  const g = v as PracticeGame | null;
  if (!g || typeof g !== "object" || typeof g.turn !== "number" || !g.sides) return null;
  for (const seat of ["you", "opp"] as const) {
    const side = g.sides[seat];
    if (!side || typeof side.life !== "number") return null;
    for (const z of ZONES) {
      if (!Array.isArray(side[z]) || side[z].length > 400) return null;
      // Card names and type lines go into the prompt: no longer than a card's.
      for (const c of side[z]) {
        if (!c || typeof c !== "object" || typeof c.name !== "string" || c.name.length > MAX_TEXT) return null;
        if (c.typeLine != null && (typeof c.typeLine !== "string" || c.typeLine.length > MAX_TEXT)) return null;
      }
    }
  }
  // The log is the browser's: only its last lines are read, each cut short.
  g.log = (Array.isArray(g.log) ? g.log : [])
    .filter((l) => !!l && typeof l === "object" && typeof l.text === "string")
    .slice(-MAX_LOG_LINES)
    .map((l) => ({ ...l, text: l.text.slice(0, MAX_TEXT) }));
  return g;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to play against the AI." }, { status: 401 });
  const id = (await params).id;
  const row = await prisma.practiceGame.findFirst({ where: { id, userId: user.id }, select: { setup: true } });
  if (!row) return NextResponse.json({ error: "game not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { game?: unknown } | null;
  const game = asGame(body?.game);
  if (!game) return NextResponse.json({ error: "game required" }, { status: 400 });
  const setup = JSON.parse(row.setup) as Setup;

  // Counted, so admin shows how often the model is reached. The note says
  // why in a few words, so a player can tell us (and the log has the rest).
  const fallback = (note: string) => {
    void recordEvent("practice_fallback_turn");
    return NextResponse.json({ plan: fallbackPlan(game, setup.book), source: "fallback", note });
  };
  const instinct = (why: string) => fallback(`The opponent played on instinct this turn (${why}).`);

  // One more AI turn, if the game has any left.
  const spent = await prisma.practiceGame.updateMany({ where: { id, userId: user.id, turns: { lt: PRACTICE_AI_TURNS } }, data: { turns: { increment: 1 } } });
  if (!spent.count) return fallback("The opponent is on autopilot for the rest of this game.");
  if (!process.env.ANTHROPIC_API_KEY) return fallback("The opponent is on autopilot.");

  const { rules, deck } = systemPrompt(setup.oppDeck, setup.book, setup.oppCommander);
  const brief = turnBrief(game, setup.book, sinceLastTurn(game));
  try {
    const anthropic = new Anthropic();
    const res = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        // Medium effort (the model's default): it thinks through the turn —
        // sequencing fast mana, what to hold up, what to attack with. The
        // engine has already done the counting (what's castable, the mana).
        output_config: { effort: "medium", format: { type: "json_schema", schema: PLAN_SCHEMA } },
        // The rules and this deck's card text are the same every turn: cached.
        system: [
          { type: "text", text: rules },
          { type: "text", text: deck, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: brief }],
      },
      // One try, under the table's 115-second wait: a slow answer becomes
      // the built-in planner's turn here, with the reason, not a silent
      // give-up in the browser.
      { timeout: 100_000, maxRetries: 0 }
    );
    const u = res.usage;
    console.log(
      `[practice] game=${id} turn=${game.turn} stop=${res.stop_reason} fresh=${u.input_tokens} ` +
        `cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens}`
    );
    if (res.stop_reason !== "end_turn") {
      console.error(`[practice] turn stopped: ${res.stop_reason}`);
      return instinct(res.stop_reason === "max_tokens" ? "the AI ran out of room" : res.stop_reason === "refusal" ? "the AI declined" : `the AI stopped: ${res.stop_reason}`);
    }
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const plan: TurnPlan | null = cleanPlan(extractJson(text));
    if (!plan) {
      console.error(`[practice] unreadable plan: ${text.slice(0, 300)}`);
      return instinct("the AI's answer didn't fit");
    }
    void recordEvent("practice_ai_turn");
    return NextResponse.json({ plan, source: "ai" });
  } catch (e) {
    console.error("[practice] turn failed", e instanceof Error ? e.message : e);
    if (e instanceof Anthropic.APIConnectionTimeoutError) return instinct("the AI took too long");
    if (e instanceof Anthropic.APIError && e.status) return instinct(`AI error ${e.status}`);
    return instinct("the AI couldn't be reached");
  }
}
