// The mirror of Paddle's customers and subscriptions, and who has paid access.
// Written only by verified webhooks (lib/paddle-webhook.ts); read by the app.

import prisma from "@/lib/prisma";

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "paused" | "canceled";

/**
 * Whether a subscription grants paid access right now.
 * - active, trialing: yes.
 * - past_due: yes. Paddle is retrying the payment, and cutting a player off
 *   mid-retry punishes a card that expired. If the retries fail, Paddle
 *   cancels the subscription and that event revokes it.
 * - paused, canceled: no.
 * A scheduled cancel or pause changes nothing here: the status stays active
 * until the date arrives, and Paddle sends the change then.
 */
export function grantsAccess(sub: { status: string } | null | undefined): boolean {
  if (!sub) return false;
  return sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
}

interface BillingUser {
  id: number;
  email: string;
}

/**
 * The Paddle customer ids that belong to this account, resolved on the server
 * only. A customer counts when a checkout linked it to the account, or when
 * its email is the account's email and that email is verified (otherwise
 * anyone could sign up with someone else's address and reach their billing).
 */
export async function customerIdsFor(user: BillingUser): Promise<string[]> {
  const verified = await prisma.user.findUnique({ where: { id: user.id }, select: { emailVerifiedAt: true } });
  const rows = await prisma.paddleCustomer.findMany({
    where: {
      OR: [
        { userId: user.id },
        ...(verified?.emailVerifiedAt ? [{ email: user.email.toLowerCase(), userId: null }] : []),
      ],
    },
    select: { customerId: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => r.customerId);
}

/** The account's subscriptions, newest first. */
export async function subscriptionsFor(user: BillingUser) {
  const customerIds = await customerIdsFor(user);
  return prisma.paddleSubscription.findMany({
    where: { OR: [{ userId: user.id }, { customerId: { in: customerIds } }] },
    orderBy: { createdAt: "desc" },
  });
}

/** Whether any of the account's subscriptions grants access now. */
export async function hasPaidAccess(user: BillingUser): Promise<boolean> {
  return (await subscriptionsFor(user)).some(grantsAccess);
}
