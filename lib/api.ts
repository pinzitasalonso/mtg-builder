// Parse a positive-integer route param. Returns null on anything else
// ("abc", "1.5", "-2", "") so handlers can 400 instead of leaking a Prisma 500.
export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
