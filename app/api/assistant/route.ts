import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { aiLimitMsg } from "@/lib/limits";
import { proOnSale } from "@/lib/revenuecat";
import { consumeAi } from "@/lib/limits-db";
import { buildDecksBlock, DECKS_CHANGED, type AssistantDeck } from "@/lib/assistant";
import { ASSISTANT_TOOLS, runAssistantTool } from "@/lib/assistant-tools";
import { manaValue } from "@/lib/deck-score-classify";
import { scryfallIdFromImage, usdPricesByIds } from "@/lib/scryfall";
import type { DeckScan } from "@/lib/deck-analysis";

export const runtime = "nodejs";

// The home assistant: one conversation across ALL of a player's decks and
// their collection. The per-deck chat (/api/chat) is handed one deck by the
// client; this one reads every deck and the collection from the database
// itself, so it can compare them, move cards between them in its advice, and
// plan the next build from what the player owns.
//
// Same model, effort, streaming, heartbeat and pause_turn handling as
// /api/chat, and it spends the same daily AI allowance.

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_MESSAGE_CHARS = 8000;
const MAX_TOTAL_CHARS = 20000;
// Model passes per question: pause_turn resumes plus rounds of tool calls.
// Building a deck is a lookup or two and a create; eight is room to spare
// while still bounding a runaway loop.
const MAX_PASSES = 8;
// Owned cards listed for the model. A big collection is still a small prompt
// next to this cap (2,500 names is ~15k tokens), and it's a cached block.
const MAX_OWNED = 6000;

const INSTRUCTIONS =
  "You are Spellpool's assistant: a world-class Magic: The Gathering deckbuilding expert who can see ALL of " +
  "the player's decks and their whole card collection at once, and who can act on their decks. Below are " +
  "every deck — each card with its mana value, type, role and price; the deck's total cost; its Deck Score " +
  "and bracket when it has been scanned; its saved versions — and every card they own, with prices. Answer " +
  "questions that span them: which deck is strongest or weakest and why, how they compare in speed and " +
  "cost, which deck a card belongs in, what they share, what to build next from what they own, what to buy " +
  "that helps several decks, how to split contested staples, and so on. Be a knowledgeable friend with " +
  "opinions, not a search engine.\n\n" +
  "USE WHAT YOU CAN SEE: ground every claim in the data below. When you say a deck runs a card, it must be " +
  "in that deck's list; when you say they own one, it must be in the collection. Prices are USD market " +
  "prices from Scryfall; say 'about' — they move. The Deck Score (0–10, from DeckCheck's rubric: speed, " +
  "consistency, interaction, resilience) and the bracket (1–5, Commander's power brackets) are the app's " +
  "own measure of power: use them when comparing strength, and say when a deck hasn't been scanned.\n\n" +
  "TOOLS: card_details looks cards up on Scryfall (exact text, legality, Game Changer status, EDHREC " +
  "popularity, prices). Use it when a judgement turns on a card's exact text, legality or price and you are " +
  "not certain, or for a card you don't know. create_deck builds a new deck (a fresh build, a copy, or a " +
  "new version of an existing deck as its own deck). edit_deck changes an existing deck: it saves a version " +
  "first automatically, so the player can go back. save_version snapshots a deck. ACT ONLY WHEN ASKED: " +
  "suggest changes freely, but create or edit a deck only when the player asked you to or clearly agreed. " +
  "When you build a deck, make it complete and legal for its format (Commander: exactly 100 cards including " +
  "the commander, singleton, within the commander's color identity), prefer cards they own, and say after " +
  "what it cost to fill the rest. The COMMANDER must be a legendary creature, or a card whose text says it " +
  "can be your commander — check with card_details if you're not certain it's legendary; a plain creature " +
  "is never a commander. If create_deck refuses your commander, pick a legal one and try again. " +
  "After acting, say what you did in a line and link the deck.\n\n" +
  "DECK LINKS — CRITICAL: every time you name one of the player's decks, write it as the Markdown link " +
  "given in its heading, exactly: [Deck Name](/deck/<id>). The app turns it into a button that opens the " +
  "deck. Never invent a deck or an id.\n\n" +
  "CARD LINKS — CRITICAL: wrap the EXACT printed name of EVERY Magic card you mention, every time, in " +
  "double square brackets, e.g. [[Sol Ring]]. The app turns each into a button that adds the card to a " +
  "deck of the player's choosing. Commander names count as cards here too. Never write a real card's name " +
  "without the brackets.\n\n" +
  "LOOK IT UP: you also have web_search. Use it when the answer turns on something that changes — a new " +
  "set, a ban, the current metagame. Start writing your take first and search after; never narrate " +
  "searches or paste URLs.\n\n" +
  "FORMAT: clean GitHub-flavored Markdown: short ## headings, **bold** for emphasis, bullet lists. Keep it " +
  "tight and skimmable. When a question names no deck and could mean several, answer across all of them " +
  "rather than asking which one.";

