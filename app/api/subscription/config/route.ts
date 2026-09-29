import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { webPaywallKey } from "@/lib/revenuecat";

export const runtime = "nodejs";

// GET /api/subscription/config — what the web paywall needs to open, read at
// request time so setting REVENUECAT_WEB_KEY in Railway takes effect on the
// next deploy without anything baked into the client bundle.
//
// `appUserId` is the RevenueCat identity, and it is the numeric User.id as a
// string — the same one the iOS app logs in with — so a purchase on either
// client lands on the one account, and the webhook resolves it back to us.
// `email` fills the checkout so it doesn't ask again.
//
// A null `apiKey` means the paywall isn't offered on the web (see
// webPaywallKey); a null `appUserId` means signed out — buying needs an
// account to attach Pro to.
export async function GET() {
  const user = await currentUser();
  return NextResponse.json({
    apiKey: webPaywallKey(process.env.REVENUECAT_WEB_KEY, process.env.NODE_ENV === "production"),
    appUserId: user ? String(user.id) : null,
    email: user?.email ?? null,
    tier: user?.tier ?? null,
  });
}
