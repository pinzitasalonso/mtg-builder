// Server side: the two decks of a practice game, each as its cards and a
// card book (what every card is). A deck is one of Spellpool's (the player's
// own, or one anyone may open) or a recent tournament list from MTGTop8.

import prisma from "@/lib/prisma";
import { EDHREC_LEVELS, fetchAverageDeck, type EdhrecLevel } from "@/lib/edhrec";
import { bestFinishes, fetchArchetypeDecks, fetchDecklist, fetchMetagame, MTGTOP8_FORMATS, parseMtgoList } from "@/lib/mtgtop8";
import { cardFactsByIds, lookupCollection, normalizeCardKey, type CardFacts } from "@/lib/scryfall";
import type { DeckCard } from "./game";
import type { CardBook, CardInfo } from "./types";

export interface PracticeDeck {
  label: string;
  /** A line under the label: where the list comes from. */
  detail: string;
  cards: (DeckCard & { quantity: number })[];
  commander: string | null;
  book: CardBook;
}

function infoFrom(facts: CardFacts | undefined, fallback: { name: string; imageUri: string; typeLine: string | null }): CardInfo {
  return {
    name: facts?.name ?? fallback.name,
    imageUri: fallback.imageUri,
    typeLine: facts?.typeLine ?? fallback.typeLine,
    manaCost: facts?.manaCost ?? null,
    manaValue: facts?.manaValue ?? 0,
    oracleText: facts?.oracleText ?? null,
    power: facts?.power ?? null,
    toughness: facts?.toughness ?? null,
    keywords: facts?.keywords ?? [],
    producedMana: facts?.producedMana ?? [],
    ...(facts?.back ? { back: facts.back } : {}),
  };
}

/** A Spellpool deck the user may open: theirs, an ownerless public one, or
    one shared by its owner. Its decklist (not the pool). */
export async function deckFromDb(publicId: string, userId: number): Promise<PracticeDeck | null> {
  const deck = await prisma.deck.findFirst({
    where: { publicId, OR: [{ userId }, { userId: null }, { shared: true }] },
    select: {
      name: true,
      format: true,
      commander: true,
      userId: true,
      cards: { where: { board: "deck" }, select: { scryfallId: true, name: true, imageUri: true, typeLine: true, quantity: true } },
    },
  });
  if (!deck || !deck.cards.length) return null;
  const facts = await cardFactsByIds(deck.cards.map((c) => c.scryfallId));
  const book: CardBook = {};
  for (const c of deck.cards) book[c.name.toLowerCase()] = infoFrom(facts.get(c.scryfallId), c);
  const commanderGame = deck.format.toLowerCase() === "commander";
  return {
    label: deck.name,
    detail: deck.userId === userId ? "Your deck" : "A Spellpool deck",
    cards: deck.cards.map((c) => ({ name: c.name, imageUri: c.imageUri, typeLine: c.typeLine, quantity: c.quantity })),
    commander: commanderGame ? deck.commander : null,
    book,
  };
}

/** An archetype's (or cEDH commander's) best recent finish on MTGTop8. */
export async function deckFromMtgtop8(format: string, archetypeId: string): Promise<PracticeDeck | null> {
  const meta = await fetchMetagame(format);
  const arch = meta?.meta.archetypes.find((a) => a.id === archetypeId);
  if (!meta || !arch) return null;
  const best = bestFinishes((await fetchArchetypeDecks(format, archetypeId, meta.period.id)) ?? [], 1)[0];
  if (!best) return null;
  const text = await fetchDecklist(best.deckId);
  if (!text) return null;
  const { main, side } = parseMtgoList(text);
  const cedh = format === "cedh";
  // In a cEDH list the sideboard is the commander; elsewhere it's a sideboard.
  const lines = cedh ? [...main, ...side] : main;
  const lookup = await lookupCollection([...new Set(lines.map((l) => l.name))]);
  const outs = lines.map((l) => ({ line: l, out: lookup.found.get(normalizeCardKey(l.name)) }));
  const facts = await cardFactsByIds(outs.flatMap((o) => (o.out ? [o.out.id] : [])));
  const book: CardBook = {};
  const cards: PracticeDeck["cards"] = [];
  for (const { line, out } of outs) {
    if (!out) continue;
    book[out.name.toLowerCase()] = infoFrom(facts.get(out.id), out);
    const have = cards.find((c) => c.name === out.name);
    if (have) have.quantity += line.quantity;
    else cards.push({ name: out.name, imageUri: out.imageUri, typeLine: out.typeLine, quantity: line.quantity });
  }
  if (cards.length < 10) return null;
  const commander = cedh
    ? side.map((l) => lookup.found.get(normalizeCardKey(l.name))?.name).filter(Boolean).join(" + ") || null
    : null;
  const placing = /^\d+$/.test(best.rank) ? (best.rank === "1" ? "won" : `#${best.rank} at`) : `top ${best.rank.split("-")[1] ?? best.rank} at`;
  return {
    label: arch.name,
    detail: `${best.player} ${placing} ${best.event} (${best.date}) · MTGTop8`,
    cards,
    commander,
    book,
  };
}

/** Any commander, with EDHREC's average deck for it: overall, or for one
    bracket. A bracket nobody has registered a deck at falls back to the
    overall average, and the detail line says so. */
export async function deckFromEdhrec(commander: string, level: EdhrecLevel | null): Promise<PracticeDeck | null> {
  let avg = level ? await fetchAverageDeck(commander, level) : null;
  const fellBack = !!level && !avg;
  if (!avg) avg = await fetchAverageDeck(commander, null);
  if (!avg) return null;
  const lines = [...avg.commanders.map((name) => ({ name, quantity: 1 })), ...avg.cards];
  const lookup = await lookupCollection([...new Set(lines.map((l) => l.name))]);
  const outs = lines.map((l) => ({ line: l, out: lookup.found.get(normalizeCardKey(l.name)) }));
  const facts = await cardFactsByIds(outs.flatMap((o) => (o.out ? [o.out.id] : [])));
  const book: CardBook = {};
  const cards: PracticeDeck["cards"] = [];
  for (const { line, out } of outs) {
    if (!out) continue;
    book[out.name.toLowerCase()] = infoFrom(facts.get(out.id), out);
    const have = cards.find((c) => c.name === out.name);
    if (have) have.quantity += line.quantity;
    else cards.push({ name: out.name, imageUri: out.imageUri, typeLine: out.typeLine, quantity: line.quantity });
  }
  const commanders = avg.commanders.flatMap((name) => {
    const out = lookup.found.get(normalizeCardKey(name));
    return out ? [out.name] : [];
  });
  if (!commanders.length || cards.length < 30) return null;
  const at = level && !fellBack ? `Bracket ${EDHREC_LEVELS[level].bracket} (${EDHREC_LEVELS[level].label}) average` : "Average";
  const of = avg.decks ? ` of ${avg.decks.toLocaleString("en-US")} decks` : "";
  return {
    label: commanders.join(" + "),
    detail: `${at} deck${of} · EDHREC${fellBack ? ` · no ${EDHREC_LEVELS[level!].label} decks yet` : ""}`,
    cards,
    commander: commanders.join(" + "),
    book,
  };
}

/** The MTGTop8 format for a deck's format: cEDH for Commander. */
export function mtgtop8FormatFor(format: string): string | null {
  const f = format.toLowerCase();
  if (f === "commander") return "cedh";
  return MTGTOP8_FORMATS[f] ? f : null;
}
