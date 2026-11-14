// The pricing page's plans. Edit names, copy and features here. Amounts are
// never written here: the page shows what Paddle's PricePreview returns for
// the visitor's country.
//
// Each Paddle account has its own price IDs, so each environment has its own
// list, picked by NEXT_PUBLIC_PADDLE_ENV (tiersFor). Live sells Spellpool Pro
// (pro_01m3jc5f6c602f42wvfjzxyvrc), the same subscription as the iOS app;
// RevenueCat tracks it and sets User.tier. Sandbox has no copy of that
// product, so local dev shows the sandbox Pro plan (different amounts).

import type { PaddleEnv } from "@/lib/paddle-config";
import { FREE_AI_PER_DAY, FREE_PRACTICE_PER_DAY, FREE_SCANS_PER_DAY } from "@/lib/limits";

export type BillingInterval = "month" | "year";

export interface Tier {
  name: "Starter" | "Pro" | "Advanced";
  description: string;
  features: string[];
  featured?: boolean;
  priceId: { month: string; year: string };
}

const PRO_COPY: Omit<Tier, "priceId"> = {
  name: "Pro",
  description: "Every scan, AI answer and practice game you want.",
  features: [
    "Unlimited AI assistant",
    "Unlimited Deck Score scans",
    "Unlimited practice games vs AI",
  ],
  featured: true,
};

/** The free plan, shown beside the paid ones for comparison. Not a Paddle product. */
export const FREE_PLAN = {
  name: "Spellpool",
  description: "Everything you need to brew, for as long as you like.",
  features: [
    "Unlimited decks",
    `${FREE_AI_PER_DAY} AI assistant questions a day`,
    `${FREE_SCANS_PER_DAY} Deck Score scan a day`,
    `${FREE_PRACTICE_PER_DAY} practice game vs AI a day`,
    "Collection, wishlist, combos and playtesting",
  ],
};

const TIERS: Record<PaddleEnv, Tier[]> = {
  production: [
    {
      ...PRO_COPY,
      // Spellpool Pro: "Monthly subscription" (7-day trial) and "Annual subscription".
      priceId: { month: "pri_01m3jc749gfkstxpd90fnw8tka", year: "pri_01m3jc886vgb57afky1f2qyv5f" },
    },
  ],
  sandbox: [
    {
      ...PRO_COPY,
      priceId: { month: "pri_01m7bj4vcsf75zgdsnkfwznybq", year: "pri_01m7bj4vgja995td59vejk70t8" },
    },
  ],
};

/** The plans with the price IDs of this Paddle environment. */
export function tiersFor(env: PaddleEnv): Tier[] {
  return TIERS[env];
}
