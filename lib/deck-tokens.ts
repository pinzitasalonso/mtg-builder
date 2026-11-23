import { isBasicLand } from "@/lib/format";
import { normalizeCardKey as key, SCRYFALL_HEADERS } from "@/lib/scryfall";
import { scryfallFetch } from "@/lib/scryfall-limit";

/* The tokens a deck needs on the table: what its cards make that isn't in
   the deck itself. Treasures and 1/1 Soldiers, but also a planeswalker's
   emblem, the monarch, the initiative's dungeon.

   Scryfall knows this for every card: a card's `all_parts` lists the tokens
   and helper cards printed for it. So a deck's tokens are two lookups: its
   cards (for their parts), then the tokens themselves (for their pictures).
   Both are kept in memory for a day; a deck opened twice asks nothing. */

export interface DeckToken {
  /** What tells one token from another: its name, type, size, colours and text. */
  key: string;
  name: string;
  typeLine: string;
  /** "1/1", or null for a token with no power and toughness. */
  stats: string | null;
  /** WUBRG letters; "" for colourless. */
  colors: string;
  text: string | null;
  imageUri: string | null;
  /** A token goes on the battlefield; an emblem or a marker (the monarch, a dungeon) sits beside it. */
  kind: "token" | "emblem" | "marker";
  /** The deck's cards that make it, A to Z. */
  by: string[];
}

export interface DeckTokens {
  tokens: DeckToken[];
  /** Cards whose text makes a token Scryfall lists no card for: check these by hand. */
  unlisted: string[];
  /** Scryfall didn't answer for some of the deck: the list may be short. */
  incomplete: boolean;
}

interface RawPart {
  id: string;
  component?: string;
  name?: string;
  type_line?: string;
}

interface RawCard {
  id: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  colors?: string[];
  image_uris?: { normal?: string };
  card_faces?: { image_uris?: { normal?: string }; oracle_text?: string; type_line?: string; power?: string; toughness?: string; colors?: string[] }[];
  all_parts?: RawPart[];
}

/** Is this related card something to put on the table? Scryfall marks tokens
    as such; emblems, the monarch and dungeons come as other parts, told by
    their type. A meld partner or a companion card is neither. */
export function isTablePart(part: RawPart): boolean {
  if (part.component === "token") return true;
  return /^(Token|Emblem|Dungeon|Card)\b/.test(part.type_line ?? "");
}

/** Does a card's text make a token? For cards Scryfall lists no token for. */
export function mentionsTokens(oracleText: string | null | undefined): boolean {
  return /\bcreates?\b[^.]*\btokens?\b/i.test(oracleText ?? "");
}

const kindOf = (typeLine: string): DeckToken["kind"] => (/^Emblem\b/.test(typeLine) ? "emblem" : /^(Card|Dungeon)\b/.test(typeLine) ? "marker" : "token");

/**
 * The deck's tokens, from what Scryfall said. `parts` has each card's related
 * table cards, by the card's name key (absent: Scryfall didn't answer for it);
 * `details` has the token cards themselves, by id.
 *
 * A token printed in ten sets is one token: they are merged by what they
 * are, not by which printing a card points at.
 */
export function gatherTokens(cards: { name: string; oracleText: string | null }[], parts: Map<string, RawPart[]>, details: Map<string, RawCard>): DeckTokens {
  const byKey = new Map<string, DeckToken>();
  const unlisted: string[] = [];
  let incomplete = false;
  for (const card of cards) {
    const mine = parts.get(key(card.name)) ?? parts.get(key(card.name.split(" // ")[0]!));
    if (!mine) {
      incomplete = true;
      continue;
    }
    if (!mine.length) {
      if (mentionsTokens(card.oracleText)) unlisted.push(card.name);
      continue;
    }
    for (const part of mine) {
      const d = details.get(part.id);
      const face = d?.card_faces?.[0];
      const name = d?.name ?? part.name ?? "Token";
      const typeLine = d?.type_line ?? part.type_line ?? "Token";
      const power = d?.power ?? face?.power;
      const toughness = d?.toughness ?? face?.toughness;
      const stats = power != null && toughness != null ? `${power}/${toughness}` : null;
      const colors = (d?.colors ?? face?.colors ?? []).join("");
      const text = d?.oracle_text ?? face?.oracle_text ?? null;
      // Without the token's own card (Scryfall didn't answer), its name and type are all there is to go by.
      const k = d ? [name, typeLine, stats ?? "", colors, text ?? ""].join("|").toLowerCase() : [name, typeLine].join("|").toLowerCase();
      if (!d) incomplete = true;
      const token = byKey.get(k) ?? {
        key: k,
        name,
        typeLine,
        stats,
        colors,
        text: text || null,
        imageUri: d?.image_uris?.normal ?? face?.image_uris?.normal ?? null,
        kind: kindOf(typeLine),
        by: [],
      };
      if (!token.by.includes(card.name)) token.by.push(card.name);
      byKey.set(k, token);
    }
  }
  const order = { token: 0, emblem: 1, marker: 2 } as const;
  const tokens = [...byKey.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name) || (a.stats ?? "").localeCompare(b.stats ?? ""));
  for (const t of tokens) t.by.sort((a, b) => a.localeCompare(b));
  return { tokens, unlisted: unlisted.sort((a, b) => a.localeCompare(b)), incomplete };
}

