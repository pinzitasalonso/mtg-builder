// The home assistant: one conversation across all of a player's decks and
// their collection. Pure helpers shared by /api/assistant and the client.

export interface AssistantCard {
  name: string;
  quantity: number;
  // What the model reads beside each deck card, when known.
  manaValue?: number | null;
  type?: string | null; // the type line's main half: "Legendary Creature"
  role?: string | null; // ramp / draw / removal / wincon / utility / land
  usd?: string | null;
}

export interface AssistantDeck {
  publicId: string;
  name: string;
  format: string;
  commander: string | null;
  // The decklist proper, and the candidate pile beside it.
  deck: AssistantCard[];
  pool: AssistantCard[];
  // "Score 6.5 (speed 7, …) · bracket 3 · wins around turn 8", when scanned.
  score?: string | null;
  versions?: number;
}

// Pool candidates listed per deck. The deck board is always listed in full;
// pools can run to hundreds of cards and matter less to cross-deck questions.
const MAX_POOL_NAMES = 60;

const target = (format: string) => (format.toLowerCase() === "commander" ? 100 : 60);
const list = (cards: { name: string; quantity: number }[]) =>
  cards.map((c) => (c.quantity > 1 ? `${c.quantity} ${c.name}` : c.name)).join("; ");

/** One deck card with what's known about it: "2 Sol Ring (mv 1, Artifact,
 *  ramp, $1.90)". The detail is what lets the model reason about curve, roles
 *  and cost without a lookup per card. */
export function cardLine(c: AssistantCard): string {
  const bits = [
    c.manaValue != null ? `mv ${c.manaValue}` : null,
    c.type || null,
    c.role || null,
    c.usd ? `$${c.usd}` : null,
  ].filter(Boolean);
  return `${c.quantity > 1 ? `${c.quantity} ` : ""}${c.name}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

/** The deck's cost: the sum of known prices times copies. */
export function deckPrice(cards: AssistantCard[]): { total: number; priced: number } {
  let total = 0;
  let priced = 0;
  for (const c of cards) {
    const p = c.usd ? Number(c.usd) : NaN;
    if (Number.isFinite(p)) { total += p * c.quantity; priced += c.quantity; }
  }
  return { total, priced };
}

/** Every deck, as the model reads it: a heading with the link to use, then
 *  the list. Sorted by name so the block is byte-stable between turns (it's a
 *  cached prompt block). */
export function buildDecksBlock(decks: AssistantDeck[]): string {
  if (decks.length === 0) return "THE PLAYER'S DECKS: none yet.";
  const sorted = [...decks].sort((a, b) => a.name.localeCompare(b.name) || a.publicId.localeCompare(b.publicId));
  const parts = sorted.map((d) => {
    const count = d.deck.reduce((s, c) => s + c.quantity, 0);
    const price = deckPrice(d.deck);
    const head =
      `### ${d.name} — id: ${d.publicId} — link: [${d.name}](/deck/${d.publicId})\n` +
      `Format: ${d.format}` +
      (d.commander ? ` · Commander: ${d.commander}` : "") +
      ` · ${count}/${target(d.format)} cards in the deck` +
      (price.priced ? ` · about $${price.total.toFixed(2)} (${price.priced} cards priced)` : "") +
      (d.versions ? ` · ${d.versions} saved version${d.versions === 1 ? "" : "s"}` : "") +
      (d.score ? `\nDeck Score: ${d.score}` : "\nDeck Score: not scanned yet");
    const deck = d.deck.length ? `\nDeck: ${d.deck.map(cardLine).join("; ")}` : "\nDeck: (empty)";
    const poolShown = d.pool.slice(0, MAX_POOL_NAMES);
    const more = d.pool.length - poolShown.length;
    const pool = d.pool.length
      ? `\nPool (candidates, not in the deck yet): ${list(poolShown)}${more > 0 ? `; …and ${more} more` : ""}`
      : "";
    return head + deck + pool;
  });
  return `THE PLAYER'S DECKS (${decks.length}):\n\n${parts.join("\n\n")}`;
}

/** A deck link the model wrote — [Deck Name](/deck/<publicId>) — rewritten as
 *  a card-style token the shared Markdown parser already understands, so the
 *  renderer can tell it apart. Links anywhere else stay as their label. */
export function rewriteDeckLinks(md: string): string {
  return md
    .replace(/\[([^\]\n]+)\]\(\/deck\/([A-Za-z0-9_-]+)\)/g, (_, label: string, id: string) => `[[@deck:${id}|${label.replace(/\|/g, "/")}]]`)
    .replace(/\[([^\]\n]+)\]\((?:https?:\/\/|\/)[^)\s]*\)/g, "$1");
}

/** The deck behind a rewritten token, or null for a real card name. */
export function deckRef(token: string): { id: string; label: string } | null {
  const m = token.match(/^@deck:([A-Za-z0-9_-]+)\|(.+)$/);
  return m ? { id: m[1], label: m[2] } : null;
}

/** Sent in an assistant's stream when a tool changed a deck, so the client
 *  refreshes. Invisible (U+2063), and stripped before anything is shown. */
export const DECKS_CHANGED = "\u2063decks-changed\u2063";
