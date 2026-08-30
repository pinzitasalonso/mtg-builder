// Server-side sessions in SQLite, referenced by an httpOnly cookie, plus the
// deck access checks. The pure half — hashing, token minting, validators —
// lives in lib/auth-core.ts and is re-exported here, so every existing import
// from "@/lib/auth" keeps working. Server-only.

import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import {
  RESET_MINUTES,
  SESSION_COOKIE,
  SESSION_DAYS,
  VERIFY_HOURS,
  newToken,
  tokenHash,
} from "@/lib/auth-core";

export * from "@/lib/auth-core";

export async function createSession(userId: number): Promise<void> {
  const token = newToken();
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

/* Drop every session for this user — used when a password changes, so a
   stolen cookie dies with it. `exceptToken` keeps the caller signed in. */
export async function revokeSessions(userId: number, exceptToken?: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { userId, ...(exceptToken ? { id: { not: tokenHash(exceptToken) } } : {}) },
  });
}

/* The raw session token on this request, for revokeSessions' exception. */
export async function currentSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

// Expired rows are only noticed when re-presented, so sessions, OAuth states
// and auth codes would pile up forever. Sweep them on a request that was
// going to hit the database anyway, at most every 15 minutes. Fire and
// forget — a failed sweep must never fail the request that triggered it.
let lastSweep = 0;
function sweepExpired(): void {
  const now = Date.now();
  if (now - lastSweep < 15 * 60_000) return;
  lastSweep = now;
  const cutoff = new Date();
  void Promise.all([
    prisma.session.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    prisma.authCode.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
  ]).catch(() => {});
}

export interface AuthUser {
  id: number;
  email: string;
  tier: string;
  aiDay: string | null;
  aiCount: number;
  // Whether a password is set at all. False for accounts that only ever
  // signed in with Apple or Google, which is what tells the clients not to
  // ask for a current password they don't have.
  hasPassword: boolean;
}

/* The logged-in user, or null. Expired sessions are deleted on sight. */
export async function currentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  sweepExpired();
  const session = await prisma.session.findUnique({
    where: { id: tokenHash(token) },
    include: {
      user: {
        select: { id: true, email: true, tier: true, aiDay: true, aiCount: true, passwordHash: true },
      },
    },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  // Map the hash to a boolean here so no caller can accidentally serialize it.
  const { passwordHash, ...user } = session.user;
  return { ...user, hasPassword: passwordHash !== null };
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

/* ---- email verification ----------------------------------------------- */

/* Issue a fresh verification token for the user (replacing any prior one)
   and return the raw token for the email link. Only the SHA-256 is stored. */
export async function createVerifyToken(userId: number): Promise<string> {
  const token = newToken();
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

/* ---- password reset ---------------------------------------------------- */

/* Issue a reset token, replacing any outstanding one. Only the SHA-256 is
   stored; the raw token goes in the emailed link. */
export async function createResetToken(userId: number): Promise<string> {
  const token = newToken();
  await prisma.user.update({
    where: { id: userId },
    data: {
      resetTokenHash: tokenHash(token),
      resetTokenExpiry: new Date(Date.now() + RESET_MINUTES * 60_000),
    },
  });
  return token;
}

/* Spend a reset token. Returns the user it belonged to, or null if it is
   unknown or expired. Clears the token in the same write, so a link works
   once even if two tabs race it. */
export async function consumeResetToken(token: string) {
  if (!token) return null;
  const user = await prisma.user.findUnique({ where: { resetTokenHash: tokenHash(token) } });
  if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) return null;
  const spent = await prisma.user.updateMany({
    where: { id: user.id, resetTokenHash: tokenHash(token) },
    data: { resetTokenHash: null, resetTokenExpiry: null },
  });
  return spent.count === 1 ? user : null;
}
