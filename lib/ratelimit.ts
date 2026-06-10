// Tiny in-memory rate limiter for anonymous AI calls: one bucket shared by
// every signed-out visitor, since they all burn the site owner's API key.
// Per-process state — fine on a single long-lived Railway instance.

const WINDOW_MS = 60_000;
const MAX_ANON_CALLS = 2;

let stamps: number[] = [];

/* Consume one anonymous AI call if the shared budget allows it. */
export function anonAiAllowed(): boolean {
  const now = Date.now();
  stamps = stamps.filter((t) => now - t < WINDOW_MS);
  if (stamps.length >= MAX_ANON_CALLS) return false;
  stamps.push(now);
  return true;
}

export const ANON_LIMIT_MSG =
  "The free AI budget is busy right now (a couple of calls per minute, shared by all guests). Try again in a minute — or sign in for unlimited use.";
