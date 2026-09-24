// One specific printing of a card, as an import names it: a Scryfall id
// (ManaBox), or a set code plus collector number (Moxfield, pasted "(CMR) 472").
export interface PrintingRef {
  id?: string;
  set?: string;
  number?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Set codes are short and plain ("cmr", "p30a", "plst"); anything longer is a
// set NAME (TCGplayer's "Set" column) and can't be looked up as a code.
const SET_CODE = /^[a-z0-9]{2,6}$/i;
const NUMBER = /^[0-9a-z★†-]{1,10}$/i;

/** Build a ref from loose cells, keeping only parts that can be looked up. */
export function printingRef(id?: string | null, set?: string | null, number?: string | null): PrintingRef | undefined {
  const i = id?.trim();
  if (i && UUID.test(i)) return { id: i.toLowerCase() };
  const s = set?.trim();
  const n = number?.trim();
  if (s && n && SET_CODE.test(s) && NUMBER.test(n)) return { set: s.toLowerCase(), number: n.toLowerCase() };
  return undefined;
}

/** The ref as the one-string key it's stored and looked up by. */
export function encodePrinting(p: PrintingRef | undefined | null): string | null {
  if (!p) return null;
  if (p.id) return `id:${p.id}`;
  if (p.set && p.number) return `set:${p.set}:${p.number}`;
  return null;
}

export function decodePrinting(s: string | null | undefined): PrintingRef | null {
  if (!s) return null;
  if (s.startsWith("id:")) return { id: s.slice(3) };
  const m = s.match(/^set:([^:]+):(.+)$/);
  return m ? { set: m[1], number: m[2] } : null;
}

/** The Scryfall id in a card image URL (cards.scryfall.io/…/<id>.jpg). */
export function idFromImageUri(uri: string | null | undefined): string | null {
  const m = uri?.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}
