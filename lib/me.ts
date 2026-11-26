// What the clients read about the signed-in account: GET /api/auth/me,
// and the home page, which renders on the server with it.

import type { AuthUser } from "@/lib/auth";
import { aiRemaining, scansRemaining } from "@/lib/limits";
import { promoteIfSubscribed } from "@/lib/tier";

export async function meOf(user: AuthUser) {
  // A web subscriber whose Pro isn't stored yet gets it now (lib/tier.ts).
  user.tier = await promoteIfSubscribed(user);
  // Clients render plan state from this: null limits mean unlimited (pro).
  return {
    id: user.id,
    email: user.email,
    tier: user.tier,
    aiRemaining: aiRemaining(user),
    scansRemaining: scansRemaining(user),
    // Decks have no cap on any plan. Still sent, as null ("unlimited"),
    // for the iOS app and any client that reads it.
    deckLimit: null,
    hasPassword: user.hasPassword,
  };
}
