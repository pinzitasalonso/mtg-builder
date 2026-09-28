import type { ComboLine } from "./combos";
import type { DeckScan } from "./deck-analysis";

/* What the AI is told when it drafts a deck's primer, and the deck it reads.
   Pure, so it's tested without the model. */

export const PRIMER_INSTRUCTIONS =
  "You write deck primers for Magic: The Gathering decks — the document a player reads to learn how to pilot " +
  "a deck: what it's trying to do, how it wins, what to keep, the lines to know, and what beats it. Write for " +
  "someone about to sit down and play it, from the decklist you're given: be concrete, name the cards, and " +
  "ground every claim in the list. Never recommend cards that aren't in it; this is a guide to the deck as " +
  "built, not a review.\n\n" +
  "STRUCTURE, in GitHub-flavored Markdown, with these ## sections in this order (skip one only if it truly " +
  "doesn't apply):\n" +
  "## The plan — two or three sentences: the deck's identity and how it wins.\n" +
  "## Win conditions — each way the deck actually closes a game, with the cards it takes.\n" +
  "## Opening hands — what to keep and what to mulligan, with example keeps.\n" +
  "## Early, mid and late game — what to do each phase, in short bullets.\n" +
  "## Key combos and lines — the named combos and synergies, step by step where it matters.\n" +
  "## Tutor targets — only if the deck has tutors: what to fetch, and when.\n" +
  "## What to watch out for — the hate, removal and matchups that hurt it, and how to play around them.\n" +
  "## Tips — a few short, specific pointers a new pilot would miss.\n\n" +
  "STYLE: plain, direct sentences; bullets over paragraphs; no fluff, no intro or sign-off, no title line " +
  "(the page already shows the deck's name). Around 500–900 words.\n\n" +
  "CARD NAMES — CRITICAL: write every card name in double square brackets, exactly as printed, every time: " +
  "[[Sol Ring]], never [Sol Ring] and never Sol Ring on its own. The app turns them into card previews.";

export interface PrimerDeck {
  name: string;
  format: string;
  commander: string | null;
  cards: { name: string; quantity: number; manaCost: string | null; typeLine: string | null; oracleText: string | null; role: string | null }[];
  combos: ComboLine[];
  scan: DeckScan | null;
  /** The primer it has now, if any: its intent is kept, not its wording. */
  current: string | null;
  /** Anything the player asked for ("focus on the combo", "shorter"). */
  ask: string;
}

const ORACLE_CHARS = 220;

export function primerPrompt(d: PrimerDeck): string {
  const lines = d.cards.map((c) => {
    const text = (c.oracleText ?? "").replace(/\s+/g, " ").trim();
    const short = text.length > ORACLE_CHARS ? text.slice(0, ORACLE_CHARS) + "…" : text;
    return `${c.quantity > 1 ? `${c.quantity}x ` : ""}${c.name} — ${c.manaCost ?? ""} ${c.typeLine ?? ""}${c.role ? ` [${c.role}]` : ""}${short ? ` :: ${short}` : ""}`
      .replace(/ +/g, " ")
      .trim();
  });
  const total = d.cards.reduce((n, c) => n + c.quantity, 0);
  const parts = [
    `Write the primer for this deck.`,
    `\nDECK: ${d.name} · ${d.format}${d.commander ? ` · commander ${d.commander}` : ""} · ${total} cards`,
    `\nDECKLIST (name — cost type [role] :: rules text):\n${lines.join("\n")}`,
    d.combos.length
      ? `\nCOMBOS it can assemble (Commander Spellbook):\n` + d.combos.slice(0, 15).map((c) => `- ${c.pieces.join(" + ")} → ${c.produces.join(", ") || "?"}`).join("\n")
      : `\nCOMBOS: none found by Commander Spellbook.`,
  ];
  if (d.scan) {
    const s = d.scan.score;
    parts.push(`\nDECK SCORE: ${s.label} out of 10, bracket ${s.bracketFloor}, wins around turn ${s.fundamentalTurn}.`);
  }
  if (d.current?.trim()) {
    parts.push(`\nTHE PRIMER IT HAS NOW — keep what the player meant, write it better, and fill the gaps:\n${d.current.trim().slice(0, 6000)}`);
  }
  if (d.ask) parts.push(`\nTHE PLAYER ASKS: ${d.ask}`);
  return parts.join("\n");
}
