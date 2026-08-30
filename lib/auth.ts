// Email + password auth: scrypt hashing (no extra deps) and server-side
// sessions in SQLite, referenced by an httpOnly cookie. Server-only.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

export const SESSION_COOKIE = "sp_session";
const SESSION_DAYS = 30;

// scrypt parameters, recorded in the hash string so they can evolve later.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

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

// The cookie holds the raw token; the DB stores only its SHA-256, so a copy
// of the database alone is not enough to hijack a session.
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await prisma.session.create({ data: { id: tokenHash(token), userId, expiresAt } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { id: tokenHash(token) } });
  store.delete(SESSION_COOKIE);
}

export interface AuthUser {
  id: number;
  email: string;
  tier: string;
  aiDay: string | null;
  aiCount: number;
}

/* The logged-in user, or null. Expired sessions are deleted on sight. */
export async function currentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { id: tokenHash(token) },
    include: { user: { select: { id: true, email: true, tier: true, aiDay: true, aiCount: true } } },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
}

/* Access check for deck-scoped routes. Public decks (userId null) are open
   to everyone — viewing AND editing, by design. Private decks only resolve
   for their owner; for anyone else this returns null and callers 404 (never
   403), so private deck ids aren't probeable. */
export async function accessibleDeck(deckId: number, userId: number | null) {
  return prisma.deck.findFirst({
    where:
      userId === null
        ? { id: deckId, userId: null }
        : { id: deckId, OR: [{ userId: null }, { userId }] },
  });
}

// Same access rules, resolved by the unguessable public id used in URLs.
// EDIT access — the owner (or anyone, for ownerless public decks).
export async function accessibleDeckByPublicId(publicId: string, userId: number | null) {
  if (!publicId || typeof publicId !== "string") return null;
  return prisma.deck.findFirst({
    where:
      userId === null
        ? { publicId, userId: null }
        : { publicId, OR: [{ userId: null }, { userId }] },
  });
}

// VIEW access — everything you can edit, PLUS any deck explicitly shared for
// read-only viewing. Used by the deck GET so a shared link resolves for anyone
// while writes stay gated by accessibleDeckByPublicId.
export async function viewableDeckByPublicId(publicId: string, userId: number | null) {
  if (!publicId || typeof publicId !== "string") return null;
  return prisma.deck.findFirst({
    where:
      userId === null
        ? { publicId, OR: [{ userId: null }, { shared: true }] }
        : { publicId, OR: [{ userId: null }, { userId }, { shared: true }] },
  });
}

// Whether `userId` may EDIT this deck (owner, or an ownerless public deck).
export function canEditDeck(deck: { userId: number | null }, userId: number | null): boolean {
  return deck.userId === null || deck.userId === userId;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;

/* ---- email verification ----------------------------------------------- */

const VERIFY_HOURS = 24;

/* Issue a fresh verification token for the user (replacing any prior one)
   and return the raw token for the email link. Only the SHA-256 is stored. */
export async function createVerifyToken(userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.user.update({
    where: { id: userId },
    data: {
      verifyTokenHash: tokenHash(token),
      verifyTokenExpiry: new Date(Date.now() + VERIFY_HOURS * 3600_000),
    },
  });
  return token;
}

/* Consume a verification token: marks the user verified and clears the
   token. Returns the user, or null if the token is unknown or expired. */
export async function consumeVerifyToken(token: string) {
  if (!token) return null;
  const user = await prisma.user.findUnique({ where: { verifyTokenHash: tokenHash(token) } });
  if (!user || !user.verifyTokenExpiry || user.verifyTokenExpiry < new Date()) return null;
  return prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date(), verifyTokenHash: null, verifyTokenExpiry: null },
  });
}

/* Public origin for links in emails. APP_URL wins (set it in production);
   otherwise reconstructed from proxy headers (Railway) or the Host header. */
export function requestOrigin(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}
