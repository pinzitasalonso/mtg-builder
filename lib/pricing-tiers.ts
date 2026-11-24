// The pricing page's plans. Edit names, copy and features here. Amounts are
// never written here: the page shows the Stripe price that the lookup key
// names (lib/stripe-billing.ts planPrices). The sandbox and the live account
// each have their own price ids, but the same lookup keys
// (scripts/stripe-setup.mjs creates them), so one list serves both.
//
// Spellpool Pro is the same subscription as the iOS app's; RevenueCat tracks
// both and sets User.tier.

import { FREE_AI_PER_DAY, FREE_PRACTICE_PER_DAY, FREE_SCANS_PER_DAY } from "@/lib/limits";

export type BillingInterval = "month" | "year";

export interface Tier {
  name: "Pro";
  description: string;
  features: string[];
  /** The Stripe price lookup key of each interval. */
  lookupKey: Record<BillingInterval, string>;
  /** A free trial, set at checkout (not on the price). Only for a first subscription. */
  trialDays: Partial<Record<BillingInterval, number>>;
}

export const PRO: Tier = {
  name: "Pro",
  description: "Every coach answer, deck scan and practice match you want.",
  features: [
    "Unlimited deck coach: edit your deck by chat",
    "Unlimited practice matches against the smart opponent",
    "Unlimited Deck Score scans",
  ],
  // The yearly plan starts with a 7-day trial; the monthly one has none.
  lookupKey: { month: "spellpool_pro_monthly", year: "spellpool_pro_yearly" },
  trialDays: { year: 7 },
};

/** The free plan, shown beside the paid one for comparison. Not a Stripe product. */
export const FREE_PLAN = {
  name: "Spellpool",
  description: "Everything you need to brew, for as long as you like.",
  features: [
    "Unlimited decks",
    `${FREE_AI_PER_DAY} coach question${FREE_AI_PER_DAY === 1 ? "" : "s"} a day, shared by the coach, smart search and primers`,
    `Unlimited practice matches against the basic opponent, and ${FREE_PRACTICE_PER_DAY} a day against the smart one`,
    `${FREE_SCANS_PER_DAY} Deck Score scan${FREE_SCANS_PER_DAY === 1 ? "" : "s"} a day`,
    "Collection, wishlist, combos and playtesting",
  ],
};
