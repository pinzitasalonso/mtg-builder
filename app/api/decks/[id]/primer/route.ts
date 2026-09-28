import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";
import { aiLimitMsg } from "@/lib/limits";
import { consumeAi } from "@/lib/limits-db";
import { proOnSale } from "@/lib/revenuecat";
import { findCombos, type ComboResult } from "@/lib/combos";
import { readStoredScan } from "@/lib/deck-analysis";
import { primerPrompt, PRIMER_INSTRUCTIONS } from "@/lib/primer";

export const runtime = "nodejs";

// Draft the deck's primer with the AI: POST, streams Markdown back as plain
// text. Nothing is saved here — the page puts the draft in the primer editor,
// and the player edits it and saves it (PATCH /api/decks/<id>) or throws it
// away. The owner only, and it spends one of the day's AI questions.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to write a primer with AI." }, { status: 401 });
  const deck = await accessibleDeckByPublicId((await params).id, user.id);
  if (!deck || deck.userId !== user.id) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "AI is not configured." }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const ask = typeof body?.ask === "string" ? body.ask.trim().slice(0, 600) : "";

  const cards = await prisma.poolCard.findMany({
    where: { deckId: deck.id, board: "deck" },
    select: { name: true, quantity: true, manaCost: true, typeLine: true, oracleText: true, role: true },
    orderBy: { name: "asc" },
  });
  if (cards.length < 10) return NextResponse.json({ error: "Add some cards first: a primer needs a deck to describe." }, { status: 400 });
  if (!(await consumeAi(user))) return NextResponse.json({ error: aiLimitMsg(proOnSale()), code: "ai_limit" }, { status: 429 });

  // Combos, best-effort and bounded: a slow Spellbook shouldn't hold the draft.
  const commanderKeys = new Set((deck.commander ?? "").split("+").map((n) => n.trim().toLowerCase()).filter(Boolean));
  const combos = await Promise.race<ComboResult | null>([
    findCombos(cards.map((c) => ({ name: c.name, quantity: Math.max(1, c.quantity), isCommander: commanderKeys.has(c.name.trim().toLowerCase()) }))).catch(() => null),
    new Promise((r) => setTimeout(() => r(null), 6000)),
  ]);

  const prompt = primerPrompt({
    name: deck.name,
    format: deck.format,
    commander: deck.commander,
    cards,
    combos: combos?.combos ?? [],
    scan: readStoredScan(deck.analysis),
    current: deck.primer,
    ask,
  });

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
      try {
        const ai = anthropic.messages.stream({
          model: "claude-opus-5-5",
          max_tokens: 16000,
          output_config: { effort: "medium" },
          system: [{ type: "text", text: PRIMER_INSTRUCTIONS, cache_control: { type: "ephemeral", ttl: "1h" } }],
          messages: [{ role: "user", content: prompt }],
        });
        current = ai;
        let lastBlock = false;
        for await (const event of ai) {
          // New text block, new paragraph (see lib/assistant-runner).
          if (event.type === "content_block_start" && event.content_block.type === "text") {
            if (lastBlock) controller.enqueue(encoder.encode("\n\n"));
            lastBlock = true;
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await ai.finalMessage();
        console.log(`[primer] cards=${cards.length} combos=${combos?.combos.length ?? "-"} out=${final.usage.output_tokens} stop=${final.stop_reason}`);
      } catch (e) {
        if (!stopped) {
          console.error("[primer] failed", e instanceof Error ? e.message : e);
          try {
            controller.enqueue(encoder.encode("\n\n_Sorry — the draft stopped with an error. Try again._"));
          } catch {
            /* closed */
          }
        }
      } finally {
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
