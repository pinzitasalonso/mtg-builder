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
