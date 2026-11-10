// Server side: who a deck can practise against, as the opponent picker
// shows them. Each is a tile with a picture and its colours:
//   - commanders many people play, from EDHREC (a Commander deck);
//   - the format's tournament decks, from MTGTop8 (cEDH for Commander);
//   - the player's own decks, and a mirror match;
//   - the opponents they played lately.

import prisma from "@/lib/prisma";
import { fetchTopCommanders, isEdhrecLevel } from "@/lib/edhrec";
import { bestFinishes, fetchArchetypeDecks, fetchDecklist, parseMtgoList, type ArchetypeShare } from "@/lib/mtgtop8";
import { scanVersionURL } from "@/lib/scan-url";
import { lookupCollection, normalizeCardKey, type OutCard } from "@/lib/scryfall";

export interface OpponentOption {
  kind: "mtgtop8" | "deck" | "edhrec";
  /** mtgtop8: the format and archetype. */
  format?: string;
  archetype?: string;
  /** deck: the deck's id. */
  deck?: string;
  /** edhrec: the commander, and the bracket's level (null: any). */
  commander?: string;
  level?: string | null;
  label: string;
  detail: string;
  /** A picture for its tile: a card's art. */
  image?: string | null;
  /** Its colours, WUBRG letters ("" is colourless). */
  colors?: string | null;
}

const WUBRG = "WUBRG";
const sortColors = (letters: string) => [...WUBRG].filter((c) => letters.includes(c)).join("");
const art = (imageUri: string | null | undefined) => (imageUri ? (scanVersionURL(imageUri, "art_crop") ?? imageUri) : null);
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** An option a client sent, cut to what an option is: it's stored with the
    game, and offered back as a recent opponent. Null when it isn't one. */
export function cleanOpponent(o: unknown): OpponentOption | null {
  const r = o as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const label = text(r.label, 200) ?? "";
  const detail = text(r.detail, 200) ?? "";
  const image = typeof r.image === "string" && /^https:\/\/cards\.scryfall\.io\//.test(r.image) && r.image.length <= 400 ? r.image : null;
  const colors = typeof r.colors === "string" ? sortColors(r.colors.toUpperCase()) : null;
  const face = { label, detail, image, colors };
  if (r.kind === "deck") {
    const deck = text(r.deck, 80);
    return deck ? { kind: "deck", deck, ...face } : null;
  }
  if (r.kind === "mtgtop8") {
    const format = text(r.format, 40);
    const archetype = text(r.archetype, 40);
    return format && archetype ? { kind: "mtgtop8", format, archetype, ...face } : null;
  }
  if (r.kind === "edhrec") {
    const commander = text(r.commander, 200);
    return commander ? { kind: "edhrec", commander, level: isEdhrecLevel(r.level) ? r.level : null, ...face } : null;
  }
  return null;
}

/** The same opponent, whatever its tile said: for telling recent ones apart. */
export const opponentKey = (o: OpponentOption) =>
  o.kind === "deck" ? `deck:${o.deck}` : o.kind === "mtgtop8" ? `mtgtop8:${o.format}:${o.archetype}` : `edhrec:${(o.commander ?? "").toLowerCase()}`;

// ── Cards by name: a picture and colours ──────────────────────────────────
// One Scryfall request for all the names a picker needs, remembered a day.

const FACE_TTL_MS = 24 * 60 * 60 * 1000;
const cardFaces = new Map<string, { at: number; card: OutCard | null }>();

async function cardsByName(names: string[]): Promise<Map<string, OutCard>> {
  const out = new Map<string, OutCard>();
  const ask: string[] = [];
  for (const name of new Set(names)) {
    const hit = cardFaces.get(normalizeCardKey(name));
    if (hit && Date.now() - hit.at < FACE_TTL_MS) {
      if (hit.card) out.set(normalizeCardKey(name), hit.card);
    } else ask.push(name);
  }
  if (ask.length) {
    const lookup = await lookupCollection(ask);
    const failed = new Set(lookup.failed.map(normalizeCardKey));
    for (const name of ask) {
      const k = normalizeCardKey(name);
      const card = lookup.found.get(k) ?? lookup.found.get(normalizeCardKey(name.split(" // ")[0]!)) ?? null;
      // A request that failed isn't remembered: the next picker asks again.
      if (card || !failed.has(k)) cardFaces.set(k, { at: Date.now(), card });
      if (card) out.set(k, card);
    }
    while (cardFaces.size > 4000) cardFaces.delete(cardFaces.keys().next().value!);
  }
  return out;
}

