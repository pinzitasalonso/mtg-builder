#!/usr/bin/env node
// Creates Spellpool Pro in a Stripe account (sandbox or live), once:
// the product, with the tax code Managed Payments needs, and its two prices,
// found by lookup key (lib/pricing-tiers.ts). Run again, it changes nothing.
//
//   STRIPE_SECRET_KEY=sk_live_… node scripts/stripe-setup.mjs
//   STRIPE_SECRET_KEY=sk_live_… node scripts/stripe-setup.mjs --webhook https://www.spellpool.com/api/stripe/webhook
//
// With --webhook it also makes the webhook endpoint with the events the app
// reads, and prints its signing secret once (STRIPE_WEBHOOK_SECRET).

import Stripe from "stripe";

const PRODUCT = {
  name: "Spellpool Pro",
  description: "Unlimited deck coach, practice matches and Deck Score scans.",
  // Software as a service (SaaS) - personal use.
  tax_code: "txcd_10103000",
  metadata: { app: "spellpool" },
};
// The same amounts as the iOS app. Tax is included in the price.
const PRICES = [
  { lookup_key: "spellpool_pro_monthly", nickname: "Spellpool Pro monthly", interval: "month", unit_amount: 499 },
  { lookup_key: "spellpool_pro_yearly", nickname: "Spellpool Pro yearly", interval: "year", unit_amount: 3999 },
];
const CURRENCY = "eur";
const EVENTS = [
  "checkout.session.completed",
  "customer.created",
  "customer.updated",
  "customer.deleted",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.trial_will_end",
];

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY (sk_test_… or sk_live_…).");
  process.exit(1);
}
const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
const webhookArg = process.argv.indexOf("--webhook");
const webhookUrl = webhookArg > 0 ? process.argv[webhookArg + 1] : null;

const existing = await stripe.prices.list({ lookup_keys: PRICES.map((p) => p.lookup_key), active: true, expand: ["data.product"] });
let product = existing.data[0]?.product;
if (!product || typeof product === "string" || product.deleted) {
  const found = await stripe.products.search({ query: `metadata['app']:'spellpool' AND active:'true'` }).catch(() => ({ data: [] }));
  product = found.data[0] ?? (await stripe.products.create(PRODUCT));
}
console.log(`Product: ${product.id} (${product.name}, tax code ${product.tax_code ?? "none"})`);
if (product.tax_code !== PRODUCT.tax_code) {
  await stripe.products.update(product.id, { tax_code: PRODUCT.tax_code });
  console.log(`  tax code set to ${PRODUCT.tax_code}`);
}

for (const p of PRICES) {
  let price = existing.data.find((x) => x.lookup_key === p.lookup_key);
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      currency: CURRENCY,
      unit_amount: p.unit_amount,
      recurring: { interval: p.interval },
      tax_behavior: "inclusive",
      lookup_key: p.lookup_key,
      nickname: p.nickname,
    });
    console.log(`Price ${p.lookup_key}: ${price.id} (created)`);
  } else {
    console.log(`Price ${p.lookup_key}: ${price.id} (${price.unit_amount} ${price.currency}, ${price.tax_behavior})`);
  }
}

if (webhookUrl) {
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const same = endpoints.data.find((e) => e.url === webhookUrl);
  if (same) {
    console.log(`Webhook ${webhookUrl}: ${same.id} already exists (its secret is on its page in the Dashboard)`);
  } else {
    const endpoint = await stripe.webhookEndpoints.create({ url: webhookUrl, enabled_events: EVENTS, description: "Spellpool billing mirror" });
    console.log(`Webhook ${webhookUrl}: ${endpoint.id}`);
    console.log(`STRIPE_WEBHOOK_SECRET=${endpoint.secret}`);
  }
}
