import { parseDecklist, type DecklistEntry } from "./decklist";

// Collection exports from the usual apps (Moxfield, ManaBox, Deckbox,
// TCGplayer, Archidekt, Dragon Shield, Delver Lens) are CSV with a header row.
// They agree on nothing but the idea of a name column and a count column, so
// both are found by header, in the order below. The first match wins, which is
// why "simple name" (TCGplayer's clean name) sits ahead of "name" (which there
// carries printing notes like "(Borderless)").
const NAME_HEADERS = ["simple name", "card name", "cardname", "card_name", "name", "card"];
const QTY_HEADERS = ["quantity", "count", "qty", "amount", "copies", "quantityx"];

/** Split CSV text into rows of cells. Handles quoted cells with delimiters,
 *  doubled quotes and line breaks inside them (RFC 4180). */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** Read a CSV collection export, or null when the text isn't one (no header
 *  row with a recognisable name column) so the caller can treat it as a list. */
export function parseCollectionCsv(text: string): DecklistEntry[] | null {
  let body = text.replace(/^﻿/, "");
  // Dragon Shield (and Excel) can open with a "sep=," hint line.
  let hinted: string | null = null;
  const sep = body.match(/^\s*sep=(.)\s*\r?\n/i);
  if (sep) { hinted = sep[1]; body = body.slice(sep[0].length); }

  const firstLine = body.split(/\r?\n/).find((l) => l.trim()) ?? "";
  // A one-column export ("Name" alone) has no delimiter to find; its header is
  // enough to know it's one.
  const oneColumn = NAME_HEADERS.includes(norm(firstLine).replace(/^"|"$/g, ""));
  const delimiter = hinted ?? ([",", ";", "\t"].find((d) => firstLine.includes(d)) || (oneColumn ? "," : null));
  if (!delimiter) return null;

  const rows = splitCsv(body, delimiter).filter((r) => r.some((c) => c.trim()));
  if (rows.length === 0) return null;
  const header = rows[0].map(norm);
  const nameCol = NAME_HEADERS.map((h) => header.indexOf(h)).find((i) => i >= 0);
  if (nameCol === undefined) return null;
  const qtyCol = QTY_HEADERS.map((h) => header.indexOf(h)).find((i) => i >= 0);

  const entries: DecklistEntry[] = [];
  const byName = new Map<string, number>();
  for (const r of rows.slice(1)) {
    // Printing notes in brackets aren't part of the card's name.
    const name = (r[nameCol] ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (!name) continue;
    const n = qtyCol === undefined ? 1 : parseInt((r[qtyCol] ?? "").trim(), 10);
    // A row with an explicit 0 (Deckbox wishlists) owns nothing; a blank or
    // unreadable count means one.
    const qty = Number.isFinite(n) ? n : 1;
    if (qty <= 0) continue;
    // Each printing is its own row; the collection counts by name.
    const k = name.toLowerCase();
    if (byName.has(k)) entries[byName.get(k)!].qty += qty;
    else { byName.set(k, entries.length); entries.push({ name, qty }); }
  }
  return entries;
}

/** Parse whatever was pasted or uploaded: a CSV export, else a plain list. */
export function parseCollectionText(text: string): DecklistEntry[] {
  return parseCollectionCsv(text) ?? parseDecklist(text);
}