// ── Commanders many people play (EDHREC) ──────────────────────────────────

/** A stable shuffle: the same seed gives the same order. */
export function seededOrder<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A few of the year's most played commanders, a different few each day
    (and for each deck), never the deck's own. Each plays EDHREC's average
    deck; the picker asks which bracket once one is chosen. */
export async function suggestedCommanders(seed: string, exclude: string[], n = 24): Promise<OpponentOption[]> {
  const skip = new Set(exclude.flatMap((c) => c.split("+")).map((c) => normalizeCardKey(c)));
  const top = (await fetchTopCommanders()).slice(0, 60).filter((c) => !skip.has(normalizeCardKey(c.name)));
  const picked = seededOrder(top, seed).slice(0, n);
  if (!picked.length) return [];
  const cards = await cardsByName(picked.map((c) => c.name));
  return picked.map((c): OpponentOption => {
    const card = cards.get(normalizeCardKey(c.name));
    return {
      kind: "edhrec",
      commander: card?.name ?? c.name,
      level: null,
      label: card?.name ?? c.name,
      detail: c.decks ? `${c.decks.toLocaleString("en-US")} decks on EDHREC` : "EDHREC average deck",
      image: art(card?.imageUri),
      colors: card?.colorIdentity ?? null,
    };
  });
}

// ── Tournament decks (MTGTop8) ────────────────────────────────────────────
// A tile's picture and colours come from the archetype's best recent list:
// its commanders (cEDH), or the nonland card it plays the most copies of.
// A commander named by the archetype is one Scryfall lookup, done at once.
// The rest need the list, which is two MTGTop8 pages each, one at a time:
// those are filled in behind the request, and the picker asks again.

interface Face {
  /** The commanders' names, where the archetype's own name doesn't say (partners). */
  label: string | null;
  image: string | null;
  colors: string | null;
}

const ARCH_TTL_MS = 6 * 60 * 60 * 1000;
const archFaces = new Map<string, { at: number; face: Face }>();
const warming = new Set<string>();
const archKey = (format: string, period: string, id: string) => `${format}:${period}:${id}`;

/** "Partner WUBR": the colours are in the name. */
const partnerColors = (name: string) => {
  const m = /^Partner\s+([WUBRG]{1,5})$/i.exec(name.trim());
  return m ? sortColors(m[1]!.toUpperCase()) : null;
};

async function faceFromList(format: string, period: string, arch: ArchetypeShare): Promise<Face | null> {
  const best = bestFinishes((await fetchArchetypeDecks(format, arch.id, period)) ?? [], 1)[0];
  const list = best ? await fetchDecklist(best.deckId) : null;
  if (!list) return null;
  const { main, side } = parseMtgoList(list);
  if (format === "cedh") {
    // In a cEDH list the sideboard is the commander.
    const cards = await cardsByName(side.map((l) => l.name));
    const commanders = side.flatMap((l) => cards.get(normalizeCardKey(l.name)) ?? []);
    if (!commanders.length) return null;
    // A pair goes by first names ("Kraum + Tymna"): two full names don't fit a tile.
    const label = commanders.length > 1 ? commanders.map((c) => c.name.split(",")[0]!.trim()).join(" + ") : commanders[0]!.name;
    return { label, image: art(commanders[0]!.imageUri), colors: sortColors(commanders.map((c) => c.colorIdentity ?? "").join("")) };
  }
  const cards = await cardsByName(main.map((l) => l.name));
  const spells = main.flatMap((l) => {
    const card = cards.get(normalizeCardKey(l.name));
    return card && !/\bLand\b/.test(card.typeLine ?? "") ? [{ card, quantity: l.quantity }] : [];
  });
  if (!spells.length) return null;
  // The card it plays the most of; among those, the first on the list.
  const signature = spells.reduce((a, b) => (b.quantity > a.quantity ? b : a));
  return { label: null, image: art(signature.card.imageUri), colors: sortColors(spells.map((s) => s.card.colorIdentity ?? "").join("")) };
}

/** The format's top archetypes as tiles. `more` says pictures are still
    being fetched: ask again in a few seconds. */
