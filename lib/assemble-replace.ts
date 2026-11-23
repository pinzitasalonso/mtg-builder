import prisma from "@/lib/prisma";
import { newPublicId } from "@/lib/deck-id";
import { snapshotDeck } from "@/lib/deck-versions";
import { fitsIdentity, isBasicLand, singletonCapped } from "@/lib/format";
import { asOwned, ownedPrintingsFor } from "@/lib/owned-printings";
import { lookupCollection, normalizeCardKey as key, type CollectionLookup, type OutCard } from "@/lib/scryfall";

/* "Replace what I haven't found", from the Assemble deck tool.

   Building a deck in cardboard, some cards never turn up: lent out, in
   another deck, never owned. This finds, for each card that isn't ticked, a
   card the player DOES have that does the same job, and makes the deck with
   those instead. The picking is the model's (it knows what the cards do; the
   collection only stores names, costs and types). Everything around it is
   here: which cards count as missing, which of the collection is on offer,
   and checking the model's answer before any of it is believed. */

/** A card of the deck that isn't ticked, and can be swapped. */
export interface MissingCard {
  id: number;
  name: string;
  quantity: number;
  typeLine: string | null;
  manaCost: string | null;
  oracleText: string | null;
  role: string | null;
}

/** A card of the collection that could go in. */
export interface Candidate {
  name: string;
  typeLine: string | null;
  manaCost: string | null;
  /** Copies owned that aren't in another of the player's decks. */
  free: number;
}

export interface ReplaceContext {
  format: string;
  commander: string | null;
  /** The commander's colours (WUBRG letters); null outside Commander. */
  identity: string | null;
  missing: MissingCard[];
  /** The rest of the decklist, by name: what the replacements play with. */
  kept: string[];
  candidates: Candidate[];
  /** Cards in the collection at all, so "nothing fits" and "no collection" read differently. */
  collectionSize: number;
}

/** What the model is asked to pick from, at the most. A big collection is
    thinned to the kinds of card that are missing. */
export const MAX_CANDIDATES = 2000;

const KINDS = ["Land", "Creature", "Artifact", "Enchantment", "Planeswalker", "Battle", "Instant", "Sorcery"] as const;
const kindsOf = (typeLine: string | null): string[] => KINDS.filter((k) => new RegExp(`\\b${k}\\b`).test((typeLine ?? "").split(" // ")[0]));

/** The names of a deck's commanders ("A + B" for partners), as keys. */
export function commanderKeys(deck: { format: string; commander: string | null }): Set<string> {
  if (deck.format.toLowerCase() !== "commander") return new Set();
  return new Set((deck.commander ?? "").split("+").map((n) => key(n)).filter(Boolean));
}

/** A card that can be swapped for another: not the commander (the deck is
    built on it) and not a basic land (everybody has those). */
export function replaceable(card: { name: string; typeLine: string | null }, commanders: Set<string>): boolean {
  return !commanders.has(key(card.name)) && !isBasicLand(card.typeLine);
}

/**
 * The collection, cut down to what could replace a missing card: cards the
 * deck doesn't already play, inside the commander's colours, with a copy that
 * isn't sitting in another deck. Lands are only offered for lands, and spells
 * for spells. The kinds that are missing come first, so thinning a big
 * collection drops what's least likely to be wanted.
 */
export function candidatesFrom(
  collection: { name: string; quantity: number; typeLine: string | null; manaCost: string | null; colorIdentity: string | null }[],
  opts: { inDeck: Set<string>; usedElsewhere: Map<string, number>; identity: string | null; missing: { typeLine: string | null }[] }
): Candidate[] {
  const wanted = new Map<string, number>();
  for (const m of opts.missing) for (const k of kindsOf(m.typeLine)) wanted.set(k, (wanted.get(k) ?? 0) + 1);
  const wantsLand = wanted.has("Land");
  const wantsSpell = opts.missing.some((m) => !kindsOf(m.typeLine).includes("Land"));

  const out: (Candidate & { fit: number })[] = [];
  for (const c of collection) {
    // Not matched to a real card (yet): nothing to judge it by.
    if (!c.typeLine) continue;
    if (isBasicLand(c.typeLine)) continue;
    const k = key(c.name);
    if (opts.inDeck.has(k)) continue;
    if (opts.identity !== null && !fitsIdentity(c.colorIdentity, opts.identity)) continue;
    const free = c.quantity - (opts.usedElsewhere.get(k) ?? 0);
    if (free <= 0) continue;
    const kinds = kindsOf(c.typeLine);
    const land = kinds.includes("Land");
    if (land ? !wantsLand : !wantsSpell) continue;
    out.push({ name: c.name, typeLine: c.typeLine, manaCost: c.manaCost, free, fit: Math.max(0, ...kinds.map((kind) => wanted.get(kind) ?? 0)) });
  }
  out.sort((a, b) => b.fit - a.fit || a.name.localeCompare(b.name));
  return out.slice(0, MAX_CANDIDATES).map(({ fit: _fit, ...c }) => c);
}

