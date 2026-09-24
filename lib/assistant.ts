// The home assistant: one conversation across all of a player's decks and
// their collection. Pure helpers shared by /api/assistant and the client.

export interface AssistantDeck {
  publicId: string;
  name: string;
  format: string;
  commander: string | null;
  // The decklist proper, and the candidate pile beside it.
  deck: { name: string; quantity: number }[];
  pool: { name: string; quantity: number }[];
}

// Pool candidates listed per deck. The deck board is always listed in full;
// pools can run to hundreds of cards and matter less to cross-deck questions.
const MAX_POOL_NAMES = 60;

const target = (format: string) => (format.toLowerCase() === "commander" ? 100 : 60);
const list = (cards: { name: string; quantity: number }[]) =>
  cards.map((c) => (c.quantity > 1 ? `${c.quantity} ${c.name}` : c.name)).join("; ");

/** Every deck, as the model reads it: a heading with the link to use, then
 *  the list. Sorted by name so the block is byte-stable between turns (it's a
 *  cached prompt block). */
export function buildDecksBlock(decks: AssistantDeck[]): string {
  if (decks.length === 0) return "THE PLAYER'S DECKS: none yet.";
  const sorted = [...decks].sort((a, b) => a.name.localeCompare(b.name) || a.publicId.localeCompare(b.publicId));
  const parts = sorted.map((d) => {
    const count = d.deck.reduce((s, c) => s + c.quantity, 0);
    const head =
      `### ${d.name} — link: [${d.name}](/deck/${d.publicId})\n` +
      `Format: ${d.format}` +
      (d.commander ? ` · Commander: ${d.commander}` : "") +
      ` · ${count}/${target(d.format)} cards in the deck`;
    const deck = d.deck.length ? `\nDeck: ${list(d.deck)}` : "\nDeck: (empty)";
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