// ── Scryfall ──────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;
const MAX_KEPT = 20_000;
const partsKept = new Map<string, { at: number; parts: RawPart[] }>();
const detailsKept = new Map<string, { at: number; card: RawCard }>();

function keep<T>(map: Map<string, T>, k: string, v: T) {
  if (map.size >= MAX_KEPT) map.delete(map.keys().next().value!);
  map.set(k, v);
}

/** POST /cards/collection, 75 at a time, one more try on a blip. Returns the
    cards found, and whether any batch got no answer. */
async function collection(identifiers: Record<string, string>[]): Promise<{ cards: RawCard[]; failed: boolean }> {
  const cards: RawCard[] = [];
  let failed = false;
  for (let i = 0; i < identifiers.length; i += 75) {
    let data: { data?: RawCard[] } | null = null;
    for (let attempt = 0; attempt < 2 && !data; attempt++) {
      try {
        const res = await scryfallFetch("https://api.scryfall.com/cards/collection", {
          method: "POST",
          headers: { ...SCRYFALL_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ identifiers: identifiers.slice(i, i + 75) }),
        });
        if (res.ok) data = await res.json();
        else if (res.status !== 429 && res.status < 500) break;
      } catch {
        /* a network blip: once more */
      }
    }
    if (data) cards.push(...(data.data ?? []).filter((c) => c?.id));
    else failed = true;
  }
  return { cards, failed };
}

/** The tokens a decklist needs. Basic lands make none, and aren't asked about. */
export async function tokensForDeck(deck: { name: string; typeLine: string | null; oracleText: string | null }[]): Promise<DeckTokens> {
  const cards = deck.filter((c) => !isBasicLand(c.typeLine));
  const now = Date.now();
  const fresh = <T extends { at: number }>(v: T | undefined) => (v && now - v.at < DAY ? v : undefined);

  // 1. Each card's parts. By name: the printing Scryfall answers with is the
  //    newest, and an old printing may list no token at all.
  const names = [...new Map(cards.map((c) => [key(c.name), c.name])).entries()];
  const ask = names.filter(([k]) => !fresh(partsKept.get(k)));
  if (ask.length) {
    const got = await collection(ask.map(([, name]) => ({ name: name.split(" // ")[0]! })));
    for (const c of got.cards) {
      const mine = (c.all_parts ?? []).filter((p) => p.id !== c.id && isTablePart(p));
      for (const k of new Set([key(c.name), key(c.name.split(" // ")[0]!)])) keep(partsKept, k, { at: now, parts: mine });
    }
  }
  const parts = new Map<string, RawPart[]>();
  for (const [k] of names) {
    const kept = fresh(partsKept.get(k));
    if (kept) parts.set(k, kept.parts);
  }

  // 2. The tokens themselves, for their pictures and what they are.
  const ids = [...new Set([...parts.values()].flat().map((p) => p.id))];
  const missing = ids.filter((id) => !fresh(detailsKept.get(id)));
  if (missing.length) {
    const got = await collection(missing.map((id) => ({ id })));
    for (const c of got.cards) keep(detailsKept, c.id, { at: now, card: c });
  }
  const details = new Map<string, RawCard>();
  for (const id of ids) {
    const kept = fresh(detailsKept.get(id));
    if (kept) details.set(id, kept.card);
  }
  return gatherTokens(cards, parts, details);
}

/** For tests: forget what was kept. */
export function forgetTokens(): void {
  partsKept.clear();
  detailsKept.clear();
}
