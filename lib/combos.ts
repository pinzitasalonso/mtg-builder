// Combos a deck can actually assemble, from Commander Spellbook.
//
// Their `find-my-combos` endpoint takes the decklist in the request body and
// answers with the combos whose every piece is present, so nothing about a
// player's deck has to be stored anywhere to ask. iOS has called it directly
// since the combo dots shipped; the web goes through our own route instead,
// because a browser calling commanderspellbook.com cross-origin is at the
// mercy of their CORS headers and this way one shape of response is decoded in
// one place.

const ENDPOINT = "https://backend.commanderspellbook.com/find-my-combos/";

export interface ComboLine {
  /** Spellbook's own id ("742-1295"), stable enough to key a list on. */
  id: string;
  /** Printed names of the pieces, in the order Spellbook gives them. */
  pieces: string[];
  /** What it makes: "Win the game", "Infinite mana", "Exile your library". */
  produces: string[];
  /** e.g. "{U}{U}{B}". Empty when the line needs no mana to fire. */
  manaNeeded: string;
  /** Spellbook's step-by-step, newline separated. */
  steps: string;
}

export interface ComboResult {
  combos: ComboLine[];
  /**
   * Whether any assemblable combo needs only two cards.
   *
   * This is the bracket question rather than a curiosity: brackets 1 and 2
   * allow no two-card infinite combo at all, so finding one moves a deck to at
   * least 3 on its own.
   */
  hasTwoCardCombo: boolean;
}

export interface ComboInput {
  name: string;
  quantity: number;
  /** True for a commander, which Spellbook scores differently. */
  isCommander: boolean;
}

interface RawCombo {
  id?: string | number;
  uses?: { card?: { name?: string } }[];
  produces?: { feature?: { name?: string } }[];
  description?: string;
  manaNeeded?: string;
}

/** Normalize Spellbook's shape into ours. Exported for the tests. */
export function normalizeCombos(body: unknown): ComboResult {
  const included = (body as { results?: { included?: RawCombo[] } })?.results?.included;
  if (!Array.isArray(included)) return { combos: [], hasTwoCardCombo: false };

  const combos: ComboLine[] = [];
  let hasTwoCardCombo = false;
  for (const raw of included) {
    const pieces = (raw.uses ?? [])
      .map((u) => u.card?.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    if (pieces.length === 0) continue;
    // Two PIECES, not two rows — a combo listing the same card twice is not a
    // two-card combo, and Spellbook lists each piece once.
    if (pieces.length === 2) hasTwoCardCombo = true;
    combos.push({
      id: String(raw.id ?? pieces.join("|")),
      pieces,
      produces: (raw.produces ?? [])
        .map((p) => p.feature?.name)
        .filter((n): n is string => typeof n === "string" && n.length > 0),
      manaNeeded: typeof raw.manaNeeded === "string" ? raw.manaNeeded : "",
      steps: typeof raw.description === "string" ? raw.description : "",
    });
  }
  return { combos, hasTwoCardCombo };
}

/**
 * Ask Spellbook what this decklist can assemble.
 *
 * Best-effort throughout: any failure returns no combos rather than an error.
 * A deck page that can't reach Spellbook should show no combo section, not a
 * banner about a third party being down.
 *
 * Fewer than two cards can't combo, so that case never leaves the process.
 */
export async function findCombos(cards: ComboInput[]): Promise<ComboResult> {
  const empty: ComboResult = { combos: [], hasTwoCardCombo: false };
  const commanders = cards.filter((c) => c.isCommander).map((c) => ({ card: c.name, quantity: c.quantity }));
  const main = cards.filter((c) => !c.isCommander).map((c) => ({ card: c.name, quantity: c.quantity }));
  if (commanders.length + main.length < 2) return empty;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "spellpool-web/1.0" },
      body: JSON.stringify({ commanders, main }),
      signal: ctl.signal,
    });
    if (!res.ok) return empty;
    return normalizeCombos(await res.json());
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}
