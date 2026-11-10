import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { AI_LIMIT_MSG } from "@/lib/limits";
import { consumeAi } from "@/lib/limits-db";
import { REVIEW_INSTRUCTIONS, reviewPrompt } from "@/lib/practice/review";
import { asGame } from "@/lib/practice/wire";

export const runtime = "nodejs";

// The AI's review of a finished practice game: what decided it, what the
// player's deck did well and lacked, and a change or two to try. POST with
// the game as it ended; streams Markdown back as plain text. Written once
// and kept on the game, so asking again costs nothing.
//
// A game against the AI is one of the day's games already, so its review is
// part of it. A game against the basic bot is free and unlimited, so its
// review spends one of the day's AI questions.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const id = (await params).id;
  const row = await prisma.practiceGame.findFirst({ where: { id, userId: user.id }, select: { deck: true, label: true, bot: true, review: true } });
  if (!row) return NextResponse.json({ error: "game not found" }, { status: 404 });
  const text = (body: string) => new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  if (row.review) return text(row.review);

  const body = (await req.json().catch(() => null)) as { game?: unknown } | null;
  const game = asGame(body?.game);
  if (!game || !game.winner) return NextResponse.json({ error: "The game isn't over yet." }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  const deck = row.deck
    ? await prisma.deck.findFirst({
        where: { publicId: row.deck, OR: [{ userId: user.id }, { userId: null }, { shared: true }] },
        select: { name: true, format: true, commander: true, cards: { where: { board: "deck" }, select: { name: true, quantity: true, typeLine: true }, orderBy: { name: "asc" } } },
      })
    : null;
  if (!deck) return NextResponse.json({ error: "That game's deck is gone." }, { status: 404 });
  // One review at a time for a game: a second request while the first is
  // being written would pay for it twice.
  if (writing.has(id)) return NextResponse.json({ error: "The review is being written. Give it a moment." }, { status: 409 });
  if (row.bot && !(await consumeAi(user))) return NextResponse.json({ error: AI_LIMIT_MSG, code: "ai_limit" }, { status: 429 });
  writing.add(id);

  const prompt = reviewPrompt({ deckName: deck.name, format: deck.format, commander: deck.commander, cards: deck.cards, opponent: row.label, bot: row.bot, game });
  const anthropic = new Anthropic();
  const encoder = new TextEncoder();
  let stopped = false;
  let current: { abort(): void } | null = null;
  const stop = () => {
    stopped = true;
    current?.abort();
  };
  req.signal.addEventListener("abort", stop);
  const stream = new ReadableStream<Uint8Array>({
    cancel: stop,
    async start(controller) {
      let written = "";
      try {
        const ai = anthropic.messages.stream({
          model: "claude-opus-5-5",
          max_tokens: 8000,
          output_config: { effort: "medium" },
          system: [{ type: "text", text: REVIEW_INSTRUCTIONS, cache_control: { type: "ephemeral", ttl: "1h" } }],
          messages: [{ role: "user", content: prompt }],
        });
        current = ai;
        let lastBlock = false;
        for await (const event of ai) {
          if (event.type === "content_block_start" && event.content_block.type === "text") {
            if (lastBlock) {
              written += "\n\n";
              controller.enqueue(encoder.encode("\n\n"));
            }
            lastBlock = true;
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            written += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await ai.finalMessage();
        console.log(`[practice] review game=${id} out=${final.usage.output_tokens} stop=${final.stop_reason}`);
        // Kept only when it's whole: a cut-off review would be served forever.
        if (final.stop_reason === "end_turn" && written.trim()) {
          await prisma.practiceGame.updateMany({ where: { id, userId: user.id, review: null }, data: { review: written.trim().slice(0, 12_000) } }).catch(() => {});
        }
      } catch (e) {
        if (!stopped) {
          console.error("[practice] review failed", e instanceof Error ? e.message : e);
          try {
            controller.enqueue(encoder.encode("\n\n_Sorry, the review stopped with an error. Try again._"));
          } catch {
            /* closed */
          }
        }
      } finally {
        writing.delete(id);
        try {
          controller.close();
        } catch {
          /* already cancelled */
        }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

// Games whose review is being written right now (in this process).
const writing = new Set<string>();
