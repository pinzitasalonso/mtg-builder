// The half of auth that touches neither Prisma nor next/headers: password
// hashing, token minting, and the small validators. Split out so it can be
// unit-tested — importing lib/auth.ts drags in the database and the request
// context, same reason lib/limits.ts is separate from lib/limits-db.ts.
//
// Keep this file free of `@/` imports. There is no vitest config in the repo,
// so no path alias resolves under the test runner.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "sp_session";
export const SESSION_DAYS = 30;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;

export const VERIFY_HOURS = 24;
// Shorter than verification: a reset link is a live key to the account, and
// unlike verification it can be requested for an address you don't own.
export const RESET_MINUTES = 60;

// scrypt parameters, recorded in the hash string so they can evolve later.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* Tokens live in cookies, URLs and request bodies; the database only ever
   stores this digest, so a copy of the database alone replays nothing. */
export const tokenHash = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const newToken = (): string => randomBytes(32).toString("base64url");

/* Email as we store and compare it. Anything that isn't a string is "", which
   every caller then rejects on EMAIL_RE. */
export function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `s1:${SCRYPT.N}:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

// A real s1 hash of a value nobody knows. Checking against it costs the same
// ~56ms of scrypt as a genuine check, so "no such account", "that account has
// no password" and "wrong password" are indistinguishable by timing. Without
// it, skipping the hash for an unknown email leaks which addresses exist.
const DUMMY_HASH =
  "s1:16384:BivtZzfMNLvWrXs16r1nuQ:YKFT8tHZCbWNcpz2L4HwfARrd9C4d901pEssoTwFdMY7Xa9mmBc9e5MxF2OgVT8KHtByrhQs1P1EztbWRy1ITQ";

/* Check a password against a stored hash. `stored` is null for accounts that
   only ever signed in with Apple or Google — they always fail, but they burn
   the same time doing it. */
export function verifyPassword(password: string, stored: string | null): boolean {
  const target = stored ?? DUMMY_HASH;
  const [v, nStr, saltB64, hashB64] = target.split(":");
  if (v !== "s1" || !nStr || !saltB64 || !hashB64) {
    // Still spend the time, so a corrupt hash isn't a fast "no" either.
    scryptSync(password, Buffer.alloc(16), SCRYPT.keylen, SCRYPT);
    return false;
  }
  // N arrives as text from the database; a wild value would hang the process.
  const n = Number(nStr);
  if (!Number.isInteger(n) || n < 1024 || n > 1 << 20) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(hashB64, "base64url");
  const actual = scryptSync(password, salt, expected.length, { ...SCRYPT, N: n });
  const match = timingSafeEqual(actual, expected);
  return stored !== null && match;
}

/* Public origin for links in emails and OAuth redirect_uris. APP_URL wins (set
   it in production); otherwise reconstructed from proxy headers (Railway) or
   the Host header. Google compares redirect_uri byte for byte, so drift here
   breaks sign-in rather than merely looking wrong. */
export function requestOrigin(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/* Where a post-sign-in redirect may land. Only a path on our own origin: a
   bare "//evil.com" is protocol-relative and would leave the site, so the
   second character has to be checked too. */
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.includes("\\") || raw.includes("\n") || raw.includes("\r")) return "/";
  return raw;
}
