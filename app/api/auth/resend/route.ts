import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createVerifyToken, normalizeEmail, requestOrigin } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/email";
import { AUTH_LIMIT_MSG, authRateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Re-send the verification email. Always answers the same way, whether the
// account exists, is already verified, or the send fails — no enumeration.
export async function POST(req: Request) {
  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = normalizeEmail(body.email);
  if (!authRateLimit("resend", clientIp(req), email)) {
    // Still the same shape as success — a 429 here would confirm the address
    // is worth retrying, which is exactly what this route refuses to say.
    return NextResponse.json({ ok: true });
  }
  if (email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) {
      try {
        const token = await createVerifyToken(user.id);
        await sendVerificationEmail(user.email, `${requestOrigin(req)}/api/auth/verify?token=${token}`);
      } catch (e) {
        console.error("resend verification failed:", e instanceof Error ? e.message : e);
      }
    }
  }
  return NextResponse.json({ ok: true });
}
