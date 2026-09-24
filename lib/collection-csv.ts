// A collection exported as CSV — Moxfield, Archidekt, ManaBox, Deckbox,
// TCGplayer, a spreadsheet — read into the same `{name, qty}` entries a
// pasted decklist gives.
//
// Every one of those exports has a header row, and every one names its card
// column something like "Name" and its count column something like "Count"
// or "Quantity"; the rest of the columns (set, condition, foil, price) are
// noise here, because the collection is kept by name only. So the reader
// finds those two columns by their header and ignores everything else. A
// card listed twice — two printings, a foil and a nonfoil — merges into one
// line with the quantities summed, which is what the collection means by it.

import { parseDecklist, type DecklistEntry } from "./decklist";

const NAME_HEADERS = /^(card ?name|name|card)$/;
const QTY_HEADERS = /^(count|quantity|qty|amount|owned|have)$/;

/** RFC 4180 fields for one line: quoted fields may hold the delimiter and doubled quotes. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

interface CsvShape {
  delimiter: string;
  nameIndex: number;
  qtyIndex: number;
}

/**
 * Whether the first non-empty line is a header naming a card column. Tabs
 * count as a delimiter too, for a spreadsheet pasted straight in.
 */
export function csvShape(text: string): CsvShape | null {
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0);
  if (!first) return null;
  for (const delimiter of [",", "\t", ";"]) {
    if (!first.includes(delimiter)) continue;
    const headers = splitCsvLine(first, delimiter).map((h) => h.toLowerCase().replace(/^﻿/, ""));
    const nameIndex = headers.findIndex((h) => NAME_HEADERS.test(h));
    if (nameIndex < 0) continue;
    // Moxfield and Deckbox carry both "Count" and "Tradelist Count"; the
    // plain one is the collection.
    const qtyIndex = headers.findIndex((h) => QTY_HEADERS.test(h));
    return { delimiter, nameIndex, qtyIndex };
  }
  return null;
}

/** Parse a CSV export. Empty when the text has no recognisable header. */
export function parseCollectionCsv(text: string): DecklistEntry[] {
  const shape = csvShape(text);
  if (!shape) return [];
  const entries: DecklistEntry[] = [];
  const byName = new Map<string, number>();
  let seenHeader = false;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    if (!seenHeader) {
      seenHeader = true;
      continue;
    }
    const fields = splitCsvLine(raw, shape.delimiter);
    const name = (fields[shape.nameIndex] ?? "").trim();
    if (!name) continue;
    const qtyRaw = shape.qtyIndex >= 0 ? parseInt(fields[shape.qtyIndex] ?? "", 10) : 1;
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
    const k = name.toLowerCase();
    if (byName.has(k)) {
      entries[byName.get(k)!]!.qty += qty;
    } else {
      byName.set(k, entries.length);
      entries.push({ name, qty });
    }
  }
  return entries;
}

/**
 * Read whatever the player gave us: a CSV export when it has a header, else
 * the "{qty} {name}" decklist format.
 */
export function parseCollectionText(text: string): DecklistEntry[] {
  return csvShape(text) ? parseCollectionCsv(text) : parseDecklist(text);
}