/** Everything a plan needs from the database, for one of the player's decks. */
export async function replaceContext(deck: { id: number; format: string; commander: string | null }, userId: number): Promise<ReplaceContext> {
  const commanders = commanderKeys(deck);
  const rows = await prisma.poolCard.findMany({
    where: { deckId: deck.id, board: "deck" },
    select: { id: true, name: true, quantity: true, typeLine: true, manaCost: true, oracleText: true, role: true, assembled: true, colorIdentity: true },
    orderBy: { name: "asc" },
  });
  const missing = rows.filter((r) => !r.assembled && replaceable(r, commanders)).map(({ assembled: _a, colorIdentity: _c, ...m }) => m);
  const missingIds = new Set(missing.map((m) => m.id));
  const kept = rows.filter((r) => !missingIds.has(r.id)).map((r) => r.name);

  const isCommander = deck.format.toLowerCase() === "commander";
  const identity = isCommander ? [...new Set(rows.filter((r) => commanders.has(key(r.name))).flatMap((r) => [...(r.colorIdentity ?? "")]))].join("") : null;

  const [collection, elsewhere] = await Promise.all([
    prisma.collectionCard.findMany({ where: { userId }, select: { name: true, quantity: true, typeLine: true, manaCost: true, colorIdentity: true } }),
    // Copies already in the player's other decklists: those aren't spare.
    prisma.poolCard.groupBy({ by: ["name"], where: { board: "deck", deck: { userId, id: { not: deck.id } } }, _sum: { quantity: true } }),
  ]);
  const usedElsewhere = new Map(elsewhere.map((e) => [key(e.name), e._sum.quantity ?? 0]));
  // A commander deck with no commander card on it yet has no colours to hold candidates to.
  const candidates = candidatesFrom(collection, { inDeck: new Set(rows.map((r) => key(r.name))), usedElsewhere, identity: isCommander && commanders.size ? identity : null, missing });
  return { format: deck.format, commander: deck.commander, identity, missing, kept, candidates, collectionSize: collection.length };
}

// ── What the model is asked, and what it may answer ───────────────────

export const REPLACE_INSTRUCTIONS = `You help a Magic: The Gathering player finish building a deck out of the cards they own.

They are assembling the deck in cardboard. Some of its cards they could not find. For each of those, pick ONE replacement from the list of cards in their collection, so the deck still works.

How to pick:
- The replacement does the same job in this deck. Ramp for ramp, card draw for card draw, removal for removal, a board wipe for a board wipe, a tutor for a tutor, a win condition or payoff for one that fits the same plan.
- A land replaces a land, and should make the colours the deck needs. A spell is never replaced by a land.
- Prefer a similar mana value. A two-mana rock is not replaced by a six-mana one.
- Prefer cards that work with the commander and with the cards the deck keeps.
- Among cards that do the job, pick the strongest.
- When nothing in the collection does the same job, pick the card that helps this deck most. Give null only when nothing in the list is worth playing here.

Rules:
- Use each collection card at most once, and only cards from the list, spelled exactly as listed.
- Answer for every missing card, in the order given.
- "why" is one short phrase a player understands at a glance, such as "also a two-mana rock" or "another instant-speed removal". No more than ten words.`;

export const REPLACE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["swaps"],
  properties: {
    swaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["out", "in", "why"],
        properties: {
          out: { type: "string", description: "The missing card's name, exactly as given." },
          in: { anyOf: [{ type: "string" }, { type: "null" }], description: "A card from the collection list, exactly as listed, or null." },
          why: { type: "string" },
        },
      },
    },
  },
} as const;

