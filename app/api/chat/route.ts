import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { currentUser } from "@/lib/auth";
import { ANON_LIMIT_MSG, anonAiAllowed, clientIp } from "@/lib/ratelimit";
import { AI_LIMIT_MSG } from "@/lib/limits";
import { consumeAi } from "@/lib/limits-db";
import {
  buildCollectionBlock,
  buildCollectionFirstBlock,
  buildComboBlock,
  buildDeckBlock,
  buildSourceBlock,
  gatherContext,
  isCollectionBuild,
  parseCollection,
  parseDeckContext,
} from "@/lib/research";

export const runtime = "nodejs";

type ChatRole = "user" | "assistant";
interface ChatMessage {
  role: ChatRole;
  content: string;
}

const MAX_TOTAL_CHARS = 12000;
// The iOS app appends an invisible directive to the player's ask — the answer
// structure, the format rule and the commander's color identity — which runs
// ~2200 characters on a commander deck. At 2000 this cap sliced that directive
// off the end of every such ask (and the app, budgeting its question against
// it, went negative and crashed). The cap exists to stop abuse, not to fit the
// directive: 8000 clears it with room for a real question, and MAX_TOTAL_CHARS
// still bounds the conversation.
const MAX_MESSAGE_CHARS = 8000;

// Conversational deck assistant. Unlike /api/search (which returns a ranked JSON
// card list for the swipe UI), this streams a ChatGPT-style Markdown answer that
// reasons about the player's idea and weaves in combos. Every card it recommends
// is wrapped in [[Card Name]] so the client can render it as a click-to-add link.
export async function POST(req: Request) {
  // Guests share the anonymous budget; free accounts spend their daily meter.
  const user = await currentUser();
  if (!user && !anonAiAllowed(clientIp(req))) {
    return NextResponse.json({ error: ANON_LIMIT_MSG }, { status: 429 });
  }
  if (user && !(await consumeAi(user))) {
    return NextResponse.json({ error: AI_LIMIT_MSG, code: "ai_limit" }, { status: 429 });
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
  const collection = parseCollection(body?.collection);
  const latestUser = messages[messages.length - 1].content;

  // Building from the player's own collection skips research: a blocking Haiku
  // intent call plus four network fetches, all before the first byte can move,
  // to ground an answer that is supposed to come out of the cards listed in the
  // request anyway. Skipping lands in the all-sources-empty state gatherContext
  // already degrades to. See isCollectionBuild for why the tell is a *missing*
  // currentDeck rather than an empty one.
  const buildingFromCollection = isCollectionBuild(body?.currentDeck, collection);

  const anthropic = new Anthropic();

  // Gather grounding data (intent → EDHREC/Reddit/Moxfield/Spellbook) before we
  // start streaming — this is the brief "thinking" pause the client shows.
  const { data, sources, almostCombos } = buildingFromCollection
    ? { data: { edhrec: [], reddit: [], moxfield: [] }, sources: [] as string[], almostCombos: [] }
    : await gatherContext(anthropic, latestUser, deckCtx).catch(
        () => ({ data: { edhrec: [], reddit: [], moxfield: [] }, sources: [] as string[], almostCombos: [] })
      );

  const system =
    "You are a world-class Magic: The Gathering deckbuilding expert having a focused conversation with a " +
    "player about their deck — Commander/EDH unless they name another format (Standard, Modern, …). They will " +
    "describe an idea, a strategy, or a change they're considering. Give a thoughtful, opinionated answer — " +
    "like a knowledgeable friend, not a search engine.\n\n" +
    "DECKLIST REQUESTS: When the player asks you to BUILD a deck and to output only a decklist, comply " +
    "exactly — no prose, no questions, just the list, one card per line, every card in [[double brackets]]. " +
    "Never respond to a build request with clarifying questions; make reasonable choices and build.\n\n" +
    "FORMAT: Reply in clean GitHub-flavored Markdown. Use short section headings (##), **bold** for emphasis, " +
    "and bullet lists for card recommendations. Keep it tight and skimmable — a few sections, not an essay.\n\n" +
    "CARD LINKS — CRITICAL: Wrap the EXACT printed name of EVERY specific Magic card you mention, EVERY time it " +
    "appears, in double square brackets — e.g. [[Sol Ring]], [[Cyclonic Rift]]. This applies everywhere: in prose " +
    "sentences, headings, and lists, whether you are recommending it, comparing it, or just referencing it in " +
    "passing. NEVER write a real card's name without the brackets. The app turns each bracketed card into a " +
    "one-click button: a card NOT yet in the deck becomes 'add to pool', and a card ALREADY in the deck becomes " +
    "'remove from deck'. The ONLY card names you leave unbracketed are the player's commander and generic terms " +
    "(e.g. 'counterspells', 'ramp', 'a board wipe', card types). If you name a card, bracket it — no exceptions. " +
    "Example: write \"Pair [[Thassa's Oracle]] with [[Demonic Consultation]] to win,\" never \"Pair Thassa's Oracle " +
    "with Demonic Consultation.\" Use the card's full exact name (e.g. [[Lightning Bolt]], not 'Bolt').\n\n" +
    "COMBOS: Proactively surface relevant combos and synergies as part of your answer — the player relies on you " +
    "for this, so there is no separate combo tool. When you describe a combo, bracket each card piece and briefly " +
    "say what it does together.\n\n" +
    "JUDGING: When the player asks you to judge, rate, or review their deck or pool, act as the deck judge — " +
    "there is no separate judge tool. Structure that reply as: a short overall verdict, then '## Working well', " +
    "'## Consider cutting', and '## Missing' sections, with every specific card bracketed.\n\n" +
    (buildingFromCollection ? buildCollectionFirstBlock() : buildSourceBlock(data)) +
    buildDeckBlock(deckCtx) +
    buildComboBlock(almostCombos) +
    buildCollectionBlock(collection) +
    (sources.length ? `\n\n(You may mention these sources informed you: ${sources.join(", ")}.)` : "");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The model can think silently for a long stretch before its first
      // visible token — long enough for proxy/client idle timeouts to kill
      // full-deck builds mid-request. Newline heartbeats keep bytes flowing
      // until real text arrives; blank lines are invisible to Markdown and
      // to both clients' parsers.
      let heartbeat: ReturnType<typeof setInterval> | null = setInterval(() => {
        try {
          controller.enqueue(encoder.encode("\n"));
        } catch {
          // Stream already closed — the clear below is on its way.
        }
      }, 15000);
      const stopHeartbeat = () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      };
      try {
        // Sonnet 5 rejects sampling params (`temperature` → 400) and runs
        // adaptive thinking by default; thinking spends output tokens, so the
        // budget carries headroom beyond the visible reply. Full-decklist
        // builds (60–100 lines AFTER a heavy think) were starving at 6000 —
        // the visible reply came back truncated or empty. The stream filter
        // below already passes text deltas only, so thinking never leaks out.
        const ai = anthropic.messages.stream({
          model: "claude-sonnet-5",
          max_tokens: 16000,
          system,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        });
        for await (const event of ai) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            stopHeartbeat();
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        stopHeartbeat();
        controller.close();
      } catch (e) {
        stopHeartbeat();
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
