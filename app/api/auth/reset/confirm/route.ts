import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  MIN_PASSWORD,
  consumeResetToken,
  createSession,
  hashPassword,
  requestOrigin,
  revokeSessions,
} from "@/lib/auth";
import { sendPasswordChangedEmail } from "@/lib/email";
import { AUTH_LIMIT_MSG, authRateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Spends the emailed token and signs the user in. Doubles as "set a password"
// for an account that only ever used Apple or Google: passwordHash was simply
// null, and nothing here cares what it was.
export async function POST(req: Request) {
  let body: { token?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!authRateLimit("reset-confirm", clientIp(req))) {
    return NextResponse.json({ error: AUTH_LIMIT_MSG }, { status: 429 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD} characters.` },
      { status: 400 }
    );
  }

  const user = await consumeResetToken(token);
  if (!user) {
    return NextResponse.json(
      { error: "That link is invalid or has expired. Ask for a new one." },
      { status: 400 }
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(password),
      // Reaching the inbox is the same proof verification asks for, so an
      // account stuck at "check your email" comes out of this verified.
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    },
  });

  // Whoever knew the old password loses their grip, including whoever forced
  // the reset. Done before the new session, so it isn't revoked too.
  await revokeSessions(user.id);
  await createSession(user.id);

  try {
    await sendPasswordChangedEmail(user.email, `${requestOrigin(req)}/login`);
  } catch (e) {
    console.error("password changed notice failed:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ id: user.id, email: user.email });
}
