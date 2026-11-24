// Web billing with Stripe (Managed Payments: Stripe, through Link, is the
// merchant of record and handles VAT and sales tax). The mirror of Stripe's
// customers and subscriptions is written by verified webhooks
// (lib/stripe-webhook.ts) and read here. User.tier still comes from
// RevenueCat, which reads the same purchases through its Stripe connection.
//
// Server only: it calls Stripe with the secret key.

import type Stripe from "stripe";
import prisma from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { PRO, type BillingInterval } from "@/lib/pricing-tiers";

interface BillingUser {
  id: number;
  email: string;
}

/**
 * Whether a subscription grants paid access right now.
 * - trialing, active: yes.
 * - past_due: yes. Stripe is retrying the payment, and cutting a player off
 *   mid-retry punishes a card that expired. If the retries fail, the
 *   subscription becomes canceled or unpaid, and that event revokes it.
 * - unpaid, paused, canceled, incomplete, incomplete_expired: no.
 * A cancel at the period's end changes nothing here: the status stays active
 * until the date, and Stripe sends the change then.
 */
export function grantsAccess(sub: { status: string } | null | undefined): boolean {
  if (!sub) return false;
  return sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
}

/** The account's subscriptions, newest first. */
export async function subscriptionsFor(user: { id: number }) {
  const customers = await prisma.stripeCustomer.findMany({ where: { userId: user.id }, select: { customerId: true } });
  return prisma.stripeSubscription.findMany({
    where: { OR: [{ userId: user.id }, { customerId: { in: customers.map((c) => c.customerId) } }] },
    orderBy: { createdAt: "desc" },
  });
}

/** Whether any of the account's subscriptions grants access now. */
export async function hasPaidAccess(user: { id: number }): Promise<boolean> {
  return (await subscriptionsFor(user)).some(grantsAccess);
}

/**
 * The account's Stripe customer (cus_…), or null. Resolved on the server from
 * the account alone, so no one can reach another player's billing.
 */
export async function customerIdFor(user: BillingUser): Promise<string | null> {
  const row = await prisma.stripeCustomer.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { customerId: true },
  });
  if (row) return row.customerId;
  // The subscription's event can arrive before the customer's.
  const sub = await prisma.stripeSubscription.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { customerId: true },
  });
  return sub?.customerId ?? null;
}

/**
 * The account's Stripe customer, made on the first checkout. It carries
 * metadata.userId, so every webhook can name the account. The row is written
 * now, not when the webhook arrives, so a second click reuses it; the
 * idempotency key covers two clicks at once. It changes each hour, so a
 * customer Stripe deleted (a data-deletion request) isn't handed back for a
 * day.
 */
export async function ensureCustomer(user: BillingUser): Promise<string> {
  const existing = await customerIdFor(user);
  if (existing) return existing;
  const customer = await stripe().customers.create(
    { email: user.email, metadata: { userId: String(user.id) } },
    { idempotencyKey: `spellpool-customer-${user.id}-${Math.floor(Date.now() / 3_600_000)}` },
  );
  // stripeEventAt at the epoch: the customer's own events, when they come, win.
  await prisma.stripeCustomer.upsert({
    where: { customerId: customer.id },
    create: { customerId: customer.id, email: customer.email, userId: user.id, stripeEventAt: new Date(0) },
    update: {},
  });
  return customer.id;
}

/** Whether a free trial is still on offer: only before the account's first web subscription. */
export async function trialEligible(user: { id: number }): Promise<boolean> {
  return (await subscriptionsFor(user)).length === 0;
}

export interface PlanPrice {
  id: string;
  /** In the currency's smallest unit (cents). Tax is included. */
  unitAmount: number;
  currency: string;
}

let priceCache: { at: number; prices: Record<BillingInterval, PlanPrice> } | null = null;
const PRICE_TTL_MS = 10 * 60 * 1000;

/** Pro's monthly and yearly prices, found by lookup key. Cached for ten minutes. Throws when either is missing. */
export async function planPrices(): Promise<Record<BillingInterval, PlanPrice>> {
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.prices;
  const keys = [PRO.lookupKey.month, PRO.lookupKey.year];
  const list = await stripe().prices.list({ lookup_keys: keys, active: true, limit: 10 });
  const pick = (key: string): PlanPrice => {
    const p = list.data.find((x) => x.lookup_key === key);
    if (!p || p.unit_amount == null) throw new Error(`Stripe has no active price with lookup key ${key}`);
    return { id: p.id, unitAmount: p.unit_amount, currency: p.currency };
  };
  const prices = { month: pick(PRO.lookupKey.month), year: pick(PRO.lookupKey.year) };
  priceCache = { at: Date.now(), prices };
  return prices;
}

/** "€4.99", as the pricing page shows a price. */
export function formatPrice(p: PlanPrice): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: p.currency.toUpperCase() }).format(p.unitAmount / 100);
}

/**
 * A hosted Checkout for Pro, for a signed-in account. The account's id goes
 * in the session's metadata and the subscription's: RevenueCat reads it
 * (its Metadata field key is `userId`) to credit the purchase to the account,
 * and the mirror links rows with it. The server writes it, so it can't be
 * forged by the browser.
 */
export async function createCheckout(user: BillingUser, interval: BillingInterval, origin: string): Promise<string> {
  const [prices, customer, firstTime] = await Promise.all([planPrices(), ensureCustomer(user), trialEligible(user)]);
  const trialDays = firstTime ? PRO.trialDays[interval] : undefined;
  const metadata = { userId: String(user.id) };
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    // Stripe (through Link) sells it and handles tax. Managed Payments
    // replaces automatic_tax, tax_id_collection and payment_method_types,
    // so none of them is sent.
    managed_payments: { enabled: true },
    customer,
    line_items: [{ price: prices[interval].id, quantity: 1 }],
    client_reference_id: String(user.id),
    metadata,
    subscription_data: { metadata, ...(trialDays ? { trial_period_days: trialDays } : {}) },
    success_url: `${origin}/welcome`,
    cancel_url: `${origin}/pricing`,
  };
  const session = await stripe().checkout.sessions.create(params);
  if (!session.url) throw new Error("Stripe returned a checkout session without a URL");
  return session.url;
}

/** A customer-portal link for the account's own customer, or null when it has none. */
export async function portalUrl(user: BillingUser, origin: string): Promise<string | null> {
  const customer = await customerIdFor(user);
  if (!customer) return null;
  const session = await stripe().billingPortal.sessions.create({ customer, return_url: `${origin}/account` });
  return session.url;
}
