import type Anthropic from "@anthropic-ai/sdk";
import prisma from "@/lib/prisma";
import { newPublicId } from "@/lib/deck-id";
import { singletonCapped } from "@/lib/commander";
import { deckLimitMsg, type TierFields } from "@/lib/limits";
import { proOnSale } from "@/lib/revenuecat";
import { canCreateDeck } from "@/lib/limits-db";
import { snapshotDeck } from "@/lib/deck-versions";
import { lookupCollection, NAMED_GAP_MS, normalizeCardKey, resolveNamedDetailed, SCRYFALL_HEADERS, type OutCard } from "@/lib/scryfall";

// The home assistant's tools: look cards up on Scryfall, and act on the
// player's decks — create one, change one, save a version of one. Every
// change to an existing deck saves a version first, so anything the
// assistant does can be undone from the deck's Versions.

type Board = "deck" | "pool";
export interface ToolOutcome {
  /** What the model reads back. */
  result: string;
  /** A line shown to the player in the reply, for actions. */
  note?: string;
  /** The tool changed a deck (the client refreshes its list). */
  changed?: boolean;
  isError?: boolean;
}

const MAX_LOOKUP = 40;
const MAX_CARDS = 150;
const MAX_FUZZY = 15;

const board = (v: unknown): Board => (v === "pool" ? "pool" : "deck");
const qty = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(99, Math.floor(v)) : 1);
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "card_details",
    description:
      "Look up cards on Scryfall: exact rules text, mana cost and value, type, power/toughness, color identity, " +
      "rarity, legality in the main formats, whether it is on the Commander Game Changers list, its EDHREC " +
      "popularity rank (lower is more played), and current prices. Use it before judging a card's power or cost " +
      "when you are not certain, and for any card you don't know. Up to 40 names per call.",
    input_schema: {
      type: "object",
      properties: { names: { type: "array", items: { type: "string" }, description: "Exact card names." } },
      required: ["names"],
    },
  },
  {
    name: "create_deck",
    description:
      "Create a new deck for the player, with cards. Use when they ask you to build, copy, or branch a deck " +
      "(a 'new version' as its own deck). Put the decklist on board 'deck' and extra candidates on 'pool'. " +
      "Include the commander in the cards. Returns the new deck's link.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        format: { type: "string", description: "commander, standard, modern, pioneer, pauper, legacy, vintage…" },
        commander: { type: "string", description: "Commander name, for commander decks." },
        cards: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              quantity: { type: "integer" },
              board: { type: "string", enum: ["deck", "pool"] },
            },
            required: ["name"],
          },
        },
      },
      required: ["name", "format", "cards"],
    },
  },
  {
    name: "edit_deck",
    description:
      "Change one of the player's existing decks: add cards, remove cards, or move cards between the deck and " +
      "its pool. A version of the deck is saved automatically first, so the player can go back. Only do this " +
      "when the player asked for the change (or clearly agreed to it).",
    input_schema: {
      type: "object",
      properties: {
        deck_id: { type: "string", description: "The deck's id from its heading." },
        add: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, quantity: { type: "integer" }, board: { type: "string", enum: ["deck", "pool"] } },
            required: ["name"],
          },
        },
        remove: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, quantity: { type: "integer", description: "Omit to remove every copy." } },
            required: ["name"],
          },
        },
        move: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, to: { type: "string", enum: ["deck", "pool"] } },
            required: ["name", "to"],
          },
        },
        summary: { type: "string", description: "A few words on the change, for the saved version's label." },
      },
      required: ["deck_id"],
    },
  },
  {
    name: "save_version",
    description: "Save the current state of one of the player's decks as a named version they can compare with or restore later.",
    input_schema: {
      type: "object",
      properties: { deck_id: { type: "string" }, label: { type: "string" } },
      required: ["deck_id", "label"],
    },
  },
];

// ── card_details

interface RawCard {
  id: string;
  name: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  color_identity?: string[];
  rarity?: string;
  legalities?: Record<string, string>;
  game_changer?: boolean;
  edhrec_rank?: number;
  prices?: { usd?: string | null; usd_foil?: string | null; eur?: string | null };
  card_faces?: { name?: string; mana_cost?: string; type_line?: string; oracle_text?: string; power?: string; toughness?: string }[];
  // Filled in when the default printing has no USD price (a promo, say).
  cheapest?: string;
}

// Cards per lookup that get a cheapest-printing search: one request each.
const MAX_PRICE_SEARCHES = 10;

