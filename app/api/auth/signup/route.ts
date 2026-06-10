import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { EMAIL_RE, MIN_PASSWORD, createVerifyToken, hashPassword, requestOrigin } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/email";

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
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD} characters.` }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const isFirstUser = (await prisma.user.count()) === 0;
  const user = await prisma.user.create({ data: { email, passwordHash: hashPassword(password) } });

  // Decks created before auth existed have no owner; they belong to whoever
  // was running the instance — i.e. the first account created.
  if (isFirstUser) {
    await prisma.deck.updateMany({ where: { userId: null }, data: { userId: user.id } });
  }

  // No session yet — sign-in is blocked until the emailed link is clicked.
  const token = await createVerifyToken(user.id);
  const url = `${requestOrigin(req)}/api/auth/verify?token=${token}`;
  let emailSent = true;
  try {
    await sendVerificationEmail(user.email, url);
  } catch (e) {
    emailSent = false;
    console.error("verification email failed:", e instanceof Error ? e.message : e);
  }
  return NextResponse.json(
    { verifyRequired: true, email: user.email, emailSent },
    { status: 201 }
  );
}
