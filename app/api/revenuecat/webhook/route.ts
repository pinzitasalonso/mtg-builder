import { NextResponse } from "next/server";
import { isProOnRevenueCat, userIdFromAppUserId } from "@/lib/revenuecat";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

// RevenueCat posts subscription lifecycle events here (INITIAL_PURCHASE,
// RENEWAL, CANCELLATION, EXPIRATION, …). Rather than encode grant/revoke rules
// per event, we take the app_user_id off the event and re-read the canonical
// entitlement state from RevenueCat, then set that user's tier — immune to
// missed or out-of-order events. app_user_id IS our User.id (the app calls
// Purchases.logIn("<id>")).
//
// Setup: in the RevenueCat dashboard, point the webhook at this URL and set its
// Authorization header to the same secret as REVENUECAT_WEBHOOK_TOKEN. The REST
// re-check uses REVENUECAT_API_KEY (a RevenueCat secret key). Until both env
// vars are set, this endpoint is inert (503).
export async function POST(req: Request) {
  const token = process.env.REVENUECAT_WEBHOOK_TOKEN;
  const secret = process.env.REVENUECAT_API_KEY;
  if (!token || !secret) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  // RevenueCat sends exactly the Authorization header you configure for it.
  if (req.headers.get("authorization") !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const appUserId: unknown = body?.event?.app_user_id;
  const userId = typeof appUserId === "string" ? userIdFromAppUserId(appUserId) : null;
  if (userId === null) {
    // Nothing actionable (a test ping, or a pre-login anonymous id) — 200 so
    // RevenueCat doesn't retry.
    return NextResponse.json({ ok: true });
  }

  // Re-read the canonical entitlement state and mirror it onto the tier.
  const tier = (await isProOnRevenueCat(appUserId as string, secret)) ? "pro" : "free";
  await prisma.user.updateMany({ where: { id: userId }, data: { tier } });
  return NextResponse.json({ ok: true, tier });
}
