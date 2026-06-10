import { NextResponse } from "next/server";
import { consumeVerifyToken, createSession, requestOrigin } from "@/lib/auth";

export const runtime = "nodejs";

// Landing for the emailed link. Success verifies AND signs the user in
// (they just proved control of the inbox), so they land on their decks.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const origin = requestOrigin(req);
  const user = await consumeVerifyToken(token);
  if (!user) {
    return NextResponse.redirect(`${origin}/login?verify=invalid`, 303);
  }
  await createSession(user.id);
  return NextResponse.redirect(`${origin}/`, 303);
}
