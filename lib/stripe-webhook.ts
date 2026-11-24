// What a verified Stripe event does to the mirror (lib/stripe-billing.ts).
//
// Stripe delivers at least once and in any order, so every handler is an
// upsert keyed on Stripe's id, applied only when the event is at least as new
// as the one that last wrote the row (the event's `created`). A repeat
// changes nothing; a late, older event is skipped.

import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { postStripePurchase } from "@/lib/revenuecat";
import { refreshTier } from "@/lib/tier";

export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  const at = new Date(event.created * 1000);
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
    case "customer.subscription.trial_will_end":
      return upsertSubscription(event.data.object, at);
    case "customer.created":
    case "customer.updated":
      return upsertCustomer(event.data.object, at);
    case "customer.deleted":
      // A data-deletion request (Stripe deletes the customer and tells us):
      // our copy goes too. Its subscriptions are canceled by their own events.
      await prisma.stripeCustomer.deleteMany({ where: { customerId: event.data.object.id } });
      return;
    case "checkout.session.completed":
      return linkCheckout(event.data.object);
    default:
      // Not one of ours: acknowledged and ignored.
      return;
  }
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

function idOf(x: string | { id: string } | null | undefined): string | null {
  if (!x) return null;
  return typeof x === "string" ? x : x.id;
}

function dateOf(seconds: number | null | undefined): Date | null {
  return seconds ? new Date(seconds * 1000) : null;
}

// The account named by metadata.userId, when it exists. Only our server
// writes that metadata (on the customer, the checkout and the subscription).
async function accountFrom(metadata: Stripe.Metadata | null | undefined): Promise<number | null> {
  const raw = metadata?.userId;
  if (typeof raw !== "string" || !/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  return user?.id ?? null;
}

async function upsertSubscription(sub: Stripe.Subscription, at: Date): Promise<void> {
  const item = sub.items.data[0];
  const customerId = idOf(sub.customer) ?? "";
  const data = {
    customerId,
    status: sub.status,
    priceId: item?.price.id ?? "",
    productId: idOf(item?.price.product) ?? "",
    interval: item?.price.recurring?.interval ?? "",
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    cancelAt: dateOf(sub.cancel_at),
    currentPeriodEnd: dateOf(item?.current_period_end),
    trialEnd: dateOf(sub.trial_end),
    stripeEventAt: at,
  };
  const updated = await prisma.stripeSubscription.updateMany({
    where: { subscriptionId: sub.id, stripeEventAt: { lte: at } },
    data,
  });
  if (updated.count === 0) {
    try {
      await prisma.stripeSubscription.create({ data: { subscriptionId: sub.id, ...data } });
    } catch (e) {
      // The row exists and is newer than this event: nothing to do.
      if (!isUniqueViolation(e)) throw e;
    }
  }
  const userId = await accountFrom(sub.metadata);
  if (userId) await linkAccount(userId, customerId, sub.id);
  // Pro follows the subscription: on while it grants access, re-read when
  // it stops (lib/tier.ts).
  const linked = await prisma.stripeSubscription.findUnique({ where: { subscriptionId: sub.id }, select: { userId: true } });
  if (linked?.userId) await refreshTier(linked.userId);
}

async function upsertCustomer(c: Stripe.Customer, at: Date): Promise<void> {
  const data = { email: c.email?.toLowerCase() ?? null, stripeEventAt: at };
  const updated = await prisma.stripeCustomer.updateMany({
    where: { customerId: c.id, stripeEventAt: { lte: at } },
    data,
  });
  if (updated.count === 0) {
    try {
      await prisma.stripeCustomer.create({ data: { customerId: c.id, ...data } });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  const userId = await accountFrom(c.metadata);
  if (userId) await linkAccount(userId, c.id, null);
}

// A finished checkout carries the account in its metadata: link its customer
// and subscription, if they aren't linked yet. The rows themselves come from
// the customer and subscription events.
async function linkCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const userId = await accountFrom(session.metadata);
  const customerId = idOf(session.customer);
  if (!userId || !customerId) return;
  const subscriptionId = idOf(session.subscription);
  await linkAccount(userId, customerId, subscriptionId);
  // Hand the purchase to RevenueCat too (its Stripe app's public key), so it
  // shows there and in its charts. A failure is logged, not retried: the
  // tier doesn't depend on it.
  const rcKey = process.env.REVENUECAT_STRIPE_PUBLIC_KEY?.trim();
  if (subscriptionId && rcKey) await postStripePurchase(String(userId), subscriptionId, rcKey);
  await refreshTier(userId);
}

// Fills an empty link only: a row linked to one account never moves to another.
async function linkAccount(userId: number, customerId: string, subscriptionId: string | null): Promise<void> {
  if (customerId) {
    await prisma.stripeCustomer.updateMany({ where: { customerId, userId: null }, data: { userId } });
  }
  if (subscriptionId) {
    await prisma.stripeSubscription.updateMany({ where: { subscriptionId, userId: null }, data: { userId } });
  }
}
