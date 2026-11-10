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

/* Whether `key` has a slot left, without taking it. For limits that should
   only be charged when something goes wrong (a wrong password). */
export function rateLimitHasRoom(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  return (buckets.get(key) ?? []).filter((t) => now - t < windowMs).length < max;
}

/* Wrong passwords for one address, charged on failure only. Two buckets:
   per address and IP (5 in 15 minutes), so someone hammering an address
   from one place locks out only themselves, not its owner; and per address
   across every IP (30 an hour), which a spread-out guesser still hits.
   Before, every attempt, right or wrong, spent the address's five: anyone
   could keep a known address locked out with five requests a quarter hour. */
const LOGIN_PAIR: [number, number] = [5, 15 * 60_000];
const LOGIN_ADDRESS: [number, number] = [30, 60 * 60_000];
export function loginAllowed(ip: string, email: string): boolean {
  return rateLimitHasRoom(`auth:login:pair:${email}|${ip}`, ...LOGIN_PAIR) && rateLimitHasRoom(`auth:login:addr:${email}`, ...LOGIN_ADDRESS);
}
export function loginFailed(ip: string, email: string): void {
  rateLimit(`auth:login:pair:${email}|${ip}`, ...LOGIN_PAIR);
  rateLimit(`auth:login:addr:${email}`, ...LOGIN_ADDRESS);
}

/* The client's address, as a rate-limit bucket key (never for auth).

   On Railway it's the FIRST x-forwarded-for entry. The edge writes both
   forwarding headers itself, replacing anything the client sent, so a
   caller can't pick its own bucket. What arrives is "client, edge": the
   second entry is Railway's own hop (a 152.233.x address), the same for
   every visitor, so keying on the last entry would put everyone in one
   bucket. x-real-ip carries the client too, but it has been the edge's
   address on some routes, so it's only the fallback. Checked on production
   through the admin page's last line, November 2026. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/* The AI is for signed-in players only. Guests used to share a small
   per-minute budget, but it had no daily ceiling, reset on every restart and
   spent the site's own Anthropic key; an account gives each player a daily
   meter instead (lib/limits). */
export const SIGN_IN_FOR_AI_MSG = "Sign in to use the AI — it's free, and you get a few questions a day.";

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
  // Per IP only here; the per-address limits are loginAllowed/loginFailed.
  login: [10, 5 * 60_000, 0, 0],
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
