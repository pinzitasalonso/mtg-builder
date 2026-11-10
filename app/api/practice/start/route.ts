import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { recordEvent } from "@/lib/analytics";
import { PRACTICE_AI_TURNS, PRACTICE_LIMIT_MSG } from "@/lib/limits";
import { claimPractice } from "@/lib/limits-db";
import { isEdhrecLevel } from "@/lib/edhrec";
import { rateLimit } from "@/lib/ratelimit";
import { scanVersionURL } from "@/lib/scan-url";
import { deckFromDb, deckFromEdhrec, deckFromMtgtop8, type PracticeDeck } from "@/lib/practice/decks";
import { cleanOpponent } from "@/lib/practice/opponents";

/** A picture for a deck: its commander's art. */
function coverOf(deck: PracticeDeck): string | null {
  const want = (deck.commander ?? "").split("+")[0]!.trim().toLowerCase();
  const card = want ? deck.cards.find((c) => c.name.toLowerCase() === want) : null;
  return card?.imageUri ? scanVersionURL(card.imageUri, "art_crop") : null;
}

export const runtime = "nodejs";

// Start a practice game: load both decks with their card books, count the
// game against the daily allowance, and keep what the AI's turns will be
// built from (docs/practice-vs-ai.md).
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to play against the AI." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { deck?: unknown; opponent?: unknown; bot?: unknown } | null;
  // Against the basic bot (the built-in planner, no model call): free, and
  // not one of the day's games. Each start still loads two decks.
  const bot = body?.bot === true;
  const deckId = typeof body?.deck === "string" ? body.deck.slice(0, 80) : "";
  const o = cleanOpponent(body?.opponent);
  if (!deckId || !o) return NextResponse.json({ error: "deck and opponent required" }, { status: 400 });
  // Today's game is claimed first, in one step with the count, so requests
  // sent together can't all pass the check while the decks load (that's
  // slow: EDHREC, MTGTop8, Scryfall). If the game can't start, the claim is
  // given back.
  if (bot && !rateLimit(`practice-bot:${user.id}`, 30, 60 * 60_000)) return NextResponse.json({ error: "That's a lot of games. Try again in a little while." }, { status: 429 });
  const id = await claimPractice(user, bot);
  if (!id) return NextResponse.json({ error: PRACTICE_LIMIT_MSG, code: "practice_limit" }, { status: 429 });
  const giveBack = () => prisma.practiceGame.deleteMany({ where: { id, userId: user.id } }).catch(() => {});

  const you = await deckFromDb(deckId, user.id);
  if (!you) {
    await giveBack();
    return NextResponse.json({ error: "That deck has no cards to play yet." }, { status: 400 });
  }
  const opp =
    o.kind === "deck"
      ? await deckFromDb(o.deck!, user.id)
      : o.kind === "mtgtop8"
        ? await deckFromMtgtop8(o.format!, o.archetype!)
        : await deckFromEdhrec(o.commander!, isEdhrecLevel(o.level) ? o.level : null);
  if (!opp) {
    await giveBack();
    return NextResponse.json({ error: "Couldn't load that opponent's deck. Try another." }, { status: 502 });
  }

  const book = { ...you.book, ...opp.book };
  const commanderGame = !!(you.commander || opp.commander);
  await prisma.practiceGame.update({
    where: { id },
    data: {
      label: `${opp.label} — ${opp.detail}`.slice(0, 200),
      deck: deckId,
      // The opponent as picked, for "play it again": its tile's words and
      // picture, or the loaded deck's where the tile had none.
      opponent: JSON.stringify({ ...o, label: o.label || opp.label, detail: o.detail || opp.detail, image: o.image ?? coverOf(opp) }),
      setup: JSON.stringify({ book, oppDeck: opp.cards.map((c) => ({ name: c.name, quantity: c.quantity })), oppCommander: opp.commander }),
    },
  });
  void recordEvent("practice_game");
  return NextResponse.json({
    id,
    bot,
    commanderGame,
    aiTurns: PRACTICE_AI_TURNS,
    book,
    you: { label: you.label, cards: you.cards, commander: you.commander },
    opp: { label: opp.label, detail: opp.detail, cards: opp.cards, commander: opp.commander },
  });
}