const line = (c: { name: string; manaCost: string | null; typeLine: string | null }) => `${c.name} | ${c.manaCost || "-"} | ${c.typeLine ?? "?"}`;

export function replacePrompt(ctx: ReplaceContext): string {
  const missing = ctx.missing
    .map((m) => `- ${line(m)}${m.role ? ` | ${m.role}` : ""}${m.oracleText ? ` | ${m.oracleText.replace(/\s+/g, " ").slice(0, 240)}` : ""}`)
    .join("\n");
  return [
    `Format: ${ctx.format}${ctx.commander ? `\nCommander: ${ctx.commander}` : ""}${ctx.identity !== null ? `\nColour identity: ${ctx.identity || "colourless"}` : ""}`,
    `The deck keeps these cards:\n${ctx.kept.join(", ") || "(none)"}`,
    `MISSING (${ctx.missing.length}), to replace (name | cost | type | role | text):\n${missing}`,
    `THE COLLECTION (${ctx.candidates.length}), to pick from (name | cost | type):\n${ctx.candidates.map(line).join("\n")}`,
  ].join("\n\n");
}

/** One swap the player can take or leave. */
export interface Swap {
  /** The missing card's row. */
  outId: number;
  out: string;
  in: string;
  why: string;
}

/**
 * The model's answer, believed only as far as it can be checked: a missing
 * card that is one, a replacement that is on offer, and no card promised
 * twice. Anything else is dropped, and that card stays as it is.
 */
export function cleanSwaps(raw: unknown, ctx: Pick<ReplaceContext, "missing" | "candidates">): Swap[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { swaps?: unknown }).swaps) ? ((raw as { swaps: unknown[] }).swaps as unknown[]) : [];
  const missing = new Map(ctx.missing.map((m) => [key(m.name), m]));
  const offered = new Map(ctx.candidates.map((c) => [key(c.name), c]));
  const usedOut = new Set<number>();
  const usedIn = new Set<string>();
  const swaps: Swap[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { out, in: into, why } = item as { out?: unknown; in?: unknown; why?: unknown };
    if (typeof out !== "string" || typeof into !== "string") continue;
    const from = missing.get(key(out));
    const to = offered.get(key(into));
    if (!from || !to || usedOut.has(from.id) || usedIn.has(key(to.name))) continue;
    usedOut.add(from.id);
    usedIn.add(key(to.name));
    swaps.push({ outId: from.id, out: from.name, in: to.name, why: typeof why === "string" ? why.trim().slice(0, 120) : "" });
  }
  return swaps;
}

/** Is this card allowed in a deck of this format? Unknown is allowed: missing data never blocks. */
export function legalIn(card: Pick<OutCard, "legalities" | "colorIdentity">, format: string, identity: string | null): boolean {
  const status = card.legalities?.[format.toLowerCase()];
  if (status && status !== "legal" && status !== "restricted") return false;
  return identity === null || fitsIdentity(card.colorIdentity, identity);
}

// ── Making the deck ───────────────────────────────────────────────────

export type ApplyResult =
  | { ok: true; deck: string; replaced: number; skipped: string[]; version: string | null }
  | { ok: false; error: string; status: number };

/**
 * Make the swaps the player kept. `as` says where: in this deck (the list as
 * it is now is saved as a version first, so it can be put back), or in a new
 * deck that is this one with the swaps made, this one left alone.
 *
 * Nothing is taken on trust from the request: each swap is checked again
 * against the deck and the collection as they are now, and each replacement
 * is looked up on Scryfall before anything changes, so an outage leaves the
 * deck untouched.
 */