export async function tournamentOptions(format: string, formatLabel: string, period: string, archetypes: ArchetypeShare[]): Promise<{ options: OpponentOption[]; more: boolean }> {
  const fresh = (a: ArchetypeShare) => {
    const hit = archFaces.get(archKey(format, period, a.id));
    return hit && Date.now() - hit.at < ARCH_TTL_MS ? hit.face : null;
  };
  // cEDH archetypes named after their commander: one lookup for them all.
  if (format === "cedh") {
    const named = archetypes.filter((a) => !fresh(a) && !partnerColors(a.name));
    if (named.length) {
      const cards = await cardsByName(named.map((a) => a.name));
      for (const a of named) {
        const card = cards.get(normalizeCardKey(a.name));
        if (card) archFaces.set(archKey(format, period, a.id), { at: Date.now(), face: { label: null, image: art(card.imageUri), colors: card.colorIdentity } });
      }
    }
  }
  // The rest, from their lists, behind this request.
  const missing = archetypes.filter((a) => !fresh(a));
  const job = `${format}:${period}`;
  if (missing.length && !warming.has(job)) {
    warming.add(job);
    void (async () => {
      try {
        for (const a of missing) {
          const face = await faceFromList(format, period, a).catch(() => null);
          // A list that couldn't be read is remembered too, so it isn't asked for on every request.
          archFaces.set(archKey(format, period, a.id), { at: Date.now(), face: face ?? { label: null, image: null, colors: partnerColors(a.name) } });
        }
        while (archFaces.size > 600) archFaces.delete(archFaces.keys().next().value!);
      } finally {
        warming.delete(job);
      }
    })();
  }
  const options = archetypes.map((a): OpponentOption => {
    const face = fresh(a);
    const share = `${Number.isInteger(a.share) ? a.share : a.share.toFixed(1)}% of the ${formatLabel} metagame`;
    return {
      kind: "mtgtop8",
      format,
      archetype: a.id,
      label: face?.label ?? a.name,
      detail: face?.label ? `${a.name} · ${share}` : share,
      image: face?.image ?? null,
      colors: face?.colors ?? partnerColors(a.name),
    };
  });
  return { options, more: missing.length > 0 };
}

// ── The player's own decks ────────────────────────────────────────────────

/** The player's decks of this format that have a decklist, each with its
    commander's art (or, without a commander, the card it plays the most
    of) and its colours. The deck itself comes first, as a mirror match. */
export async function ownDeckOptions(userId: number, deck: { publicId: string; name: string; format: string }): Promise<OpponentOption[]> {
  const mine = await prisma.deck.findMany({
    where: { OR: [{ userId, format: deck.format, cards: { some: { board: "deck" } } }, { publicId: deck.publicId }] },
    select: { id: true, publicId: true, name: true, commander: true },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  const cards = await prisma.poolCard.findMany({
    where: { deckId: { in: mine.map((d) => d.id) }, board: "deck" },
    select: { deckId: true, name: true, imageUri: true, colorIdentity: true, typeLine: true, quantity: true },
  });
  const faceOf = (d: (typeof mine)[number]) => {
    const list = cards.filter((c) => c.deckId === d.id);
    const want = (d.commander ?? "").split("+")[0]!.trim().toLowerCase();
    const spells = list.filter((c) => !/\bLand\b/.test(c.typeLine ?? ""));
    const cover = (want && list.find((c) => c.name.toLowerCase() === want)) || (spells.length ? spells.reduce((a, b) => (b.quantity > a.quantity ? b : a)) : list[0]);
    return { image: art(cover?.imageUri), colors: sortColors(list.map((c) => c.colorIdentity ?? "").join("")) };
  };
  const self = mine.find((d) => d.publicId === deck.publicId);
  return [
    { kind: "deck", deck: deck.publicId, label: "Mirror match", detail: `${deck.name} against itself`, ...(self ? faceOf(self) : {}) },
    ...mine.filter((d) => d.publicId && d.publicId !== deck.publicId).map((d): OpponentOption => ({ kind: "deck", deck: d.publicId!, label: d.name, detail: d.commander ? d.commander : "Your deck", ...faceOf(d) })),
  ];
}

// ── Opponents played lately ───────────────────────────────────────────────

/** The last few different opponents this deck played, newest first. */
export async function recentOpponents(userId: number, deckPublicId: string, n = 4): Promise<OpponentOption[]> {
  const rows = await prisma.practiceGame.findMany({
    where: { userId, deck: deckPublicId, opponent: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { opponent: true },
    take: 30,
  });
  const seen = new Set<string>();
  const out: OpponentOption[] = [];
  for (const r of rows) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(r.opponent ?? "null");
    } catch {
      /* an unreadable row is skipped */
    }
    const o = cleanOpponent(parsed);
    if (!o || seen.has(opponentKey(o))) continue;
    seen.add(opponentKey(o));
    out.push(o);
    if (out.length >= n) break;
  }
  return out;
}
