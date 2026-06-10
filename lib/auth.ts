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

export function verifyPassword(password: string, stored: string): boolean {
  const [v, nStr, saltB64, hashB64] = stored.split(":");
  if (v !== "s1" || !nStr || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(hashB64, "base64url");
  const actual = scryptSync(password, salt, expected.length, { ...SCRYPT, N: Number(nStr) });
  return timingSafeEqual(actual, expected);
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
}

/* The logged-in user, or null. Expired sessions are deleted on sight. */
export async function currentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { id: tokenHash(token) },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
}

/* Ownership check for deck-scoped routes: the deck, but only if `userId`
   owns it. Returns null for other users' decks — callers 404, never 403,
   so deck ids aren't probeable. */
export async function ownedDeck(deckId: number, userId: number) {
  return prisma.deck.findFirst({ where: { id: deckId, userId } });
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;