export async function applyReplacements(
  deck: { id: number; publicId: string | null; name: string; format: string; commander: string | null; primer: string | null },
  userId: number,
  wanted: { outId: number; in: string }[],
  as: "deck" | "copy",
  lookup: (names: string[]) => Promise<CollectionLookup> = lookupCollection
): Promise<ApplyResult> {
  const ctx = await replaceContext(deck, userId);
  const missing = new Map(ctx.missing.map((m) => [m.id, m]));
  const offered = new Map(ctx.candidates.map((c) => [key(c.name), c]));
  const usedIn = new Set<string>();
  const swaps: { out: MissingCard; to: Candidate }[] = [];
  for (const w of wanted) {
    const out = missing.get(w.outId);
    const to = offered.get(key(w.in));
    if (!out || !to || usedIn.has(key(to.name)) || swaps.some((s) => s.out.id === out.id)) continue;
    usedIn.add(key(to.name));
    swaps.push({ out, to });
  }
  if (!swaps.length) return { ok: false, error: "None of those swaps can be made any more. Look for replacements again.", status: 400 };

  const found = await lookup(swaps.map((s) => s.to.name));
  if (found.failed.length) return { ok: false, error: "Scryfall didn't answer, so nothing was changed. Try again in a moment.", status: 502 };
  const owned = await ownedPrintingsFor(userId, swaps.map((s) => s.to.name));

  // The replacement cards, as rows. One that Scryfall doesn't know, or that
  // the format doesn't allow, is skipped: its missing card stays.
  const skipped: string[] = [];
  const made: { outId: number; card: OutCard & { scryfallId: string }; quantity: number }[] = [];
  for (const s of swaps) {
    const card = found.found.get(key(s.to.name));
    if (!card || !legalIn(card, ctx.format, ctx.identity)) {
      skipped.push(s.to.name);
      continue;
    }
    const mine = asOwned({ ...card, scryfallId: card.id }, owned);
    const quantity = singletonCapped(ctx.format, card.typeLine) ? 1 : Math.max(1, Math.min(s.out.quantity, s.to.free));
    made.push({ outId: s.out.id, card: mine, quantity });
  }
  if (!made.length) return { ok: false, error: "None of those cards can go in this deck.", status: 400 };

  const rowOf = (m: (typeof made)[number]) => ({
    scryfallId: m.card.scryfallId,
    name: m.card.name,
    imageUri: m.card.imageUri,
    manaCost: m.card.manaCost,
    typeLine: m.card.typeLine,
    oracleText: m.card.oracleText,
    colorIdentity: m.card.colorIdentity,
    legalities: m.card.legalities ? JSON.stringify(m.card.legalities).slice(0, 4000) : null,
    board: "deck",
    quantity: m.quantity,
  });
  const outIds = new Set(made.map((m) => m.outId));
  const all = await prisma.poolCard.findMany({ where: { deckId: deck.id } });
  // A replacement may already be in the deck's pool (the pile of maybes),
  // or share a printing with a row there: that row is the one to use.
  const incoming = new Set(made.flatMap((m) => [key(m.card.name), m.card.scryfallId]));
  const clash = (c: { name: string; scryfallId: string; board: string }) => c.board !== "deck" && (incoming.has(key(c.name)) || incoming.has(c.scryfallId));

  if (as === "copy") {
    const copy = await prisma.deck.create({
      data: {
        name: `${deck.name} (from my collection)`.slice(0, 120),
        format: deck.format,
        commander: deck.commander,
        primer: deck.primer,
        userId,
        publicId: newPublicId(),
        cards: {
          create: [
            // The deck as it is, ticks and all, less what is being replaced.
            ...all
              .filter((c) => !outIds.has(c.id) && !clash(c))
              .map((c) => ({
                scryfallId: c.scryfallId,
                name: c.name,
                imageUri: c.imageUri,
                manaCost: c.manaCost,
                typeLine: c.typeLine,
                oracleText: c.oracleText,
                quantity: c.quantity,
                board: c.board,
                role: c.role,
                colorIdentity: c.colorIdentity,
                legalities: c.legalities,
                printingPinned: c.printingPinned,
                assembled: c.assembled,
              })),
            ...made.map(rowOf),
          ],
        },
      },
    });
    return { ok: true, deck: copy.publicId!, replaced: made.length, skipped, version: null };
  }

  const backup = await snapshotDeck(deck.id, `Before replacing ${made.length} missing card${made.length === 1 ? "" : "s"}`);
  if (!backup.ok) return { ok: false, error: `${backup.error} (The deck as it is now is saved first, so you can go back.)`, status: 400 };
  await prisma.$transaction([
    prisma.poolCard.deleteMany({ where: { deckId: deck.id, OR: [{ id: { in: [...outIds] } }, { id: { in: all.filter(clash).map((c) => c.id) } }] } }),
    ...made.map((m) => prisma.poolCard.create({ data: { deckId: deck.id, ...rowOf(m) } })),
  ]);
  return { ok: true, deck: deck.publicId!, replaced: made.length, skipped, version: backup.version.label };
}
