import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { scanSummary } from "@/lib/deck-analysis";
import { FREE_PRACTICE_PER_DAY, isPro, utcDay } from "@/lib/limits";
import { fetchMetagame, MTGTOP8_FORMATS } from "@/lib/mtgtop8";
import { mtgtop8FormatFor } from "@/lib/practice/decks";
import { ownDeckOptions, recentOpponents, suggestedCommanders, tournamentOptions, type OpponentOption } from "@/lib/practice/opponents";

export const runtime = "nodejs";

export type { OpponentOption };

/** One tab of the picker. */
export interface OpponentTab {
  id: "suggested" | "tournament" | "mine";
  title: string;
  /** A line under the tabs: where these come from. */
  note: string;
  options: OpponentOption[];
}

export interface OpponentsAnswer {
  format: string;
  commanderGame: boolean;
  /** The deck's Score bracket, when it has been scanned. */
  bracket: number | null;
  tabs: OpponentTab[];
  /** The last few opponents this deck played. */
  recent: OpponentOption[];
  /** The free plan's games against the AI today (null on Pro: no limit). */
  free: { perDay: number; left: number } | null;
  /** Pictures are still being fetched: ask again in a few seconds. */
  more: boolean;
}

// Who a deck can practise against, as tabs of tiles (each with a picture and
// its colours). A Commander deck: a few commanders many people play (EDHREC's
// average deck, at the deck's bracket), cEDH's most played, and the player's
// own decks. Any other format: its tournament decks, and the player's own.
// A Commander deck can also face any commander (/api/practice/commanders).
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to play against the AI." }, { status: 401 });
  const publicId = new URL(req.url).searchParams.get("deck") ?? "";
  const deck = await prisma.deck.findFirst({
    where: { publicId, OR: [{ userId: user.id }, { userId: null }, { shared: true }] },
    select: { publicId: true, name: true, format: true, commander: true, analysis: true },
  });
  if (!deck?.publicId) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const commanderGame = deck.format.toLowerCase() === "commander";
  const bracket = commanderGame ? (scanSummary(deck.analysis)?.bracket ?? null) : null;
  const f = mtgtop8FormatFor(deck.format);

  // Each source answers on its own: one that's down leaves its tab out.
  const [suggested, meta, mine, recent, startedToday] = await Promise.all([
    commanderGame ? suggestedCommanders(`${utcDay()}:${deck.publicId}`, deck.commander ? [deck.commander] : []).catch(() => []) : Promise.resolve([]),
    f ? fetchMetagame(f).catch(() => null) : Promise.resolve(null),
    ownDeckOptions(user.id, { publicId: deck.publicId, name: deck.name, format: deck.format }),
    recentOpponents(user.id, deck.publicId),
    isPro(user) ? Promise.resolve(0) : prisma.practiceGame.count({ where: { userId: user.id, bot: false, createdAt: { gte: new Date(`${utcDay()}T00:00:00.000Z`) } } }),
  ]);
  const tournament = f && meta ? await tournamentOptions(f, MTGTOP8_FORMATS[f]!.label, meta.period.id, meta.meta.archetypes.slice(0, 12)) : { options: [], more: false };

  const tabs: OpponentTab[] = [];
  if (suggested.length) {
    tabs.push({
      id: "suggested",
      title: "For your deck",
      note: bracket ? `Commanders many people play, at your deck's bracket (${bracket}). Each plays EDHREC's average deck for it.` : "Commanders many people play. Each plays EDHREC's average deck for it.",
      options: suggested,
    });
  }
  if (tournament.options.length) {
    tabs.push({
      id: "tournament",
      title: f === "cedh" ? "cEDH" : "Tournament",
      note: f === "cedh" ? "cEDH's most played commanders, each with its best recent list on MTGTop8. These are fast, tuned decks." : `The ${MTGTOP8_FORMATS[f!]!.label} metagame's top decks, each with its best recent list on MTGTop8.`,
      options: tournament.options,
    });
  }
  tabs.push({ id: "mine", title: "Your decks", note: "Your other decks of this format, and this deck against itself.", options: mine });

  const answer: OpponentsAnswer = {
    format: deck.format,
    commanderGame,
    bracket,
    tabs,
    recent,
    free: isPro(user) ? null : { perDay: FREE_PRACTICE_PER_DAY, left: Math.max(0, FREE_PRACTICE_PER_DAY - startedToday) },
    more: tournament.more,
  };
  return NextResponse.json(answer);
}
