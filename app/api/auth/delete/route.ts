import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser, destroySession, verifyPassword } from "@/lib/auth";
import { AUTH_LIMIT_MSG, authRateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Permanent account deletion. App Store guideline 5.1.1(v) requires any app
// that creates accounts to offer this in-app, so this is not optional before
// the next submission.
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "auth required" }, { status: 401 });

  let body: { password?: unknown; confirm?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!authRateLimit("delete", clientIp(req))) {
    return NextResponse.json({ error: AUTH_LIMIT_MSG }, { status: 429 });
  }

  // A deliberate second signal, so a stray POST can't empty an account.
  if (body.confirm !== "DELETE") {
    return NextResponse.json({ error: "Deletion not confirmed." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: me.id } });
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });

  // An account with a password has to produce it. One that only ever used
  // Apple or Google has nothing to prove beyond the session it holds.
  const password = typeof body.password === "string" ? body.password : "";
  if (user.passwordHash && !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "That password doesn't match." }, { status: 403 });
  }

  // Decks, cards, collection, play codes, sessions, linked accounts and auth
  // codes all cascade from this one row.
  await prisma.user.delete({ where: { id: user.id } });
  await destroySession();

  return NextResponse.json({ ok: true });
}
