// RevenueCat → server subscription sync.
//
// "Pro" is sold through RevenueCat in two places: the iOS app (App Store IAP)
// and spellpool.com (Paddle, through RevenueCat's purchases-js). RevenueCat is the
// source of truth for whether a subscription is active; our job is only to
// mirror that onto `User.tier` ("pro" | "free"), which is what every plan gate
// already reads (lib/limits.ts) — so a purchase on either lifts the caps on
// both, for the same account.
//
// The link is identity: both clients hand RevenueCat "<User.id>" (the app via
// Purchases.logIn, the web via /api/subscription/config), so RevenueCat's
// `app_user_id` IS our numeric User.id. We never trust the client
// for entitlement state — tier is only ever set from RevenueCat server-to-server
// (the webhook below, or the REST re-check).

// Pure RevenueCat REST helpers — no Prisma import, so tests stay hermetic (the
// tier write lives in the webhook route, mirroring lib/limits vs lib/limits-db).

const RC_API = "https://api.revenuecat.com/v1";

// The entitlement id configured in the RevenueCat dashboard. A subscriber with
// this entitlement active is "pro".
const PRO_ENTITLEMENT = "pro";

interface RCSubscriberResponse {
  subscriber?: {
    entitlements?: Record<string, { expires_date?: string | null; product_identifier?: string }>;
    subscriptions?: Record<string, { store?: string; is_sandbox?: boolean }>;
  };
}

// Stores whose test mode anyone can reach from the website: a test purchase
// there costs nothing but a test card. The App Store's is TestFlight, which
// is invited testers only, so its sandbox purchases keep counting as they
// always have.
const WEB_STORES = new Set(["paddle", "rc_billing", "stripe", "test_store"]);

/* Ask RevenueCat whether this app_user_id currently has the `pro` entitlement.
   Canonical check (RevenueCat's recommended pattern): re-read the subscriber
   rather than infer from a single event, so missed or out-of-order webhooks
   can't desync us.

   Tri-state: true/false is a DEFINITIVE answer from RevenueCat; null means we
   couldn't get one (bad/permission-less API key, network failure, RC outage).
   Callers must not change anyone's tier on null — a misconfigured key once
   made every re-check actively stamp paying subscribers back to "free".

   In production, Pro backed only by a TEST purchase from a web store is not
   Pro. Paddle's test and live keys look alike (both `pdl_…`), so the key
   check below can't keep a test key off the live site; this can, whichever
   key is set. */
export async function isProOnRevenueCat(
  appUserId: string,
  secretKey: string,
  production: boolean = process.env.NODE_ENV === "production"
): Promise<boolean | null> {
  try {
    const res = await fetch(`${RC_API}/subscribers/${encodeURIComponent(appUserId)}`, {
      headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
    });
    // 404 = RevenueCat has never seen this user: definitively not entitled.
    // Anything else non-2xx (401/403 bad key, 5xx outage) is indeterminate.
    if (res.status === 404) return false;
    if (!res.ok) return null;
    const data = (await res.json()) as RCSubscriberResponse;
    const ent = data.subscriber?.entitlements?.[PRO_ENTITLEMENT];
    if (!ent) return false;
    if (production) {
      const sub = data.subscriber?.subscriptions?.[ent.product_identifier ?? ""];
      if (sub?.is_sandbox && WEB_STORES.has(sub.store ?? "")) return false;
    }
    // Active when there's no expiry (non-expiring) or the expiry is in the future.
    if (!ent.expires_date) return true;
    return new Date(ent.expires_date).getTime() > Date.now();
  } catch {
    return null;
  }
}

/* RevenueCat's app_user_id is our User.id as a string. Anonymous ids
   ($RCAnonymousID…) and aliases won't parse to a positive integer — those are
   pre-login purchases, reconciled when the app logs in and calls
   /api/subscription/sync. Returns the numeric id, or null to skip. */
export function userIdFromAppUserId(appUserId: string): number | null {
  const id = Number(appUserId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/* The web paywall (RevenueCat's purchases-js, on spellpool.com) is configured
   with a PUBLIC key that the server hands to the browser. So this is the one
   place a key leaves the server, and it only lets through the kinds that are
   meant to:
     - `pdl_…`    a Paddle key — the one production runs on. Paddle is the
                  merchant of record, so it collects and pays the sales tax.
     - `rcb_…`    a RevenueCat Web Billing (Stripe) key, the alternative.
     - `rcb_sb_…` a Web Billing sandbox key (Stripe test cards).
     - `test_…`   the Test Store key (purchases are simulated).
   The last two hand out Pro without real money, so they're refused in
   production: a sandbox key left in Railway would make Pro free for anyone
   who found a test card. A Paddle test key can't be told apart by its prefix,
   so isProOnRevenueCat refuses its purchases in production instead. Anything
   else — above all an `sk_` secret key pasted into the wrong variable — is
   refused everywhere, and the paywall simply stays hidden. */
export function webPaywallKey(raw: string | null | undefined, production: boolean): string | null {
  const key = raw?.trim();
  if (!key || !/^(pdl|rcb|test)_[A-Za-z0-9_.-]+$/.test(key)) return null;
  const sandbox = key.startsWith("rcb_sb_") || key.startsWith("test_");
  return production && sandbox ? null : key;
}

/* Whether Pro can be bought on the web right now: this deployment has a key
   it's willing to serve. Until it does, the free plan's messages call Pro
   "coming soon" (lib/limits.ts). */
export function proOnSale(): boolean {
  return webPaywallKey(process.env.REVENUECAT_WEB_KEY, process.env.NODE_ENV === "production") !== null;
}
