import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { aiRemaining, scansRemaining } from "@/lib/limits";

export const runtime = "nodejs";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null });
  // Clients render plan state from this: null limits mean unlimited (pro).
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      tier: user.tier,
      aiRemaining: aiRemaining(user),
      scansRemaining: scansRemaining(user),
      // Decks have no cap on any plan. Still sent, as null ("unlimited"),
      // for the iOS app and any client that reads it.
      deckLimit: null,
      hasPassword: user.hasPassword,
    },
  });
}
