import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { recordEvent } from "@/lib/analytics";
import { PRACTICE_AI_TURNS, PRACTICE_LIMIT_MSG } from "@/lib/limits";
import { canStartPractice } from "@/lib/limits-db";
import { isEdhrecLevel } from "@/lib/edhrec";
import { deckFromDb, deckFromEdhrec, deckFromMtgtop8 } from "@/lib/practice/decks";

export const runtime = "nodejs";

// Start a practice game: load both decks with their card books, count the
// game against the daily allowance, and keep what the AI's turns will be
// built from (docs/practice-vs-ai.md).
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to play against the AI." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as {
    deck?: unknown;
    opponent?: { kind?: unknown; format?: unknown; archetype?: unknown; deck?: unknown; commander?: unknown; level?: unknown };
  } | null;
  const deckId = typeof body?.deck === "string" ? body.deck : "";
  const o = body?.opponent;
  if (!deckId || !o) return NextResponse.json({ error: "deck and opponent required" }, { status: 400 });
  if (!(await canStartPractice(user))) return NextResponse.json({ error: PRACTICE_LIMIT_MSG, code: "practice_limit" }, { status: 429 });

  const you = await deckFromDb(deckId, user.id);
  if (!you) return NextResponse.json({ error: "That deck has no cards to play yet." }, { status: 400 });
  const opp =
    o.kind === "deck" && typeof o.deck === "string"
      ? await deckFromDb(o.deck, user.id)
      : o.kind === "mtgtop8" && typeof o.format === "string" && typeof o.archetype === "string"
        ? await deckFromMtgtop8(o.format, o.archetype)
        : o.kind === "edhrec" && typeof o.commander === "string" && o.commander.trim() && o.commander.length <= 200
          ? await deckFromEdhrec(o.commander.trim(), isEdhrecLevel(o.level) ? o.level : null)
          : null;
  if (!opp) return NextResponse.json({ error: "Couldn't load that opponent's deck. Try another." }, { status: 502 });

  const book = { ...you.book, ...opp.book };
  const commanderGame = !!(you.commander || opp.commander);
  const id = randomUUID();
  await prisma.practiceGame.create({
    data: {
      id,
      userId: user.id,
      label: `${opp.label} — ${opp.detail}`.slice(0, 200),
      setup: JSON.stringify({ book, oppDeck: opp.cards.map((c) => ({ name: c.name, quantity: c.quantity })), oppCommander: opp.commander }),
    },
  });
  void recordEvent("practice_game");
  return NextResponse.json({
    id,
    commanderGame,
    aiTurns: PRACTICE_AI_TURNS,
    book,
    you: { label: you.label, cards: you.cards, commander: you.commander },
    opp: { label: opp.label, detail: opp.detail, cards: opp.cards, commander: opp.commander },
  });
}
