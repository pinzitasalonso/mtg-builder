// Matching imported collection rows to Scryfall, as a pure plan the route
// applies in one transaction.
//
// Three outcomes per row, kept apart on purpose:
//   matched  — Scryfall knows the card. The row takes its metadata AND its
//              canonical name, so "Delver of Secrets" becomes "Delver of
//              Secrets // Insectile Aberration", matching what decks store
//              (ownership is a name comparison). If that canonical name is
//              already a row, the two merge: quantities add, one row goes.
//   unknown  — Scryfall answered "no such card", by exact name and by fuzzy
//              search. Marked done with no metadata; the player can ask for
//              another try.
//   neither  — the lookup failed (throttled, down) or wasn't reached this
//              pass. Left untouched, so the next load tries again. Before,
//              a failed request marked the whole batch done with nothing,
//              and those cards stayed blank for good.

export interface StaleRow {
  id: number;
  name: string;
  nameKey: string;
  quantity: number;
}

export interface CardMeta {
  name: string;
  colorIdentity: string | null;
  typeLine: string | null;
  manaCost: string | null;
  imageUri: string | null;
}

export type EnrichOp =
  | { kind: "update"; id: number; data: Partial<CardMeta> & { nameKey?: string; enriched: true } }
  | { kind: "quantity"; id: number; quantity: number }
  | { kind: "delete"; id: number };

/**
 * @param stale     rows awaiting a match
 * @param matched   row id → the card it resolved to
 * @param unknown   row ids Scryfall has no card for
 * @param existing  rows already stored under the canonical keys the matches
 *                  would rename to (the route looks these up), for merging
 */
export function planEnrichment(
  stale: StaleRow[],
  matched: Map<number, CardMeta>,
  unknown: Set<number>,
  existing: { id: number; nameKey: string; quantity: number }[]
): EnrichOp[] {
  const ops: EnrichOp[] = [];
  // Who holds each key once the plan is applied, and their running quantity.
  const holder = new Map<string, { id: number; quantity: number }>();
  for (const r of existing) holder.set(r.nameKey, { id: r.id, quantity: r.quantity });
  // A stale row that already carries its canonical key holds it too; register
  // those first so a rename earlier in the batch merges into them rather than
  // colliding with them.
  for (const r of stale) {
    const card = matched.get(r.id);
    if (card && card.name.toLowerCase() === r.nameKey && !holder.has(r.nameKey)) {
      holder.set(r.nameKey, { id: r.id, quantity: r.quantity });
    }
  }

  for (const r of stale) {
    const card = matched.get(r.id);
    if (!card) {
      if (unknown.has(r.id)) {
        ops.push({ kind: "update", id: r.id, data: { enriched: true, colorIdentity: null, typeLine: null, manaCost: null, imageUri: null } });
      }
      continue;
    }
    const meta = { colorIdentity: card.colorIdentity, typeLine: card.typeLine, manaCost: card.manaCost, imageUri: card.imageUri || null };
    const key = card.name.toLowerCase();
    const h = holder.get(key);
    if (h && h.id !== r.id) {
      // Another row already is this card: fold this one into it.
      h.quantity += r.quantity;
      ops.push({ kind: "quantity", id: h.id, quantity: h.quantity });
      ops.push({ kind: "delete", id: r.id });
      continue;
    }
    ops.push({
      kind: "update",
      id: r.id,
      data: key === r.nameKey ? { ...meta, enriched: true } : { ...meta, name: card.name, nameKey: key, enriched: true },
    });
    if (!h) holder.set(key, { id: r.id, quantity: r.quantity });
  }
  return ops;
}

/** The name a collection row goes by. A reversible printing (the same card on
 *  both sides) is "Hallowed Fountain // Hallowed Fountain" to Scryfall; decks
 *  know it as "Hallowed Fountain", and ownership is a name comparison. */
export function canonicalName(name: string): string {
  const faces = name.split(" // ");
  return faces.length > 1 && faces.every((f) => f === faces[0]) ? faces[0] : name;
}

/** Rows whose name Scryfall doesn't know: done, but with nothing resolved. */
export function isUnrecognised(r: { typeLine: string | null; imageUri: string | null }): boolean {
  return !r.typeLine && !r.imageUri;
}
