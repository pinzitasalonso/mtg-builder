// The web half of Spellpool Pro: RevenueCat's own paywall, rendered on
// spellpool.com by purchases-js and paid through Web Billing.
//
// It's the same paywall the iOS app shows (RevenueCatUI's PaywallView) — the
// design, the copy and the prices all live in the RevenueCat dashboard on the
// current offering, so neither client carries a copy of them. What differs is
// only the store behind the button.
//
// Client-only. The SDK is a couple of megabytes and nothing needs it until a
// paywall opens, so it's imported on demand rather than bundled into pages.
//
// Tier is never decided here. After a purchase we ask the server to re-check
// with RevenueCat (/api/subscription/sync), exactly as the iOS app does — the
// webhook would get there too, a beat later.

import type { CustomerInfo, Purchases } from "@revenuecat/purchases-js";

/** Must match the dashboard entitlement, lib/revenuecat.ts and the iOS app. */
export const PRO_ENTITLEMENT = "pro";

export interface PaywallConfig {
  /** Public Web Billing key; null when the web paywall isn't offered. */
  apiKey: string | null;
  /** RevenueCat identity: the numeric User.id as a string. Null signed out. */
  appUserId: string | null;
  email: string | null;
  tier: string | null;
}

const NO_CONFIG: PaywallConfig = { apiKey: null, appUserId: null, email: null, tier: null };

let configPromise: Promise<PaywallConfig> | null = null;

/* The config, fetched once per page and shared by every Get Pro button on it.
   `fresh` refetches: opening the paywall does, so a sign-in or sign-out since
   the page loaded can't hand RevenueCat the wrong account. */
export function loadPaywallConfig(fresh = false): Promise<PaywallConfig> {
  if (!configPromise || fresh) {
    configPromise = fetch("/api/subscription/config")
      .then((r) => (r.ok ? r.json() : NO_CONFIG))
      .then((c) => ({ ...NO_CONFIG, ...c }) as PaywallConfig)
      .catch(() => NO_CONFIG);
  }
  return configPromise;
}

/* The SDK, configured for this account. purchases-js keeps one instance per
   page; if the account changed under it, it's moved to the new one rather
   than configured twice. */
async function purchasesFor(cfg: PaywallConfig & { apiKey: string; appUserId: string }) {
  const sdk = await import("@revenuecat/purchases-js");
  let purchases: Purchases;
  if (sdk.Purchases.isConfigured()) {
    purchases = sdk.Purchases.getSharedInstance();
    if (purchases.getAppUserId() !== cfg.appUserId) await purchases.changeUser(cfg.appUserId);
  } else {
    purchases = sdk.Purchases.configure({ apiKey: cfg.apiKey, appUserId: cfg.appUserId });
  }
  return { sdk, purchases };
}

export function hasPro(info: CustomerInfo | null | undefined): boolean {
  return Boolean(info?.entitlements.active[PRO_ENTITLEMENT]);
}

export type PaywallOutcome =
  /** Bought (or restarted) Pro through the paywall. */
  | { status: "purchased" }
  /** RevenueCat already has Pro for this account — no paywall shown. */
  | { status: "already-pro" }
  /** Closed without buying. */
  | { status: "closed" }
  | { status: "signed-out" }
  /** The web paywall isn't configured on this deployment. */
  | { status: "unavailable" }
  | { status: "failed"; message: string };

/* Open the Pro paywall over the page. Resolves when it closes.

   Checks RevenueCat's own view of the entitlement first — the stored tier can
   trail a purchase by a webhook — so nobody who already has Pro (on either
   platform) is offered a second subscription. The iOS app guards its Upgrade
   button with the same local entitlement for the same reason. */
export async function presentProPaywall(): Promise<PaywallOutcome> {
  const cfg = await loadPaywallConfig(true);
  if (!cfg.apiKey) return { status: "unavailable" };
  if (!cfg.appUserId) return { status: "signed-out" };
  let sdk: Awaited<ReturnType<typeof purchasesFor>>["sdk"] | null = null;
  try {
    const ready = await purchasesFor({ ...cfg, apiKey: cfg.apiKey, appUserId: cfg.appUserId });
    sdk = ready.sdk;
    const info = await ready.purchases.getCustomerInfo().catch(() => null);
    if (hasPro(info)) return { status: "already-pro" };
    await ready.purchases.presentPaywall({ customerEmail: cfg.email ?? undefined });
    return { status: "purchased" };
  } catch (e) {
    // Closing the paywall rejects with UserCancelledError: not a failure.
    if (sdk && e instanceof sdk.PurchasesError && e.errorCode === sdk.ErrorCode.UserCancelledError) {
      return { status: "closed" };
    }
    // The SDK's own words go to the console (a missing offering, a bad key,
    // a network error); the player gets the plain version.
    console.warn("[paywall]", e);
    return { status: "failed", message: "The paywall couldn't open — check the connection and try again." };
  }
}

/* RevenueCat's view of this account's subscription, for the Pro page: where
   it's billed and the link that manages it. Null when the web paywall isn't
   configured, signed out, or RevenueCat can't be reached. */
export async function loadCustomerInfo(): Promise<CustomerInfo | null> {
  const cfg = await loadPaywallConfig();
  if (!cfg.apiKey || !cfg.appUserId) return null;
  try {
    const { purchases } = await purchasesFor({ ...cfg, apiKey: cfg.apiKey, appUserId: cfg.appUserId });
    return await purchases.getCustomerInfo();
  } catch {
    return null;
  }
}

/* Have the server re-check with RevenueCat and return the tier it settles on.
   Mirrors the iOS app's syncSubscription(retries:): RevenueCat's backend can
   lag the transaction by a beat, so a fresh purchase is retried a few times,
   two seconds apart, until it reads Pro. */
export async function syncSubscription(retries = 0): Promise<string | null> {
  let tier: string | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const body = await fetch("/api/subscription/sync", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (typeof body?.tier === "string") tier = body.tier;
    if (tier === "pro" || attempt === retries) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return tier;
}
