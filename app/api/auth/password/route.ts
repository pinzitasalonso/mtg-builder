import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  MIN_PASSWORD,
  currentSessionToken,
  currentUser,
  hashPassword,
  requestOrigin,
  revokeSessions,
  verifyPassword,
} from "@/lib/auth";
import { sendPasswordChangedEmail } from "@/lib/email";
import { AUTH_LIMIT_MSG, authRateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Change the password while signed in. An account with no password (Apple or
// Google only) is adding one, so it has nothing to prove beyond the session
// it already holds.
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "auth required" }, { status: 401 });

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!authRateLimit("password", clientIp(req))) {
    return NextResponse.json({ error: AUTH_LIMIT_MSG }, { status: 429 });
  }
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD} characters.` },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({ where: { id: me.id } });
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });

  if (user.passwordHash && !verifyPassword(currentPassword, user.passwordHash)) {
    return NextResponse.json({ error: "That password doesn't match." }, { status: 403 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(newPassword) },
  });

  // Everything except the device doing the changing.
  await revokeSessions(user.id, await currentSessionToken());

  try {
    await sendPasswordChangedEmail(user.email, `${requestOrigin(req)}/login`);
  } catch (e) {
    console.error("password changed notice failed:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ ok: true });
}
