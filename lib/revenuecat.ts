// RevenueCat → server subscription sync.
//
// The iOS app sells "Pro" through RevenueCat (App Store IAP). RevenueCat is the
// source of truth for whether a subscription is active; our job is only to
// mirror that onto `User.tier` ("pro" | "free"), which is what every plan gate
// already reads (lib/limits.ts) — so a purchase on iOS lifts the caps on the
// web app too, for the same account.
//
// The link between the two is identity: the app calls Purchases.logIn("<User.id>"),
// so RevenueCat's `app_user_id` IS our numeric User.id. We never trust the client
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
    entitlements?: Record<string, { expires_date?: string | null }>;
  };
}

/* Ask RevenueCat whether this app_user_id currently has the `pro` entitlement.
   Canonical check (RevenueCat's recommended pattern): re-read the subscriber
   rather than infer from a single event, so missed or out-of-order webhooks
   can't desync us. Returns false on any error (fail closed). */
export async function isProOnRevenueCat(appUserId: string, secretKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${RC_API}/subscribers/${encodeURIComponent(appUserId)}`, {
      headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as RCSubscriberResponse;
    const ent = data.subscriber?.entitlements?.[PRO_ENTITLEMENT];
    if (!ent) return false;
    // Active when there's no expiry (non-expiring) or the expiry is in the future.
    if (!ent.expires_date) return true;
    return new Date(ent.expires_date).getTime() > Date.now();
  } catch {
    return false;
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
