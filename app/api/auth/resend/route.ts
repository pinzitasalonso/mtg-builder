import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createVerifyToken, requestOrigin } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/email";

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
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
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
