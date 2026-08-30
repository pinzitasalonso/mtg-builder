import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createResetToken, normalizeEmail, requestOrigin } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/email";
import { AUTH_LIMIT_MSG, authRateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Always answers {ok: true}, whether the account exists or the send failed —
// same discipline as /api/auth/resend. Anything else here would turn the
// reset form into an account-existence oracle.
export async function POST(req: Request) {
  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = normalizeEmail(body.email);
  if (!authRateLimit("reset-request", clientIp(req), email)) {
    return NextResponse.json({ error: AUTH_LIMIT_MSG }, { status: 429 });
  }

  if (email) {
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        const token = await createResetToken(user.id);
        // The link lands on a page, not on this API. /api/auth/verify spends
        // its token on GET, so a mail scanner or link preview burns it before
        // the person clicks; a reset link must not be losable that way.
        await sendPasswordResetEmail(user.email, `${requestOrigin(req)}/reset?token=${token}`);
      }
    } catch (e) {
      console.error("reset email failed:", e instanceof Error ? e.message : e);
    }
  }
  return NextResponse.json({ ok: true });
}
