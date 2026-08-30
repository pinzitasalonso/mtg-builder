import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createSession, tokenHash } from "@/lib/auth";
import { AUTH_LIMIT_MSG, authRateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Trade the one-time code from the OAuth redirect for a real session. This is
// the app's own request, so the cookie set here lands in the jar its
// URLSession actually reads.
export async function POST(req: Request) {
  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!authRateLimit("oauth-exchange", clientIp(req))) {
    return NextResponse.json({ error: AUTH_LIMIT_MSG }, { status: 429 });
  }
  const code = typeof body.code === "string" ? body.code : "";
  const expired = { error: "That sign-in expired. Try again." };
  if (!code) return NextResponse.json(expired, { status: 400 });

  // Compare-and-set, the same shape as the AI meter in lib/limits-db.ts: two
  // requests racing the same code cannot both come away with a session.
  const claimed = await prisma.authCode.updateMany({
    where: { id: tokenHash(code), consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) return NextResponse.json(expired, { status: 400 });

  const row = await prisma.authCode.findUnique({
    where: { id: tokenHash(code) },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!row) return NextResponse.json(expired, { status: 400 });

  await createSession(row.userId);
  // Same shape as /api/auth/login, so the iOS client decodes it with the
  // decoder it already has.
  return NextResponse.json({ id: row.user.id, email: row.user.email });
}
