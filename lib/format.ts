// Pure format rules, safe to import from client components. lib/commander.ts
// re-exports these for the API routes (it pulls in Prisma, so client code
// imports from here instead).

// Basic lands are the only cards that may stack in a singleton deck.
export function isBasicLand(typeLine: string | null | undefined): boolean {
  return !!typeLine && /\bbasic\b/i.test(typeLine) && /\bland\b/i.test(typeLine);
}

// In commander (a singleton format) only one copy of any non-basic card is
// allowed. Returns true when this card must be capped at a single copy; other
// formats (standard, …) allow playsets, so nothing is capped there.
export function singletonCapped(format: string, typeLine: string | null | undefined): boolean {
  return format.toLowerCase() === "commander" && !isBasicLand(typeLine);
}

/**
 * Whether a card may lead a Commander deck on its own: a legendary creature
 * (the front face, for a double-faced card), or any card whose text says it
 * "can be your commander" (some planeswalkers, vehicles, spacecraft…).
 */
export function canBeCommander(typeLine: string | null | undefined, oracleText?: string | null): boolean {
  if (oracleText && /can be your commander/i.test(oracleText)) return true;
  const front = (typeLine ?? "").split(" // ")[0];
  return /\blegendary\b/i.test(front) && /\bcreature\b/i.test(front);
}

/** A legendary Background: a commander only beside one that says "Choose a Background". */
export function isBackground(typeLine: string | null | undefined): boolean {
  return /\blegendary\b/i.test(typeLine ?? "") && /\bbackground\b/i.test(typeLine ?? "");
}

/** Whether a card's colour identity fits inside the commander's (WUBRG letters). */
export function fitsIdentity(cardIdentity: string | null | undefined, commanderIdentity: string): boolean {
  if (!cardIdentity) return true; // colourless, or unknown: not ours to reject
  return [...cardIdentity.toUpperCase()].every((c) => commanderIdentity.toUpperCase().includes(c));
}
