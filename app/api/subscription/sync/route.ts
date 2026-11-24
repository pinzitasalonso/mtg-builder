import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isProOnRevenueCat } from "@/lib/revenuecat";
import prisma from "@/lib/prisma";
import { resolveTier } from "@/lib/tier";

export const runtime = "nodejs";

// POST /api/subscription/sync — the signed-in app asking us to re-check its
// subscription with RevenueCat right now. Belt-and-suspenders for the webhook:
// the app calls this straight after a purchase (so the user sees Pro without
// waiting on the webhook) and on login (to reconcile a purchase made before it
// was signed in). Entitlement state still comes only from RevenueCat, never the
// client. Returns the resolved tier so the client can update immediately.
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });

  const secret = process.env.REVENUECAT_API_KEY;
  // Not configured yet — report the tier as-is rather than downgrade anyone.
  if (!secret) return NextResponse.json({ tier: user.tier });

  // Indeterminate (bad key / RC outage) also changes nothing: keep the stored
  // tier rather than stamping a paying subscriber back to free.
  // A web (Stripe) subscription counts too (lib/tier.ts).
  const tier = await resolveTier(user.id, await isProOnRevenueCat(String(user.id), secret));
  if (tier === null) return NextResponse.json({ tier: user.tier });

  if (tier !== user.tier) {
    await prisma.user.update({ where: { id: user.id }, data: { tier } });
  }
  return NextResponse.json({ tier });
}
