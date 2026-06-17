import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { currentUser } from "@/lib/auth";
import { ANON_LIMIT_MSG, anonAiAllowed } from "@/lib/ratelimit";
import {
  buildComboBlock,
  buildDeckBlock,
  buildSourceBlock,
  gatherContext,
  parseDeckContext,
} from "@/lib/research";

export const runtime = "nodejs";

type ChatRole = "user" | "assistant";
interface ChatMessage {
  role: ChatRole;
  content: string;
}

const MAX_TOTAL_CHARS = 12000;
const MAX_MESSAGE_CHARS = 2000;

// Conversational deck assistant. Unlike /api/search (which returns a ranked JSON
// card list for the swipe UI), this streams a ChatGPT-style Markdown answer that
// reasons about the player's idea and weaves in combos. Every card it recommends
// is wrapped in [[Card Name]] so the client can render it as a click-to-add link.
export async function POST(req: Request) {
  // Same shared anonymous budget as search — guests can chat but can't burn the key.
  if (!(await currentUser()) && !anonAiAllowed()) {
    return NextResponse.json({ error: ANON_LIMIT_MSG }, { status: 429 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const rawMessages = body?.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  const messages: ChatMessage[] = rawMessages
    .filter(
      (m: unknown): m is ChatMessage =>
        !!m &&
        typeof (m as ChatMessage).content === "string" &&
        ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant")
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "last message must be from the user" }, { status: 400 });
  }
  const totalChars = messages.reduce((n, m) => n + m.content.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return NextResponse.json({ error: "conversation too long" }, { status: 400 });
  }

  const deckCtx = parseDeckContext(body?.currentDeck);
  const latestUser = messages[messages.length - 1].content;

  const anthropic = new Anthropic();

  // Gather grounding data (intent → EDHREC/Reddit/Moxfield/Spellbook) before we
  // start streaming — this is the brief "thinking" pause the client shows.
  const { data, sources, almostCombos } = await gatherContext(anthropic, latestUser, deckCtx).catch(
    () => ({ data: { edhrec: [], reddit: [], moxfield: [] }, sources: [] as string[], almostCombos: [] })
  );

  const system =
    "You are a world-class Magic: The Gathering deckbuilding expert having a focused conversation with a " +
    "player about their Commander/EDH deck. They will describe an idea, a strategy, or a change they're " +
    "considering. Give a thoughtful, opinionated answer — like a knowledgeable friend, not a search engine.\n\n" +
    "FORMAT: Reply in clean GitHub-flavored Markdown. Use short section headings (##), **bold** for emphasis, " +
    "and bullet lists for card recommendations. Keep it tight and skimmable — a few sections, not an essay.\n\n" +
    "CARD LINKS: Whenever you name a specific Magic card you are recommending the player add, wrap its EXACT " +
    "printed name in double square brackets, e.g. [[Blightsteel Colossus]], [[Sol Ring]]. This lets the app turn " +
    "it into a one-click add-to-pool button. Wrap EVERY recommended card this way. Do NOT bracket the player's " +
    "commander, cards already in their pool, generic strategy words, or card types.\n\n" +
    "COMBOS: Proactively surface relevant combos and synergies as part of your answer — the player relies on you " +
    "for this, so there is no separate combo tool. When you describe a combo, bracket each card piece and briefly " +
    "say what it does together.\n\n" +
    buildSourceBlock(data) +
    buildDeckBlock(deckCtx) +
    buildComboBlock(almostCombos) +
    (sources.length ? `\n\n(You may mention these sources informed you: ${sources.join(", ")}.)` : "");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const ai = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 3000,
          system,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        });
        for await (const event of ai) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        controller.enqueue(encoder.encode(`\n\n_Sorry — the assistant hit an error: ${detail}_`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
