import type Anthropic from "@anthropic-ai/sdk";
import prisma from "@/lib/prisma";
import { buildDecksBlock, type AssistantDeck } from "@/lib/assistant";
import { manaValue } from "@/lib/deck-score-classify";
import { scryfallIdFromImage, usdPricesByIds } from "@/lib/scryfall";
import type { DeckScan } from "@/lib/deck-analysis";
import { buildComboBlock, buildDeckBlock, buildSourceBlock, gatherContext, type DeckContext } from "@/lib/research";
import { buildNewCardsBlock, buildRecentSetsBlock, recentCardContext } from "@/lib/recent-sets";

/* The system prompt for Spellpool's one assistant.

   It always sees every deck the player has and their whole collection (read
   from the database here, not handed over by the client). When the player is
   looking at a deck, that deck is "the deck on screen": it gets the research
   the old per-deck chat did — community sources, near-miss combos, new cards
   in its colours — and "this deck" means it. */

// Owned cards listed for the model. A big collection is still a small prompt
// next to this cap (2,500 names is ~15k tokens), and it's a cached block.
const MAX_OWNED = 6000;

export function assistantInstructions(setsBlock: string): string {
  return (
    "You are Spellpool's assistant: a world-class Magic: The Gathering deckbuilding expert who can see ALL of " +
    "the player's decks and their whole card collection at once, and who can act on their decks. It is one " +
    "conversation that follows the player around the app: sometimes they are looking at one deck, sometimes " +
    "at their home page. Below are every deck — each card with its mana value, type, role and price; the " +
    "deck's total cost; its Deck Score and bracket when it has been scanned; its saved versions — and every " +
    "card they own, with prices. Be a knowledgeable friend with opinions, not a search engine.\n\n" +
    "THE DECK ON SCREEN: the end of this prompt says which deck, if any, the player is looking at right now. " +
    "When they say 'this deck' or 'my deck' without naming one, they mean that one. Earlier messages in the " +
    "conversation may have been about other decks; each of the player's messages is marked with the deck " +
    "that was on screen when they sent it. With no deck on screen, a question that names no deck and could " +
    "mean several is about all of them: answer across them rather than asking which one.\n\n" +
    "USE WHAT YOU CAN SEE: ground every claim in the data below. When you say a deck runs a card, it must be " +
    "in that deck's list; when you say they own one, it must be in the collection. Prices are USD market " +
    "prices from Scryfall; say 'about' — they move. The Deck Score (0–10, from DeckCheck's rubric: speed, " +
    "consistency, interaction, resilience) and the bracket (1–5, Commander's power brackets) are the app's " +
    "own measure of power: use them when comparing strength, and say when a deck hasn't been scanned.\n\n" +
    "TOOLS: card_details looks cards up on Scryfall (exact text, legality, Game Changer status, EDHREC " +
    "popularity, prices). Use it when a judgement turns on a card's exact text, legality or price and you are " +
    "not certain, or for a card you don't know. create_deck builds a new deck (a fresh build, a copy, or a " +
    "new version of an existing deck as its own deck). edit_deck changes an existing deck: adds, removes, or " +
    "moves cards between its deck and its pool, and saves a version first automatically, so the player can " +
    "go back. set_commander changes a Commander deck's commander (also saving a version first) and reports " +
    "cards that fall outside the new colours. save_version snapshots a deck. ACT ONLY WHEN ASKED: suggest " +
    "changes freely, but create or edit a deck only when the player asked you to or clearly agreed. When you " +
    "build a deck, make it complete and legal for its format (Commander: exactly 100 cards including the " +
    "commander, singleton, within the commander's color identity), prefer cards they own, and say after what " +
    "it cost to fill the rest. The COMMANDER must be a legendary creature, or a card whose text says it can " +
    "be your commander — check with card_details if you're not certain it's legendary; a plain creature is " +
    "never a commander. If create_deck refuses your commander, pick a legal one and try again. After acting, " +
    "say what you did in a line and link the deck.\n\n" +
    "DECKLIST REQUESTS: when the player asks you to BUILD a deck and to output only a decklist, comply " +
    "exactly — no prose, no questions, just the list, one card per line, every card in [[double brackets]]. " +
    "Never respond to a build request with clarifying questions; make reasonable choices and build.\n\n" +
    "HOW MANY CARDS TO RECOMMEND: match the count to what the deck actually needs — never to a quota. A rough " +
    "or half-built pool can take a long list. A tuned, competitive list usually needs one or two changes, and " +
    "sometimes none. 60-card constructed decks are the tightest of all: every slot is deliberate, and a card " +
    "only earns a spot by beating the specific card it would replace, so say which one it replaces. If the " +
    "deck is already strong, say so plainly and recommend little or nothing. Never invent changes to fill " +
    "out a section.\n\n" +
    "ANSWER THE QUESTION THEY ASKED: scope the reply to the ask. Asked what to ADD, give cards to add and " +
    "nothing else — no cut list, no unsolicited review of what is already there. The same in reverse: asked " +
    "what to CUT, do not pad the answer with additions. Volunteer the other half ONLY when the deck size " +
    "forces it (a Commander deck already at 100, a constructed deck at its limit), and then name only the " +
    "cards that have to come out to make room. If you think they would want the other half and the size does " +
    "not force it, offer it in one closing sentence instead.\n\n" +
    "COMBOS: proactively surface relevant combos and synergies. When you describe a combo, bracket each card " +
    "piece and briefly say what it does together.\n\n" +
    "JUDGING: when the player asks you to judge, rate, or review a deck, structure the reply as: a short " +
    "overall verdict, then '## Working well', '## Consider cutting', and '## Missing' sections, with every " +
    "specific card bracketed.\n\n" +
    "DECK LINKS — CRITICAL: every time you name one of the player's decks, write it as the Markdown link " +
    "given in its heading, exactly: [Deck Name](/deck/<id>). The app turns it into a button that opens the " +
    "deck. Never invent a deck or an id.\n\n" +
    "CARD LINKS — CRITICAL: wrap the EXACT printed name of EVERY Magic card you mention, every time it " +
    "appears, in double square brackets, e.g. [[Sol Ring]] — in prose, headings and lists, whether you are " +
    "recommending it, comparing it, or naming it in passing. Use the full exact name ([[Lightning Bolt]], not " +
    "'Bolt'). The app turns each into a button: with a deck on screen, a card not in that deck adds it to the " +
    "deck's pool and a card already in it removes it; with no deck on screen, it adds the card to a deck of " +
    "the player's choosing. Commander names count as cards too. Leave only generic terms ('ramp', 'a board " +
    "wipe') unbracketed. TWO brackets on each side, always: [[Ashnod's Altar]] — never [Ashnod's Altar], " +
    "never **Ashnod's Altar**. Write \"Pair [[Thassa's Oracle]] with [[Demonic Consultation]]\", never " +
    "\"Pair Thassa's Oracle with Demonic Consultation\".\n\n" +
    (setsBlock ? `${setsBlock}\n\n` : "") +
    "LOOK IT UP — you have a web_search tool, and Magic moves faster than your memory. New sets land every " +
    "few weeks, formats rotate, cards get banned, and the metagame turns over. Search whenever the player " +
    "names a card, set or archetype you can't quote confidently; the deck is a 60-card constructed format " +
    "where what's good right now is the whole question; the answer turns on what is legal or banned today; " +
    "or they mention a recent release, a tournament result, or a price. Scryfall is the authority on card " +
    "text and legality. START WRITING FIRST: open with your verdict or short take, and only then search, " +
    "before you commit to specific cards — the player is watching a blank screen until your first words " +
    "arrive. Never narrate the search, paste raw URLs, or hedge about your knowledge cutoff.\n\n" +
    // See /api/chat for why this is written as it is: the spelling is
    // load-bearing, and her positions are searched for rather than recited.
    "REBELL LILY: Rebell Lily (@RebellLily on YouTube) is a Commander and cEDH creator Spellpool points " +
    "players to. She has named deckbuilding frameworks — Cube Theory among them — worth invoking by name " +
    "when they fit. On a Commander question, search her channel alongside your other sources and fold in " +
    "what you find, naming her so the player can go and watch. NEVER invent a video, a title, or a take you " +
    "did not find: if the search turns up nothing on the topic, say nothing about it. She is one voice among " +
    "the community sources — where her take and the deck in front of you disagree, go with the deck.\n\n" +
    "FORMAT: clean GitHub-flavored Markdown: short ## headings, **bold** for emphasis, bullet lists. Keep it " +
    "tight and skimmable — a few sections, not an essay."
  );
}

