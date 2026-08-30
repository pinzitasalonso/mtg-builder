// Tiny in-memory rate limiter. Per-process state: on a single long-lived
// Railway instance this is exactly right; limits are per-instance and reset on
// redeploy, which is fine for the abuse we throttle here (guest AI spend that
// burns the owner's API key, and play-code guessing). It is NOT a distributed
// quota — if the app is ever scaled to multiple instances, move these buckets
// to a shared store (Redis/DB).

// key → recent hit timestamps (ms), pruned to the caller's window on access.
const buckets = new Map<string, number[]>();
let lastSweep = Date.now();

/* Consume one slot for `key`; returns false when its window is already full. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();

  // Opportunistic GC so the map can't grow without bound: every few minutes,
  // drop any bucket untouched for an hour (stale for every window we use).
  if (now - lastSweep > 5 * 60_000) {
    for (const [k, arr] of buckets) {
      if (arr.length === 0 || now - arr[arr.length - 1] > 3_600_000) buckets.delete(k);
    }
    lastSweep = now;
  }

  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

/* Best-effort client IP, from the proxy's forwarded headers (Railway sets
   x-forwarded-for). Only used as a rate-limit bucket key — never for auth. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

const WINDOW_MS = 60_000;
// Guests all burn the site owner's Anthropic key, so a global ceiling caps the
// total spend, while a tighter per-IP cap keeps one client from eating the
// whole shared budget (which the old single global bucket allowed).
const ANON_GLOBAL_MAX = 6;
const ANON_PER_IP_MAX = 2;

/* Consume one anonymous AI call if BOTH the per-client and the shared budgets
   allow it. Per-IP is checked first, so an abusive client is turned away
   without spending from the shared ceiling. */
export function anonAiAllowed(ip: string): boolean {
  if (!rateLimit(`anon-ai:ip:${ip}`, ANON_PER_IP_MAX, WINDOW_MS)) return false;
  return rateLimit("anon-ai:global", ANON_GLOBAL_MAX, WINDOW_MS);
}

export const ANON_LIMIT_MSG =
  "The free AI budget is busy right now (a couple of calls per minute, shared by all guests). Try again in a minute — or sign in for unlimited use.";

/* ---- auth throttles ----------------------------------------------------- */

// Every auth route was unthrottled: login accepted unlimited password guesses,
// and reset/resend were open "send an email to this address" triggers. Caps
// are deliberately loose enough that a person fumbling their own password
// never meets them.
export type AuthAction =
  | "login"
  | "signup"
  | "resend"
  | "reset-request"
  | "reset-confirm"
  | "password"
  | "delete"
  | "verify"
  | "apple"
  | "oauth-start"
  | "oauth-exchange";

// [per-IP max, per-IP window, per-subject max, per-subject window]. A subject
// bucket of 0 means the action has no meaningful subject to key on.
const AUTH_LIMITS: Record<AuthAction, [number, number, number, number]> = {
  login: [10, 5 * 60_000, 5, 15 * 60_000],
  signup: [5, 15 * 60_000, 3, 60 * 60_000],
  resend: [5, 15 * 60_000, 3, 60 * 60_000],
  "reset-request": [5, 15 * 60_000, 3, 60 * 60_000],
  "reset-confirm": [10, 15 * 60_000, 0, 0],
  password: [10, 15 * 60_000, 0, 0],
  delete: [5, 60 * 60_000, 0, 0],
  verify: [20, 5 * 60_000, 0, 0],
  apple: [20, 5 * 60_000, 0, 0],
  "oauth-start": [20, 5 * 60_000, 0, 0],
  "oauth-exchange": [20, 5 * 60_000, 0, 0],
};

/* Consume one attempt at `action`. The IP bucket is checked first, so an
   abusive client is turned away without spending a victim's per-email budget
   — same ordering, and the same reason, as anonAiAllowed. */
export function authRateLimit(action: AuthAction, ip: string, subject?: string): boolean {
  const [ipMax, ipWindow, subMax, subWindow] = AUTH_LIMITS[action];
  if (!rateLimit(`auth:${action}:ip:${ip}`, ipMax, ipWindow)) return false;
  if (subMax > 0 && subject) {
    if (!rateLimit(`auth:${action}:sub:${subject}`, subMax, subWindow)) return false;
  }
  return true;
}

export const AUTH_LIMIT_MSG = "Too many attempts — try again in a few minutes.";
