export interface DecklistEntry {
  name: string;
  qty: number;
}

// Parse a pasted decklist in the common "{qty}[x] {name} [(SET) 123]" per-line
// format. Lines without a leading count default to qty 1; set/collector-number
// suffixes are stripped; repeated names merge their quantities (first-seen
// order preserved).
export function parseDecklist(text: string): DecklistEntry[] {
  const entries: DecklistEntry[] = [];
  const byName = new Map<string, number>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\s*(\d+)\s*[xX]?\s+(.*)$/);
    const qty = m ? Math.max(1, parseInt(m[1], 10)) : 1;
    const name = (m ? m[2] : line).replace(/\s*\([^)]*\).*$/, "").trim();
    if (!name) continue;
    const k = name.toLowerCase();
    if (byName.has(k)) {
      entries[byName.get(k)!].qty += qty;
    } else {
      byName.set(k, entries.length);
      entries.push({ name, qty });
    }
  }
  return entries;
}
