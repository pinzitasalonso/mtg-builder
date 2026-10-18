import { printingRef, type PrintingRef } from "./printing";

export interface DecklistEntry {
  name: string;
  qty: number;
  // The exact printing, when the line names one ("(CMR) 472"). A collection
  // import pins it; a deck import ignores it.
  printing?: PrintingRef;
}

// Parse a pasted decklist in the common "{qty}[x] {name} [(SET) 123]" per-line
// format. Lines without a leading count default to qty 1; set/collector-number
// suffixes are stripped; repeated names merge their quantities (first-seen
// order preserved).
export function parseDecklist(text: string): DecklistEntry[] {
  const { deck, pool } = parseDecklistBoards(text);
  return mergeEntries([...deck, ...pool]);
}

/* A section heading, and which board it starts: "Commander", "Deck (99)",
   "Sideboard:", "// Pool", "# Maybeboard", "SIDEBOARD:"… The sideboard,
   maybeboard, considering and pool go to the pool; everything else (the
   commander, the main deck, companions) to the deck. Null when the line
   isn't a heading. A comment line that names no section is a heading for
   nothing ("skip"). */
const POOL_SECTIONS = /^(sideboard|side board|maybeboard|maybe board|maybe|considering|pool|tokens)\b/i;
const DECK_SECTIONS = /^(commanders?|deck|main ?deck|mainboard|main|companions?|lands|creatures|instants|sorceries|artifacts|enchantments|planeswalkers|battles|spells|other)\b/i;
function sectionOf(line: string): "deck" | "pool" | "skip" | null {
  const marked = /^(\/\/|#)/.test(line);
  const label = line.replace(/^(\/\/|#)\s*/, "").replace(/:\s*$/, "").replace(/\s*\(\d+\)\s*$/, "").trim();
  const bare = marked || /:$/.test(line) || /^[A-Za-z ]+(\s*\(\d+\))?$/.test(line);
  if (!bare) return null;
  if (POOL_SECTIONS.test(label)) return "pool";
  if (DECK_SECTIONS.test(label) && (marked || /:$/.test(line) || label.split(/\s+/).length <= 2)) return "deck";
  return marked || /^[A-Za-z ]+:$/.test(line) ? "skip" : null;
}

function mergeEntries(list: DecklistEntry[]): DecklistEntry[] {
  const out: DecklistEntry[] = [];
  const byName = new Map<string, number>();
  for (const e of list) {
    const k = e.name.toLowerCase();
    if (byName.has(k)) out[byName.get(k)!].qty += e.qty;
    else {
      byName.set(k, out.length);
      out.push({ ...e });
    }
  }
  return out;
}

/** A pasted list split into the deck and the pool: lines under a sideboard,
 *  maybeboard, considering or pool heading (or MTGO's "SB:" prefix) are the
 *  pool. Repeats merge within each board. */
export function parseDecklistBoards(text: string): { deck: DecklistEntry[]; pool: DecklistEntry[] } {
  const boards: { deck: DecklistEntry[]; pool: DecklistEntry[] } = { deck: [], pool: [] };
  let board: "deck" | "pool" = "deck";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const section = sectionOf(line);
    if (section === "deck" || section === "pool") {
      board = section;
      continue;
    }
    if (section === "skip") continue;
    // MTGO's "SB: 2 Duress" sideboard prefix.
    const sb = /^SB:\s*/i.test(line);
    const body = line.replace(/^SB:\s*/i, "");
    const m = body.match(/^\s*(\d+)\s*[xX]?\s+(.*)$/);
    const qty = m ? Math.max(1, parseInt(m[1], 10)) : 1;
    const rest = m ? m[2] : body;
    const set = rest.match(/\(([A-Za-z0-9]{2,6})\)\s*([0-9A-Za-z★†-]+)?/);
    const printing = set ? printingRef(null, set[1], set[2]) : undefined;
    const name = rest
      .replace(/\s*\([^)]*\).*$/, "") // "(CMR) 472" set + collector number
      .replace(/\s*\[[^\]]*\]/g, "") // "[CMR]" set codes, "[Ramp]" tags (Deckstats, Archidekt)
      .replace(/\s*\*[A-Za-z]+\*/g, "") // "*F*" / "*E*" foil markers (Moxfield)
      .trim();
    if (!name) continue;
    boards[sb ? "pool" : board].push(printing ? { name, qty, printing } : { name, qty });
  }
  return { deck: mergeEntries(boards.deck), pool: mergeEntries(boards.pool) };
}
