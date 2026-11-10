// Parse a positive-integer route param. Returns null on anything else
// ("abc", "1.5", "-2", "") so handlers can 400 instead of leaking a Prisma 500.
export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The request's JSON body as an object: {} when it's missing, malformed, or
    not an object (a bare `null` or a list used to throw in handlers that read
    a field off it, which came back as a 500). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function jsonBody(req: Request): Promise<Record<string, any>> {
  const v = await req.json().catch(() => null);
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

// ── What a client may store about a card ──────────────────────────────────

/** A card's picture: Scryfall's (its image CDN or its API), or Gatherer's.
    Stored URLs are shown to everyone who can see the deck, so an arbitrary
    one would let a deck's editor make every viewer's browser call a server of
    their choosing. */
export const isCardImage = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 600 && /^https:\/\/(([a-z0-9-]+\.)*scryfall\.(io|com)|gatherer\.wizards\.com)\//i.test(v);

/** No longer than a card's own: the longest name is 141 characters, a
    two-faced one twice that; the longest rules text is under 2,000. */
export const CARD_TEXT_MAX = { id: 80, name: 300, manaCost: 120, typeLine: 300, oracleText: 6000 } as const;

const cut = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);

/** A card as a client sent it, cut to size. Null when its id, name or image
    is missing, or the image isn't a card image. */
export function cleanCardInput(c: unknown): { scryfallId: string; name: string; imageUri: string; manaCost: string | null; typeLine: string | null; oracleText: string | null } | null {
  const r = c as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  if (typeof r.scryfallId !== "string" || !r.scryfallId || r.scryfallId.length > CARD_TEXT_MAX.id) return null;
  if (typeof r.name !== "string" || !r.name.trim() || r.name.length > CARD_TEXT_MAX.name) return null;
  if (!isCardImage(r.imageUri)) return null;
  return {
    scryfallId: r.scryfallId,
    name: r.name,
    imageUri: r.imageUri,
    manaCost: cut(r.manaCost, CARD_TEXT_MAX.manaCost),
    typeLine: cut(r.typeLine, CARD_TEXT_MAX.typeLine),
    oracleText: cut(r.oracleText, CARD_TEXT_MAX.oracleText),
  };
}

/** A deck's name, format and commander, cut to size. */
export const DECK_TEXT_MAX = { name: 120, format: 40, commander: 300 } as const;
