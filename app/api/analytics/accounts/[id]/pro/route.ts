import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { isAnalyticsAdmin } from "@/lib/analytics";
import { isProOnRevenueCat } from "@/lib/revenuecat";

export const runtime = "nodejs";

// Admin only: re-check one account's Pro with RevenueCat, as the iOS app's
// sync does on sign-in (app/api/subscription/sync). For a web-only account,
// which nothing else re-checks: grant the entitlement in RevenueCat (its
// customer is this account's id), then re-check here. Asking also registers
// the account with RevenueCat if it has never seen it. The tier still comes
// only from RevenueCat, and an indeterminate answer changes nothing.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await currentUser();
  if (!isAnalyticsAdmin(admin?.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, tier: true } });
  if (!user) return NextResponse.json({ error: "No such account." }, { status: 404 });

  const key = process.env.REVENUECAT_API_KEY;
  if (!key) return NextResponse.json({ error: "RevenueCat isn't set up on this server.", tier: user.tier }, { status: 503 });
  const entitled = await isProOnRevenueCat(String(user.id), key);
  if (entitled === null) {
    return NextResponse.json({ error: "RevenueCat didn't give a clear answer, so nothing changed. Try again in a minute.", tier: user.tier }, { status: 502 });
  }
  const tier = entitled ? "pro" : "free";
  if (tier !== user.tier) await prisma.user.update({ where: { id }, data: { tier } });
  console.log(`[admin] re-checked Pro for user ${id}: ${user.tier} -> ${tier}`);
  return NextResponse.json({ tier, was: user.tier });
}
