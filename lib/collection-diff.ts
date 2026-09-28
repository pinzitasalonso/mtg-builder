/* A deck's cards less the ones you own, copy for copy: a deck running 30
   Mountains when you own 10 keeps 20; a card you own at least as many of
   drops out. Names match case- and spacing-insensitively. Pure, so it's
   tested on its own. */

const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export function withoutOwned<T extends { name: string; quantity: number }>(cards: T[], owned: { name: string; quantity: number }[]): T[] {
  const left = new Map<string, number>();
  for (const o of owned) left.set(key(o.name), (left.get(key(o.name)) ?? 0) + Math.max(0, o.quantity));
  const out: T[] = [];
  for (const c of cards) {
    const k = key(c.name);
    const have = left.get(k) ?? 0;
    const need = c.quantity - have;
    left.set(k, Math.max(0, have - c.quantity));
    if (need > 0) out.push({ ...c, quantity: need });
  }
  return out;
}
