/* The card that stands for a deck: on its home tile, at the top of its page
   and in its link preview. One rule for all three, and one that doesn't
   depend on the order the cards happen to arrive in. (The home list used to
   take "the first non-land card" from an unordered query, so two decks that
   shared a card showed the same picture, and neither matched its own page.)

   The commander, when the deck names one and holds it. Otherwise the card of
   the decklist most likely to be what the deck is about: a legendary creature
   or a planeswalker first, then a creature, then any other spell; the one
   that costs most among those; the name breaks a tie. Never a land. */

export interface FaceCard {
  name: string;
  imageUri?: string | null;
  typeLine?: string | null;
  manaCost?: string | null;
  /** "deck" or "pool". A card with no board counts as in the deck. */
  board?: string | null;
}

/** A mana cost's total: "{2}{U}{B}" is 4. Hybrid and X count as their symbols do. */
function manaValue(cost: string | null | undefined): number {
  let total = 0;
  for (const m of (cost ?? "").matchAll(/\{([^}]+)\}/g)) {
    const n = Number(m[1]);
    total += Number.isFinite(n) ? n : m[1] === "X" ? 0 : 1;
  }
  return total;
}

function rank(typeLine: string): number {
  const t = typeLine.toLowerCase();
  const legendary = t.includes("legendary");
  if ((legendary && t.includes("creature")) || t.includes("planeswalker")) return 0;
  if (t.includes("creature")) return 1;
  return 2;
}

export function deckFace<T extends FaceCard>(commander: string | null | undefined, cards: T[]): T | null {
  // A partner pair is "A + B": the first is the face.
  const want = (commander ?? "").split("+")[0]!.trim().toLowerCase();
  if (want) {
    const led = cards.find((c) => c.imageUri && c.name.toLowerCase() === want);
    // A named commander that isn't among the cards has no stored picture:
    // the caller shows it by name.
    return led ?? null;
  }
  let best: T | null = null;
  let bestKey: [number, number, string] | null = null;
  for (const c of cards) {
    if (!c.imageUri || (c.board && c.board !== "deck")) continue;
    const type = c.typeLine ?? "";
    if (type.includes("Land")) continue;
    const key: [number, number, string] = [rank(type), -manaValue(c.manaCost), c.name.toLowerCase()];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = c;
      bestKey = key;
    }
  }
  return best;
}
