// What User.tier should be. Pro comes from two places: RevenueCat (the iOS
// app's purchases, and web purchases once RevenueCat has them) and Spellpool's
// own mirror of Stripe (web purchases, lib/stripe-billing.ts). An account is
// Pro while either says so. The Stripe side is checked here directly, so a web
// subscriber is Pro the moment Stripe's webhook arrives, and a RevenueCat
// answer that hasn't caught up can't switch them back to free.

import prisma from "@/lib/prisma";
import { isProOnRevenueCat } from "@/lib/revenuecat";
import { hasPaidAccess } from "@/lib/stripe-billing";

export type TierName = "pro" | "free";

/**
 * The tier from both sources. `revenueCat` is isProOnRevenueCat's answer:
 * null means it couldn't tell, and then, unless Stripe grants access, the
 * answer is null too: change nothing.
 */
export async function resolveTier(userId: number, revenueCat: boolean | null): Promise<TierName | null> {
  if (await hasPaidAccess({ id: userId })) return "pro";
  if (revenueCat === null) return null;
  return revenueCat ? "pro" : "free";
}

/**
 * Re-reads the account's tier and stores it, after its Stripe subscription
 * changed. RevenueCat is only asked when Stripe grants nothing (a canceled or
 * unpaid subscription); without a clear answer from it, nothing changes.
 */
export async function refreshTier(userId: number): Promise<TierName | null> {
  let tier: TierName | null;
  if (await hasPaidAccess({ id: userId })) {
    tier = "pro";
  } else {
    const key = process.env.REVENUECAT_API_KEY;
    tier = await resolveTier(userId, key ? await isProOnRevenueCat(String(userId), key) : null);
  }
  if (tier) await prisma.user.updateMany({ where: { id: userId, NOT: { tier } }, data: { tier } });
  return tier;
}

/**
 * For a free account with an active web subscription (one that subscribed
 * before Pro was read from Stripe, or whose webhook is late): make it Pro now.
 * Cheap — two small queries — and never downgrades.
 */
export async function promoteIfSubscribed(user: { id: number; tier: string }): Promise<string> {
  if (user.tier === "pro") return user.tier;
  if (!(await hasPaidAccess(user))) return user.tier;
  await prisma.user.updateMany({ where: { id: user.id }, data: { tier: "pro" } });
  return "pro";
}