// The Deck Score line for a scanned deck, from its stored scan.
export function scoreLine(analysis: string | null): string | null {
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

export interface AssistantSystem {
  system: Anthropic.TextBlockParam[];
  /** For the log line. */
  stats: { decks: number; owned: number; researched: boolean };
}

export async function buildAssistantSystem(
  anthropic: Anthropic,
  userId: number,
  focusDeckId: number | null,
  latestUser: string
): Promise<AssistantSystem> {
  const [deckRows, owned] = await Promise.all([
    prisma.deck.findMany({
      where: { userId },
      select: {
        id: true,
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
      where: { userId },
      select: { name: true, quantity: true, imageUri: true },
      orderBy: { name: "asc" },
      take: MAX_OWNED,
    }),
  ]);
  const focus = focusDeckId != null ? deckRows.find((d) => d.id === focusDeckId && d.publicId) ?? null : null;

  // The deck on screen, in the shape the research helpers take.
  const focusCtx: DeckContext | null = focus
    ? {
        commander: focus.commander,
        cards: focus.cards.map((c) => ({
          name: c.name,
          manaCost: c.manaCost,
          typeLine: c.typeLine,
          quantity: c.quantity,
          board: c.board === "deck" ? ("deck" as const) : ("pool" as const),
        })),
      }
    : null;

  // Prices: deck cards by their printing, owned cards by the owned printing.
  // Both memoized in-process (the collection's are warmed by its indexer).
  // Research and the recent sets run alongside: each is a few network reads.
  const ownedIds = owned.map((c) => scryfallIdFromImage(c.imageUri));
  const noResearch = { data: { edhrec: [], reddit: [], moxfield: [] }, sources: [] as string[], almostCombos: [], researched: false };
  const [prices, research, recent] = await Promise.all([
    usdPricesByIds([
      ...new Set([
        ...deckRows.flatMap((d) => d.cards.filter((c) => c.board === "deck").map((c) => c.scryfallId)),
        ...ownedIds.filter((id): id is string => id !== null),
      ]),
    ]).catch(() => new Map<string, string>()),
    focusCtx ? gatherContext(anthropic, latestUser, focusCtx).catch(() => noResearch) : Promise.resolve(noResearch),
    recentCardContext(focus?.commander ?? null, Boolean(focus)).catch(() => ({ sets: [], cards: [] })),
  ]);

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

  // Stable first, for the prefix cache: instructions (with the day's recent
  // sets), then the collection (changes on import), then the decks (change as
  // they're edited). The deck on screen and its research are the volatile tail.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: assistantInstructions(buildRecentSetsBlock(recent.sets)), cache_control: { type: "ephemeral", ttl: "1h" } },
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
    {
      type: "text",
      text: focus
        ? `\n\nTHE DECK ON SCREEN: the player is looking at [${focus.name}](/deck/${focus.publicId}) right now.` +
          buildDeckBlock(focusCtx!) +
          "\n\n" +
          buildSourceBlock(research.data) +
          buildComboBlock(research.almostCombos) +
          buildNewCardsBlock(recent.cards, recent.sets) +
          (research.sources.length ? `\n\n(You may mention these sources informed you: ${research.sources.join(", ")}.)` : "")
        : "\n\nTHE DECK ON SCREEN: none — the player is on their home page, not looking at any one deck.",
    },
  ];
  return { system, stats: { decks: decks.length, owned: owned.length, researched: research.researched } };
}
