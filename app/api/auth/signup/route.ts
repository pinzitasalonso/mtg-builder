import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  EMAIL_RE,
  MIN_PASSWORD,
  createVerifyToken,
  hashPassword,
  normalizeEmail,
  requestOrigin,
} from "@/lib/auth";
import { sendAccountExistsEmail, sendVerificationEmail } from "@/lib/email";
import { recordEvent } from "@/lib/analytics";
import { AUTH_LIMIT_MSG, authRateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Every path answers with the same 201, whether or not the address is already
// taken. It used to 409 on a duplicate, which meant anyone could ask this
// endpoint which of a list of addresses had Spellpool accounts — while login
// went to some trouble not to say. What differs is which email arrives.
export async function POST(req: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD} characters.` }, { status: 400 });
  }
  if (!authRateLimit("signup", clientIp(req), email)) {
    return NextResponse.json({ error: AUTH_LIMIT_MSG }, { status: 429 });
  }

  const origin = requestOrigin(req);
  const existing = await prisma.user.findUnique({ where: { email } });

  let emailSent = true;
  try {
    if (existing?.emailVerifiedAt) {
      // A real account. Don't touch it — just tell its owner someone tried.
      await sendAccountExistsEmail(email, `${origin}/login`);
    } else {
      // New, or signed up before and never verified. Either way the next step
      // is the same link, so a lost verification email isn't a dead end.
      //
      // The stored password is deliberately NOT overwritten for an existing
      // unverified account. Letting a second signup reset it would mean I
      // could set a password on your address before you register, wait for
      // you to click the verification link that arrives, and then sign in
      // with the password I chose. Someone who has genuinely forgotten an
      // unverified account's password uses the reset flow, which verifies
      // the address in the same step.
      const user =
        existing ??
        // Ownerless decks are PUBLIC decks now — no adoption on signup.
        (await prisma.user.create({ data: { email, passwordHash: hashPassword(password) } }));
      if (!existing) await recordEvent("signup");
      const token = await createVerifyToken(user.id);
      await sendVerificationEmail(email, `${origin}/api/auth/verify?token=${token}`);
    }
  } catch (e) {
    emailSent = false;
    console.error("signup email failed:", e instanceof Error ? e.message : e);
  }

  // No session either way — sign-in stays blocked until the link is clicked.
  return NextResponse.json({ verifyRequired: true, email, emailSent }, { status: 201 });
}
