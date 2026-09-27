/* The thread as the model reads it. Pure, so it's tested without a database. */

export interface HistoryRow {
  role: string;
  content: string;
  deck: { publicId: string | null; name: string } | null;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

// How much of the thread the model is sent, newest first. Older turns fall
// off the front, so a long-running conversation never becomes an error.
export const HISTORY_CHARS = 40000;

/** The player's message as the model sees it: marked with the deck that was
 *  on screen when it was sent, so a thread that wanders between decks stays
 *  unambiguous. */
export function markedUserMessage(content: string, deck: { publicId: string | null; name: string } | null): string {
  return deck?.publicId ? `[On screen: ${deck.name} (/deck/${deck.publicId})]\n${content}` : `[On screen: home]\n${content}`;
}

/** The thread as model messages: newest turns within the budget, starting on
 *  a player's message, each of theirs marked with the deck on screen. */
export function historyForModel(rows: HistoryRow[], budget = HISTORY_CHARS): HistoryMessage[] {
  const out: HistoryMessage[] = [];
  let used = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!r.content.trim()) continue;
    const content = r.role === "user" ? markedUserMessage(r.content, r.deck) : r.content;
    if (used + content.length > budget && out.length > 0) break;
    used += content.length;
    out.unshift({ role: r.role === "user" ? "user" : "assistant", content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}
