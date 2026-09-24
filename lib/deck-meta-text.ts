// The words for a deck page's search and share metadata — pure, so it's
// testable without a database. The lookup lives in lib/deck-meta.ts.

export interface PublicDeckSummary {
  publicId: string;
  name: string;
  format: string;
  commander: string | null;
  count: number;
  colors: string; // WUBRG letters, "" = colorless
  highlights: string[]; // a few non-land cards, for the description
}

const COLOR_WORD: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green" };
const FORMAT_WORD: Record<string, string> = { commander: "Commander", standard: "Standard", modern: "Modern", pioneer: "Pioneer", pauper: "Pauper", legacy: "Legacy", vintage: "Vintage" };

export function formatName(format: string): string {
  return FORMAT_WORD[format.toLowerCase()] ?? format.charAt(0).toUpperCase() + format.slice(1);
}

/** "Kaito, Bane of Nightmares — a 100-card blue-black Commander deck led by …" */
export function deckDescription(d: PublicDeckSummary): string {
  const colors = d.colors ? d.colors.split("").map((c) => COLOR_WORD[c]).filter(Boolean).join("-") : "colorless";
  const lead = d.commander ? ` led by ${d.commander}` : "";
  const with_ = d.highlights.length ? ` Featuring ${d.highlights.join(", ")}.` : "";
  return `A ${d.count}-card ${colors} ${formatName(d.format)} deck${lead}, built on Spellpool.${with_} See the list, curve, combos and Deck Score.`;
}