/** The cheapest USD price across a card's paper printings. */
async function cheapestUsd(name: string): Promise<string | null> {
  const q = `!"${name.split(" // ")[0].replace(/"/g, "")}" usd>0 game:paper`;
  try {
    const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=usd&dir=asc`, { headers: SCRYFALL_HEADERS });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: RawCard[] };
    return data.data?.[0]?.prices?.usd ?? null;
  } catch {
    return null;
  }
}

async function fetchRaw(names: string[]): Promise<{ cards: RawCard[]; missing: string[] }> {
  const cards: RawCard[] = [];
  const missing: string[] = [];
  for (let i = 0; i < names.length; i += 75) {
    const chunk = names.slice(i, i + 75);
    let data: { data?: RawCard[]; not_found?: { name?: string }[] } | null = null;
    for (let attempt = 0; attempt < 2 && !data; attempt++) {
      try {
        const res = await fetch("https://api.scryfall.com/cards/collection", {
          method: "POST",
          headers: { ...SCRYFALL_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
        });
        if (res.ok) data = await res.json();
      } catch {
        /* retry once */
      }
      if (!data && attempt === 0) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!data) throw new Error("Scryfall didn't answer.");
    cards.push(...(data.data ?? []));
    missing.push(...(data.not_found ?? []).map((n) => n.name ?? "").filter(Boolean));
  }
  return { cards, missing };
}

function describe(c: RawCard): string {
  const legal = ["commander", "standard", "pioneer", "modern", "legacy", "pauper"]
    .map((f) => `${f}: ${c.legalities?.[f] === "legal" ? "legal" : c.legalities?.[f] === "banned" ? "BANNED" : "no"}`)
    .join(", ");
  const text = c.card_faces?.length
    ? c.card_faces.map((f) => `[${f.name}] ${f.mana_cost ?? ""} ${f.type_line ?? ""} — ${f.oracle_text ?? ""}${f.power ? ` (${f.power}/${f.toughness})` : ""}`).join(" // ")
    : `${c.oracle_text ?? ""}${c.power ? ` (${c.power}/${c.toughness})` : ""}${c.loyalty ? ` (loyalty ${c.loyalty})` : ""}`;
  return [
    `${c.name} — ${c.mana_cost ? `${c.mana_cost} ` : ""}(mv ${c.cmc ?? "?"}) — ${c.type_line ?? ""} — ${c.rarity ?? ""}`,
    `Text: ${text.trim() || "(none)"}`,
    `Color identity: ${(c.color_identity ?? []).join("") || "colorless"} · Game Changer: ${c.game_changer ? "yes" : "no"} · EDHREC rank: ${c.edhrec_rank ?? "unranked"}`,
    `Legal — ${legal}`,
    `Price: ${c.prices?.usd ? `$${c.prices.usd}` : "no USD price"}${c.prices?.usd_foil ? `, foil $${c.prices.usd_foil}` : ""}${c.prices?.eur ? `, €${c.prices.eur}` : ""}` +
      (c.cheapest ? ` · cheapest printing $${c.cheapest}` : ""),
  ].join("\n");
}

async function cardDetails(input: Record<string, unknown>): Promise<ToolOutcome> {
  const names = (Array.isArray(input.names) ? input.names : []).map((n) => str(n)).filter(Boolean).slice(0, MAX_LOOKUP);
  if (names.length === 0) return { result: "No names given.", isError: true };
  const { cards, missing } = await fetchRaw([...new Set(names)]);
  // Scryfall's default printing can be an unpriced promo (Sol Ring's is): price
  // those by their cheapest printing, which is what "what does it cost" means.
  const unpriced = cards.filter((c) => !c.prices?.usd).slice(0, MAX_PRICE_SEARCHES);
  for (const [i, c] of unpriced.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, NAMED_GAP_MS));
    c.cheapest = (await cheapestUsd(c.name)) ?? undefined;
  }
  return {
    result:
      cards.map(describe).join("\n\n") +
      (missing.length ? `\n\nNot found on Scryfall (check the spelling): ${missing.join(", ")}` : ""),
  };
}

// ── resolving names for deck changes

async function resolve(names: string[]): Promise<{ found: Map<string, OutCard>; missing: string[] }> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const { found, notFound, failed } = await lookupCollection(unique);
  if (failed.length) throw new Error("Scryfall didn't answer, so no cards were changed. Try again in a moment.");
  const missing: string[] = [];
  for (const [i, name] of notFound.slice(0, MAX_FUZZY).entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, NAMED_GAP_MS));
    const r = await resolveNamedDetailed(name);
    if (r.status === "ok") found.set(normalizeCardKey(name), r.card);
    else missing.push(name);
  }
  missing.push(...notFound.slice(MAX_FUZZY));
  return { found, missing };
}

/** Add resolved cards to a deck. A card already there (by name) gains copies
 *  and moves to the requested board; singleton formats cap at one. */
async function addCards(deck: { id: number; format: string }, items: { card: OutCard; quantity: number; board: Board }[]) {
  const rows = await prisma.poolCard.findMany({ where: { deckId: deck.id }, select: { id: true, name: true, quantity: true } });
  const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r]));
  let copies = 0;
  for (const { card, quantity, board } of items) {
    const capped = singletonCapped(deck.format, card.typeLine);
    const existing = byName.get(card.name.toLowerCase());
    if (existing) {
      const next = capped ? 1 : existing.quantity + quantity;
      copies += next - existing.quantity;
      await prisma.poolCard.update({ where: { id: existing.id }, data: { quantity: next, board } });
      existing.quantity = next;
      continue;
    }
    const n = capped ? 1 : quantity;
    const created = await prisma.poolCard.upsert({
      where: { deckId_scryfallId: { deckId: deck.id, scryfallId: card.id } },
      update: { quantity: { increment: n }, board },
      create: {
        deckId: deck.id,
        scryfallId: card.id,
        name: card.name,
        imageUri: card.imageUri,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        colorIdentity: card.colorIdentity,
        legalities: card.legalities ? JSON.stringify(card.legalities).slice(0, 4000) : null,
        board,
        quantity: n,
      },
      select: { id: true, name: true, quantity: true },
    });
    byName.set(card.name.toLowerCase(), created);
    copies += n;
  }
  return copies;
}

type CardInput = { name: string; quantity: number; board: Board };
function cardInputs(v: unknown): CardInput[] {
  return (Array.isArray(v) ? v : [])
    .slice(0, MAX_CARDS)
    .map((c) => ({ name: str(c?.name), quantity: qty(c?.quantity), board: board(c?.board) }))
    .filter((c) => c.name);
}

async function ownDeck(userId: number, publicId: string) {
  if (!publicId) return null;
  return prisma.deck.findFirst({ where: { publicId, userId }, select: { id: true, publicId: true, name: true, format: true } });
}

// ── create_deck

async function createDeck(user: { id: number } & TierFields, input: Record<string, unknown>): Promise<ToolOutcome> {
  const name = str(input.name, 80);
  if (!name) return { result: "A deck needs a name.", isError: true };
  if (!(await canCreateDeck(user))) {
    const msg = deckLimitMsg(proOnSale());
    return { result: msg, isError: true, note: `Couldn’t create “${name}”: ${msg}` };
  }
  const format = str(input.format, 30).toLowerCase() || "commander";
  const commander = str(input.commander, 120) || null;
  const cards = cardInputs(input.cards);
  if (commander && !cards.some((c) => c.name.toLowerCase() === commander.toLowerCase())) {
    cards.unshift({ name: commander, quantity: 1, board: "deck" });
  }
  const { found, missing } = await resolve(cards.map((c) => c.name));
  const deck = await prisma.deck.create({
    data: { name, format, commander, userId: user.id, publicId: newPublicId() },
    select: { id: true, publicId: true, name: true, format: true },
  });
  const items = cards
    .map((c) => ({ card: found.get(normalizeCardKey(c.name)), quantity: c.quantity, board: c.board }))
    .filter((x): x is { card: OutCard; quantity: number; board: Board } => Boolean(x.card));
  const copies = await addCards(deck, items);
  const link = `[${deck.name}](/deck/${deck.publicId})`;
  return {
    result: `Created ${link} (id ${deck.publicId}) with ${copies} cards.${missing.length ? ` Not found, so not added: ${missing.join(", ")}.` : ""}`,
    note: `✓ Created ${link} · ${copies} cards${missing.length ? ` · ${missing.length} not found` : ""}`,
    changed: true,
  };
}

// ── edit_deck

async function editDeck(userId: number, input: Record<string, unknown>): Promise<ToolOutcome> {
  const deck = await ownDeck(userId, str(input.deck_id, 40));
  if (!deck?.publicId) return { result: "No deck of the player's has that id.", isError: true };
  const add = cardInputs(input.add);
  const remove = (Array.isArray(input.remove) ? input.remove : [])
    .slice(0, MAX_CARDS)
    .map((c) => ({ name: str(c?.name), quantity: typeof c?.quantity === "number" && c.quantity > 0 ? Math.floor(c.quantity) : null }))
    .filter((c) => c.name);
  const move = (Array.isArray(input.move) ? input.move : [])
    .slice(0, MAX_CARDS)
    .map((c) => ({ name: str(c?.name), to: board(c?.to) }))
    .filter((c) => c.name);
  if (!add.length && !remove.length && !move.length) return { result: "Nothing to change.", isError: true };

  // Resolve before touching anything, so a Scryfall failure changes nothing.
  const { found, missing } = add.length ? await resolve(add.map((c) => c.name)) : { found: new Map<string, OutCard>(), missing: [] };

  const summary = str(input.summary, 60);
  const snap = await snapshotDeck(deck.id, `Before assistant: ${summary || "edit"}`);
  if (!snap.ok) {
    return { result: `Didn't change the deck: couldn't save a version first (${snap.error})`, isError: true };
  }

  const rows = await prisma.poolCard.findMany({ where: { deckId: deck.id }, select: { id: true, name: true, quantity: true } });
  const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r]));
  const notInDeck: string[] = [];
  let removed = 0;
  for (const r of remove) {
    const row = byName.get(r.name.toLowerCase());
    if (!row) { notInDeck.push(r.name); continue; }
    if (r.quantity === null || r.quantity >= row.quantity) {
      await prisma.poolCard.delete({ where: { id: row.id } });
      removed += row.quantity;
      byName.delete(r.name.toLowerCase());
    } else {
      await prisma.poolCard.update({ where: { id: row.id }, data: { quantity: row.quantity - r.quantity } });
      removed += r.quantity;
    }
  }
  let moved = 0;
  for (const m of move) {
    const row = byName.get(m.name.toLowerCase());
    if (!row) { notInDeck.push(m.name); continue; }
    await prisma.poolCard.update({ where: { id: row.id }, data: { board: m.to } });
    moved++;
  }
  const items = add
    .map((c) => ({ card: found.get(normalizeCardKey(c.name)), quantity: c.quantity, board: c.board }))
    .filter((x): x is { card: OutCard; quantity: number; board: Board } => Boolean(x.card));
  const added = await addCards(deck, items);

  const link = `[${deck.name}](/deck/${deck.publicId})`;
  const parts = [added && `+${added} added`, removed && `−${removed} removed`, moved && `${moved} moved`].filter(Boolean).join(" · ");
  return {
    result:
      `Changed ${link}: ${parts || "no changes"}. A version was saved first ("${snap.version.label}").` +
      (missing.length ? ` Not found on Scryfall: ${missing.join(", ")}.` : "") +
      (notInDeck.length ? ` Not in the deck, so skipped: ${notInDeck.join(", ")}.` : ""),
    note: `✓ Edited ${link} · ${parts || "no changes"} · version saved first`,
    changed: true,
  };
}

// ── save_version

async function saveVersion(userId: number, input: Record<string, unknown>): Promise<ToolOutcome> {
  const deck = await ownDeck(userId, str(input.deck_id, 40));
  if (!deck?.publicId) return { result: "No deck of the player's has that id.", isError: true };
  const r = await snapshotDeck(deck.id, str(input.label, 80) || null);
  if (!r.ok) return { result: r.error, isError: true };
  const link = `[${deck.name}](/deck/${deck.publicId})`;
  return {
    result: `Saved a version of ${link}: "${r.version.label ?? "untitled"}" (${r.version.deckCount} cards in the deck).`,
    note: `✓ Saved version “${r.version.label ?? "untitled"}” of ${link}`,
    changed: true,
  };
}

export async function runAssistantTool(
  user: { id: number } & TierFields,
  name: string,
  input: unknown
): Promise<ToolOutcome> {
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  try {
    switch (name) {
      case "card_details":
        return await cardDetails(args);
      case "create_deck":
        return await createDeck(user, args);
      case "edit_deck":
        return await editDeck(user.id, args);
      case "save_version":
        return await saveVersion(user.id, args);
      default:
        return { result: `Unknown tool ${name}.`, isError: true };
    }
  } catch (e) {
    return { result: e instanceof Error ? e.message : "The tool failed.", isError: true };
  }
}