// Sent in the stream when a tool changed a deck, so the client refreshes its
// deck list. Invisible: the client strips it before rendering.
// (DECKS_CHANGED, the in-stream "a deck changed" signal, lives in lib/assistant.)

// The Deck Score line for a scanned deck, from its stored scan.
function scoreLine(analysis: string | null): string | null {
  if (!analysis) return null;
  try {
    const scan = JSON.parse(analysis) as DeckScan;
    const s = scan.score;
    const axes = s.axes.map((a) => `${a.label.toLowerCase()} ${a.score}`).join(", ");
    return `${s.label} (${axes}) · bracket ${s.bracketFloor} or higher · wins around turn ${s.fundamentalTurn} · scanned ${scan.scannedAt.slice(0, 10)}`;
  } catch {
    return null;
  }
}

function stopNote(stop: Anthropic.Message["stop_reason"]): string | null {
  switch (stop) {
    case "max_tokens":
      return "_(That hit the length limit — ask me to continue and I'll pick up where I left off.)_";
    case "refusal":
      return "_(I stopped there and can't continue that one. Try rephrasing it?)_";
    case "pause_turn":
    case "tool_use":
      return "_(I ran out of steps on that one — ask me to continue and I'll pick up where I left off.)_";
    default:
      return null;
  }
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to ask about your decks." }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const raw = body?.messages;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }
  const messages: ChatMessage[] = raw
    .filter(
      (m: unknown): m is ChatMessage =>
        !!m && typeof (m as ChatMessage).content === "string" && ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant")
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }))
    .filter((m) => m.content.trim().length > 0);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "last message must be from the user" }, { status: 400 });
  }
  if (messages.reduce((n, m) => n + m.content.length, 0) > MAX_TOTAL_CHARS) {
    return NextResponse.json({ error: "This conversation is too long. Start a new one." }, { status: 400 });
  }
  // Metered after validation, so a malformed request doesn't cost a question.
  if (!(await consumeAi(user))) {
    return NextResponse.json({ error: aiLimitMsg(proOnSale()), code: "ai_limit" }, { status: 429 });
  }

  const [deckRows, owned] = await Promise.all([
    prisma.deck.findMany({
      where: { userId: user.id },
      select: {
        publicId: true,
        name: true,
        format: true,
        commander: true,
        analysis: true,
        _count: { select: { versions: true } },
        cards: {
          select: { name: true, quantity: true, board: true, manaCost: true, typeLine: true, role: true, scryfallId: true },
          orderBy: { name: "asc" },
        },
      },
    }),
    prisma.collectionCard.findMany({
      where: { userId: user.id },
      select: { name: true, quantity: true, imageUri: true },
      orderBy: { name: "asc" },
      take: MAX_OWNED,
    }),
  ]);

  // Prices: deck cards by their printing, owned cards by the owned printing.
  // Both memoized in-process (the collection's are warmed by its indexer).
  const ownedIds = owned.map((c) => scryfallIdFromImage(c.imageUri));
  const prices = await usdPricesByIds([
    ...new Set([
      ...deckRows.flatMap((d) => d.cards.filter((c) => c.board === "deck").map((c) => c.scryfallId)),
      ...ownedIds.filter((id): id is string => id !== null),
    ]),
  ]).catch(() => new Map<string, string>());

  const decks: AssistantDeck[] = deckRows
    .filter((d): d is typeof d & { publicId: string } => Boolean(d.publicId))
    .map((d) => {
      const card = (c: (typeof d.cards)[number], priced: boolean) => ({
        name: c.name,
        quantity: c.quantity,
        manaValue: c.typeLine?.includes("Land") ? 0 : manaValue(c.manaCost),
        type: c.typeLine?.split(" — ")[0] ?? null,
        role: c.role,
        usd: priced ? prices.get(c.scryfallId) ?? null : null,
      });
      return {
        publicId: d.publicId,
        name: d.name,
        format: d.format,
        commander: d.commander,
        deck: d.cards.filter((c) => c.board === "deck").map((c) => card(c, true)),
        pool: d.cards.filter((c) => c.board !== "deck").map((c) => ({ name: c.name, quantity: c.quantity })),
        score: scoreLine(d.analysis),
        versions: d._count.versions,
      };
    });

  // Stable first, for the prefix cache: instructions, then the collection
  // (changes on import), then the decks (change as they're edited).
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral", ttl: "1h" } },
    {
      type: "text",
      text:
        "\n\nTHE PLAYER'S COLLECTION — every card they own" +
        (owned.length
          ? ` (${owned.length} different cards, with prices where known):\n` +
            owned
              .map((c, i) => {
                const usd = ownedIds[i] ? prices.get(ownedIds[i]!) : null;
                return `${c.quantity > 1 ? `${c.quantity} ` : ""}${c.name}${usd ? ` $${usd}` : ""}`;
              })
              .join("; ")
          : ": nothing imported yet."),
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: "\n\n" + buildDecksBlock(decks), cache_control: { type: "ephemeral" } },
  ];

  const anthropic = new Anthropic();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Newline heartbeats through the silent stretches (thinking, searches),
      // only between text blocks where a newline is invisible — see /api/chat.
      let inTextBlock = false;
      const heartbeat = setInterval(() => {
        if (inTextBlock) return;
        try {
          controller.enqueue(encoder.encode("\n"));
        } catch {
          /* closed */
        }
      }, 10000);
      try {
        const convo: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));
        let finalStop: Anthropic.Message["stop_reason"] = null;
        for (let pass = 0; pass < MAX_PASSES; pass++) {
          const ai = anthropic.messages.stream({
            model: "claude-opus-5-5",
            max_tokens: 32000,
            output_config: { effort: "medium" },
            system,
            tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }, ...ASSISTANT_TOOLS],
            messages: convo,
          });
          for await (const event of ai) {
            if (event.type === "content_block_start") inTextBlock = event.content_block.type === "text";
            else if (event.type === "content_block_stop") inTextBlock = false;
            else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          inTextBlock = false;
          const final = await ai.finalMessage();
          const u = final.usage;
          console.log(
            `[assistant] pass=${pass} decks=${decks.length} owned=${owned.length} fresh=${u.input_tokens} ` +
              `cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0} ` +
              `out=${u.output_tokens} stop=${final.stop_reason}`
          );
          finalStop = final.stop_reason;
          if (final.stop_reason === "pause_turn") {
            convo.push({ role: "assistant", content: final.content });
            continue;
          }
          if (final.stop_reason !== "tool_use") break;

          // Run the tools the model asked for, show the player what they did,
          // and hand the results back for the next pass.
          const uses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const use of uses) {
            const out = await runAssistantTool(user, use.name, use.input);
            if (out.note) controller.enqueue(encoder.encode(`\n\n**${out.note}**\n\n`));
            if (out.changed) controller.enqueue(encoder.encode(DECKS_CHANGED));
            results.push({ type: "tool_result", tool_use_id: use.id, content: out.result, is_error: out.isError || undefined });
          }
          convo.push({ role: "assistant", content: final.content });
          convo.push({ role: "user", content: results });
          // finalStop stays "tool_use": if the passes run out here, the model
          // never got to answer the results, and the note says so.
        }
        const note = stopNote(finalStop);
        if (note) controller.enqueue(encoder.encode(`\n\n${note}`));
      } catch (e) {
        // The detail goes to the logs; the player gets a sentence they can act on.
        console.error("[assistant] failed", e instanceof Error ? e.message : e);
        const busy = e instanceof Anthropic.APIError && (e.status === 429 || e.status === 529 || (e.status ?? 0) >= 500);
        controller.enqueue(
          encoder.encode(
            busy
              ? "\n\n_The assistant is busy right now. Give it a moment and ask again._"
              : "\n\n_Sorry — the assistant hit an error. Try asking again._"
          )
        );
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
