// The server-side Stripe SDK. Server only: it holds STRIPE_SECRET_KEY, which
// must never reach the browser — never import this from a "use client" file.
// The SDK pins its own API version, which is newer than the one Managed
// Payments needs (2025-03-31.basil or later).

import Stripe from "stripe";

let instance: Stripe | null = null;

/** One SDK instance per process. Throws when the key is unset or isn't a secret key. */
export function stripe(): Stripe {
  if (instance) return instance;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  // sk_ is a secret key, rk_ a restricted one. A publishable key (pk_) here
  // means the variables were swapped. Never echo the value.
  if (!/^(sk|rk)_(test|live)_/.test(key)) throw new Error("STRIPE_SECRET_KEY must start with sk_test_, sk_live_, rk_test_ or rk_live_");
  // The fetch client: the same HTTP stack as the rest of the app (it follows
  // the environment's proxy settings where Node's http module doesn't).
  instance = new Stripe(key, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, appInfo: { name: "Spellpool" } });
  return instance;
}

/** The signing secret of the webhook endpoint (whsec_…). Not the API key. */
export function webhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return secret;
}
