import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { extractJson } from "@/lib/ai";
import { recordEvent } from "@/lib/analytics";
import { currentUser } from "@/lib/auth";
import { PRACTICE_AI_TURNS } from "@/lib/limits";
import { fallbackPlan, simpleTurn, winningTurn, guardPlan } from "@/lib/practice/ai";
import { cleanPlan, lineBrief, PLAN_SCHEMA, sinceLastTurn, systemPrompt, turnBrief, type DeckLine } from "@/lib/practice/brief";
import { turnTrace, type TurnTrace } from "@/lib/practice/trace";
import type { CardBook, TurnPlan } from "@/lib/practice/types";
import { asGame } from "@/lib/practice/wire";
import { asCombos } from "@/lib/practice/combos";

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
  /** The deck's combos (absent in games started before they were kept). */
  combos?: unknown;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to play a practice match." }, { status: 401 });
  const id = (await params).id;
  const row = await prisma.practiceGame.findFirst({ where: { id, userId: user.id }, select: { setup: true, bot: true } });
  if (!row) return NextResponse.json({ error: "game not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { game?: unknown } | null;
  const game = asGame(body?.game);
  if (!game) return NextResponse.json({ error: "game required" }, { status: 400 });
  const setup = JSON.parse(row.setup) as Setup;
  const combos = asCombos(setup.combos);

  // The turn is kept as it was planned (lib/practice/trace.ts): what the
  // opponent held, the planner's line, the model's plan. A match can then
  // be read back from the admin page. Not waited for, and never in the way.
  const keep = (source: string, extra: Partial<TurnTrace> = {}) => {
    try {
      const data: TurnTrace = { ...turnTrace(game, setup.book), ...extra };
      void prisma.practiceTurn.create({ data: { gameId: id, turn: game.turn, source, data: JSON.stringify(data) } }).catch(() => {});
    } catch {
      /* a trace is never worth a failed turn */
    }
  };
  const said = (plan: TurnPlan) => lineBrief(game, plan);

  // Counted, so admin shows how often the model is reached. The note says
  // why in a few words, so a player can tell us (and the log has the rest).
  const fallback = (note: string, extra: Partial<TurnTrace> = {}) => {
    void recordEvent("practice_fallback_turn");
    const plan = fallbackPlan(game, setup.book, "opp", {}, combos);
    keep("fallback", { line: said(plan), note, ...extra });
    return NextResponse.json({ plan, source: "fallback", note });
  };
  const instinct = (why: string) => fallback(`The opponent played on instinct this turn (${why}).`);

  // The basic bot is the built-in planner: no model, no count. (The table
  // plans those turns itself; this answers a client that asks anyway.)
  if (row.bot) return NextResponse.json({ plan: fallbackPlan(game, setup.book, "opp", {}, combos), source: "bot" });
  // A turn with nothing to decide (a land, and nothing it could cast or
  // attack with) is played at once: the model would take its time to say
  // the same. It isn't one of the game's AI turns.
  // A win the table can see and has checked (Thassa's Oracle on an empty
  // library, a lethal storm turn, a combo with every piece in place) is
  // played, not left for the model to find. Before the "nothing to decide"
  // check: a combo sitting on the battlefield is exactly a turn with
  // nothing to cast.
  const win = winningTurn(game, setup.book, "opp", combos);
  if (win) {
    keep("win", { line: said(win) });
    return NextResponse.json({ plan: win, source: "win" });
  }
  const simple = simpleTurn(game, setup.book, "opp", combos);
  if (simple) {
    keep("simple", { line: said(simple) });
    return NextResponse.json({ plan: simple, source: "simple" });
  }

  // One more AI turn, if the game has any left.
  const spent = await prisma.practiceGame.updateMany({ where: { id, userId: user.id, turns: { lt: PRACTICE_AI_TURNS } }, data: { turns: { increment: 1 } } });
  if (!spent.count) return fallback("The opponent is on autopilot for the rest of this game.");
  if (!process.env.ANTHROPIC_API_KEY) return fallback("The opponent is on autopilot.");

  const { rules, deck } = systemPrompt(setup.oppDeck, setup.book, setup.oppCommander, combos);
  // What the built-in planner would play: the model is shown it, and the
  // table plays it when the model's turn casts nothing.
  const line = fallbackPlan(game, setup.book, "opp", {}, combos);
  const brief = turnBrief(game, setup.book, sinceLastTurn(game), combos, line);
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
      return instinct(res.stop_reason === "max_tokens" ? "its plan ran too long" : res.stop_reason === "refusal" ? "it couldn't plan this turn" : `its planning stopped: ${res.stop_reason}`);
    }
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    // A combo piece cast on a turn that doesn't go off is taken out.
    const read = cleanPlan(extractJson(text));
    const plan: TurnPlan | null = read ? guardPlan(game, read, setup.book) : null;
    if (!plan) {
      console.error(`[practice] unreadable plan: ${text.slice(0, 300)}`);
      return fallback("The opponent played on instinct this turn (its plan didn't fit the game).", { raw: text.slice(0, 3000) });
    }
    void recordEvent("practice_ai_turn");
    // What the model planned, next to what the planner would have: its
    // actions as it wrote them too, for the ones the table then refuses.
    keep("ai", { line: said(line), plan: said(plan), say: plan.say.slice(0, 300), raw: JSON.stringify([...plan.main, ...plan.after_combat]).slice(0, 4000) });
    return NextResponse.json({ plan, source: "ai" });
  } catch (e) {
    console.error("[practice] turn failed", e instanceof Error ? e.message : e);
    if (e instanceof Anthropic.APIConnectionTimeoutError) return instinct("it took too long to think");
    if (e instanceof Anthropic.APIError && e.status) return instinct(`planner error ${e.status}`);
    return instinct("its planner couldn't be reached");
  }
}
