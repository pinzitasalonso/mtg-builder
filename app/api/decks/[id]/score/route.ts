import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser, viewableDeckByPublicId } from "@/lib/auth";
import { findCombos } from "@/lib/combos";
import { gameChangerNames } from "@/lib/gamechangers";
import { suggestedBracket, BRACKET_NUMBER } from "@/lib/deck-insight";
import { cardFactsByIds } from "@/lib/scryfall";
import { manaValue, nameKey, type ScoredCard } from "@/lib/deck-score-classify";
import { scoreDeck, type DeckScoreReport } from "@/lib/deck-score-report";

export const runtime = "nodejs";

// The deck's Score — Consistency, Resilience, Interaction, Speed, and the
// index that averages them — with the working under each axis.
//
// Three sources go in: the deck board's rows, Scryfall's facts about those
// cards (power, keywords, produced mana — the row does not store them), and
// the combo lines Commander Spellbook finds. The first is required; the other
// two are best-effort, and a deck scores from its rows alone when they fail.
//
// Viewable, not just editable: a shared deck's page shows its Score to whoever
// can see the deck, the same as its bracket.
//
// Cached per decklist for an hour. Scoring means two third-party calls and a
// few hundred goldfish hands, and the same deck is opened on its Stats pane
// more often than it is edited.
const cache = new Map<string, { at: number; key: string; report: DeckScoreReport }>();
const TTL_MS = 60 * 60_000;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  const deck = await viewableDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });

  // The DECK board only. The pool is candidates, and scoring a pile of
  // maybes would describe a deck nobody is playing.
  const rows = await prisma.poolCard.findMany({
    where: { deckId: deck.id, board: "deck" },
    select: { scryfallId: true, name: true, typeLine: true, oracleText: true, manaCost: true, quantity: true },
    orderBy: { name: "asc" },
  });
  if (rows.length === 0) {
    return NextResponse.json({ error: "deck has no cards on the deck board" }, { status: 422 });
  }

  const commanderKeys = new Set(
    (deck.commander ?? "")
      .split("+")
      .map((n) => nameKey(n))
      .filter(Boolean)
  );
  const signature = rows.map((r) => `${r.scryfallId}x${r.quantity}`).join("|") + `#${deck.commander ?? ""}`;
  const hit = cache.get(deck.id.toString());
  if (hit && hit.key === signature && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json(hit.report);
  }

  const [facts, combos, changers] = await Promise.all([
    cardFactsByIds(rows.map((r) => r.scryfallId)),
    findCombos(
      rows.map((r) => ({
        name: r.name,
        quantity: Math.max(1, r.quantity),
        isCommander: commanderKeys.has(nameKey(r.name)),
      }))
    ),
    gameChangerNames(),
  ]);

  const cards: ScoredCard[] = rows.map((r) => {
    const f = facts.get(r.scryfallId);
    return {
      name: r.name,
      typeLine: f?.typeLine ?? r.typeLine ?? "",
      oracleText: f?.oracleText ?? r.oracleText ?? "",
      manaCost: f?.manaCost ?? r.manaCost,
      manaValue: f ? f.manaValue : manaValue(r.manaCost),
      quantity: Math.max(1, r.quantity),
      power: f?.power ?? null,
      toughness: f?.toughness ?? null,
      keywords: f?.keywords ?? [],
      producedMana: f?.producedMana ?? [],
      isCommander: commanderKeys.has(nameKey(r.name)),
    };
  });

  // The rules bracket, for the floor: Game Changers on the list and a two-card
  // combo, the same reading the clients make.
  const changerSet = new Set(changers);
  const gameChangers = new Set(cards.filter((c) => changerSet.has(nameKey(c.name))).map((c) => nameKey(c.name))).size;
  const rulesBracket = BRACKET_NUMBER[suggestedBracket(gameChangers, combos.hasTwoCardCombo)];

  const report = scoreDeck(cards, combos.combos, rulesBracket);
  cache.set(deck.id.toString(), { at: Date.now(), key: signature, report });
  return NextResponse.json(report);
}
