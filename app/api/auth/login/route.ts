import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createSession, verifyPassword } from "@/lib/auth";
import { recordEvent } from "@/lib/analytics";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  // One generic message for both bad email and bad password — no account
  // enumeration via the error text.
  const user = email && password ? await prisma.user.findUnique({ where: { email } }) : null;
  if (!user || !verifyPassword(password, user.passwordHash)) {
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
