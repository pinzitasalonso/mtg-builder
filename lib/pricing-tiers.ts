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
  description: "Edit, score and test your decks as often as you like.",
  features: [
    "Unlimited deck editing by chat: ask for swaps, cuts and upgrades",
    "Unlimited practice games against the smart bot",
    "Unlimited Deck Score scans",
  ],
  // The iOS app's monthly plan has a 7-day trial; the yearly one has none.
  lookupKey: { month: "spellpool_pro_monthly", year: "spellpool_pro_yearly" },
  trialDays: { month: 7 },
};

/** The free plan, shown beside the paid one for comparison. Not a Stripe product. */
export const FREE_PLAN = {
  name: "Spellpool",
  description: "Everything you need to brew, for as long as you like.",
  features: [
    "Unlimited decks",
    `${FREE_AI_PER_DAY} chat request${FREE_AI_PER_DAY === 1 ? "" : "s"} a day, for deck edits, card search and primers`,
    `Unlimited games against the basic bot, and ${FREE_PRACTICE_PER_DAY} a day against the smart bot`,
    `${FREE_SCANS_PER_DAY} Deck Score scan${FREE_SCANS_PER_DAY === 1 ? "" : "s"} a day`,
    "Collection, wishlist, combos and playtesting",
  ],
};
