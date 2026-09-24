import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { AI_LIMIT_MSG } from "@/lib/limits";
import { consumeAi } from "@/lib/limits-db";
import { buildDecksBlock, type AssistantDeck } from "@/lib/assistant";

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
const MAX_RESUMES = 3;
// Owned cards listed for the model. A big collection is still a small prompt
// next to this cap (2,500 names is ~15k tokens), and it's a cached block.
const MAX_OWNED = 6000;

const INSTRUCTIONS =
  "You are Spellpool's assistant: a world-class Magic: The Gathering deckbuilding expert who can see ALL of " +
  "the player's decks and their whole card collection at once. Below are every deck (its list, its pool of " +
  "candidate cards, format and commander) and every card they own. Answer questions that span them: which " +
  "deck is strongest or weakest and why, which deck a card belongs in, what the decks share, where a card " +
  "is doing more work, what to build next from what they own, what to buy that helps several decks, how " +
  "to split contested staples between decks, and so on. Be a knowledgeable friend with opinions, not a " +
  "search engine.\n\n" +
  "USE WHAT YOU CAN SEE: ground every claim in the lists below. When you say a deck runs a card, it must " +
  "be in that deck's list. When you say the player owns a card, it must be in the collection. If a " +
  "question is about a single deck, answer it, and mention that the deck's own assistant (on the deck " +
  "page) can also add cards for them.\n\n" +
  "DECK LINKS — CRITICAL: every time you name one of the player's decks, write it as the Markdown link " +
  "given in its heading, exactly: [Deck Name](/deck/<id>). The app turns it into a button that opens the " +
  "deck. Never invent a deck or an id.\n\n" +
  "CARD LINKS — CRITICAL: wrap the EXACT printed name of EVERY Magic card you mention, every time, in " +
  "double square brackets, e.g. [[Sol Ring]]. The app turns each into a button that adds the card to a " +
  "deck of the player's choosing. Commander names count as cards here too. Never write a real card's name " +
  "without the brackets.\n\n" +
  "LOOK IT UP: you have a web_search tool. Use it when the answer turns on something that changes — a new " +
  "set, a ban, the current metagame, prices — or on a card you don't recognise. Start writing your take " +
  "first and search after; never narrate searches or paste URLs.\n\n" +
  "FORMAT: clean GitHub-flavored Markdown: short ## headings, **bold** for emphasis, bullet lists. Keep it " +
  "tight and skimmable. When a question names no deck and could mean several, answer across all of them " +
  "rather than asking which one.";

function stopNote(stop: Anthropic.Message["stop_reason"]): string | null {
  switch (stop) {
    case "max_tokens":
      return "_(That hit the length limit — ask me to continue and I'll pick up where I left off.)_";
    case "refusal":
      return "_(I stopped there and can't continue that one. Try rephrasing it?)_";
    case "pause_turn":
      return "_(I ran out of research time on that one — ask again and I'll keep going.)_";
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
    return NextResponse.json({ error: AI_LIMIT_MSG, code: "ai_limit" }, { status: 429 });
  }

  const [deckRows, owned] = await Promise.all([
    prisma.deck.findMany({
      where: { userId: user.id },
      select: {
        publicId: true,
        name: true,
        format: true,
        commander: true,
        cards: { select: { name: true, quantity: true, board: true }, orderBy: { name: "asc" } },
      },
    }),
    prisma.collectionCard.findMany({
      where: { userId: user.id },
      select: { name: true, quantity: true },
      orderBy: { name: "asc" },
      take: MAX_OWNED,
    }),
  ]);
  const decks: AssistantDeck[] = deckRows
    .filter((d): d is typeof d & { publicId: string } => Boolean(d.publicId))
    .map((d) => ({
      publicId: d.publicId,
      name: d.name,
      format: d.format,
      commander: d.commander,
      deck: d.cards.filter((c) => c.board === "deck").map((c) => ({ name: c.name, quantity: c.quantity })),
      pool: d.cards.filter((c) => c.board !== "deck").map((c) => ({ name: c.name, quantity: c.quantity })),
    }));

  // Stable first, for the prefix cache: instructions, then the collection
  // (changes on import), then the decks (change as they're edited).
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral", ttl: "1h" } },
    {
      type: "text",
      text:
        "\n\nTHE PLAYER'S COLLECTION — every card they own" +
        (owned.length ? ` (${owned.length} different cards):\n` + owned.map((c) => (c.quantity > 1 ? `${c.quantity} ${c.name}` : c.name)).join("; ") : ": nothing imported yet."),
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
        for (let attempt = 0; ; attempt++) {
          const ai = anthropic.messages.stream({
            model: "claude-opus-5-5",
            max_tokens: 32000,
            output_config: { effort: "medium" },
            system,
            tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
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
            `[assistant] decks=${decks.length} owned=${owned.length} fresh=${u.input_tokens} ` +
              `cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0} ` +
              `out=${u.output_tokens} stop=${final.stop_reason}`
          );
          finalStop = final.stop_reason;
          if (final.stop_reason !== "pause_turn" || attempt >= MAX_RESUMES) break;
          convo.push({ role: "assistant", content: final.content });
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
