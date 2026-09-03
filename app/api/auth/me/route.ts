import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { FREE_DECK_LIMIT, aiRemaining, isPro, scansRemaining } from "@/lib/limits";

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
      deckLimit: isPro(user) ? null : FREE_DECK_LIMIT,
      hasPassword: user.hasPassword,
    },
  });
}
