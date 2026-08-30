import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createSession, normalizeEmail, verifyPassword } from "@/lib/auth";
import { recordEvent } from "@/lib/analytics";
import { AUTH_LIMIT_MSG, authRateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!authRateLimit("login", clientIp(req), email)) {
    return NextResponse.json({ error: AUTH_LIMIT_MSG }, { status: 429 });
  }

  // One generic message for both bad email and bad password — no account
  // enumeration via the error text. verifyPassword runs even when there is no
  // user, so an unknown address costs the same as a known one; without that
  // the error text hides nothing the response time doesn't give away.
  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  const ok = verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !ok) {
    return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  }

  // Only revealed after a correct password, so this leaks nothing new.
  if (!user.emailVerifiedAt) {
    return NextResponse.json(
      { error: "Verify your email first — check your inbox.", unverified: true },
      { status: 403 }
    );
  }

  await createSession(user.id);
  await recordEvent("login");
  return NextResponse.json({ id: user.id, email: user.email });
}
