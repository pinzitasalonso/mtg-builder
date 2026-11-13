"use client";

import { initializePaddle, type Paddle, type PricePreviewParams } from "@paddle/paddle-js";
import { useEffect, useState } from "react";
import { rememberAfterSignIn } from "@/lib/after-sign-in";
import type { PaddleClientConfig } from "@/lib/paddle-config";
import type { BillingInterval, Tier } from "@/lib/pricing-tiers";

interface Props {
  paddle: PaddleClientConfig;
  /** The plans, with this environment's price IDs. */
  tiers: Tier[];
  /** The signed-in player's Paddle customer (ctm_…), for Paddle Retain. Never our own user id or an email. */
  customerId?: string;
  /** ISO country from the edge, or undefined to let Paddle detect it from the IP. */
  country?: string;
  email?: string;
  userId?: number;
}

// priceId → Paddle's formatted total ("£8.00"), shown exactly as it comes back,
// and the price's trial as Paddle reports it (null when it has none).
type Prices = Record<string, { total: string; trial: string | null }>;

function trialLabel(t: { interval: string; frequency: number } | null | undefined): string | null {
  if (!t) return null;
  return `${t.frequency}-${t.interval} free trial`;
}

export default function PricingClient({ paddle: config, tiers, customerId, country, email, userId }: Props) {
  const [paddle, setPaddle] = useState<Paddle>();
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [prices, setPrices] = useState<Prices>({});
  const [error, setError] = useState<string>();

  // One Paddle.js instance for the page. On a default-payment-link visit
  // (?_ptxn=txn_…) Paddle.js opens that transaction's checkout by itself.
  useEffect(() => {
    let cancelled = false;
    initializePaddle({
      environment: config.environment,
      token: config.token,
      ...(customerId ? { pwCustomer: { id: customerId } } : {}),
      checkout: {
        settings: {
          displayMode: "overlay",
          variant: "one-page",
          successUrl: `${window.location.origin}/welcome`,
        },
      },
    })
      .then((p) => { if (!cancelled && p) setPaddle(p); })
      .catch(() => { if (!cancelled) setError("Couldn't load checkout. Try again in a moment."); });
    return () => { cancelled = true; };
  }, [config.environment, config.token, customerId]);

  // Both intervals in one call, so the toggle never refetches.
  useEffect(() => {
    if (!paddle) return;
    const params: PricePreviewParams = {
      items: tiers.flatMap((t) => [
        { priceId: t.priceId.month, quantity: 1 },
        { priceId: t.priceId.year, quantity: 1 },
      ]),
      ...(country ? { address: { countryCode: country } } : {}),
    };
    paddle
      .PricePreview(params)
      .then((res) => {
        const next: Prices = {};
        for (const item of res.data.details.lineItems) {
          next[item.price.id] = { total: item.formattedTotals.total, trial: trialLabel(item.price.trialPeriod) };
        }
        setPrices(next);
      })
      .catch(() => setError("Couldn't load prices. Try again in a moment."));
  }, [paddle, country, tiers]);

  function subscribe(priceId: string) {
    // A purchase is credited to an account through customData.userId (the
    // RevenueCat app user id, and the mirror's link), so checkout needs one.
    if (!userId) {
      rememberAfterSignIn("/pricing");
      window.location.href = "/login";
      return;
    }
    paddle?.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      ...(email ? { customer: { email } } : {}),
      customData: { userId: String(userId) },
      settings: {
        displayMode: "overlay",
        variant: "one-page",
        successUrl: `${window.location.origin}/welcome`,
        ...(email ? { allowLogout: false } : {}),
      },
    });
  }

  return (
    <div>
      <div role="radiogroup" aria-label="Billing interval" style={toggleWrap}>
        {(["month", "year"] as const).map((v) => (
          <button
            key={v}
            role="radio"
            aria-checked={interval === v}
            onClick={() => setInterval(v)}
            style={{ ...toggleBtn, ...(interval === v ? toggleOn : null) }}
          >
            {v === "month" ? "Monthly" : "Yearly"}
          </button>
        ))}
      </div>

      {error && <p style={{ color: "var(--danger)", margin: "0 0 16px" }}>{error}</p>}

      <div style={grid}>
        {tiers.map((tier) => {
          const priceId = tier.priceId[interval];
          const price = prices[priceId];
          const total = price?.total;
          return (
            <section key={tier.name} style={{ ...card, ...(tier.featured ? cardFeatured : null) }}>
              <h2 style={{ margin: 0, fontSize: 22, color: "var(--t1)" }}>{tier.name}</h2>
              <p style={{ margin: "6px 0 18px", color: "var(--t2)", fontSize: 14.5, minHeight: 42 }}>{tier.description}</p>
              <p style={{ margin: "0 0 4px", fontSize: 36, fontWeight: 700, color: "var(--t1)" }} aria-live="polite">
                {total ?? <span style={{ color: "var(--t3)" }}>…</span>}
                <span style={{ fontSize: 15, fontWeight: 500, color: "var(--t2)" }}>
                  {" "}/ {interval === "month" ? "month" : "year"}
                </span>
              </p>
              <p style={{ margin: "0 0 18px", color: "var(--t3)", fontSize: 13, minHeight: 18 }}>{price?.trial ?? ""}</p>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 22px", flex: 1 }}>
                {tier.features.map((f) => (
                  <li key={f} style={{ color: "var(--t2)", fontSize: 14.5, padding: "5px 0" }}>✓ {f}</li>
                ))}
              </ul>
              <button
                onClick={() => subscribe(priceId)}
                disabled={!paddle || !total}
                style={{ ...cta, ...(tier.featured ? ctaFeatured : null), opacity: !paddle || !total ? 0.5 : 1 }}
              >
                {userId ? "Subscribe" : "Sign in to subscribe"}
              </button>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const toggleWrap: React.CSSProperties = {
  display: "inline-flex", gap: 4, padding: 4, borderRadius: 999,
  background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 22,
};
const toggleBtn: React.CSSProperties = {
  border: 0, borderRadius: 999, padding: "8px 18px", fontSize: 14, fontWeight: 600,
  background: "transparent", color: "var(--t2)", cursor: "pointer",
};
const toggleOn: React.CSSProperties = { background: "var(--accent)", color: "var(--accent-ink)" };
const grid: React.CSSProperties = {
  display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
};
const card: React.CSSProperties = {
  display: "flex", flexDirection: "column", padding: 22, borderRadius: 16,
  background: "var(--bg2)", border: "1px solid var(--border)",
};
const cardFeatured: React.CSSProperties = { borderColor: "var(--accent)" };
const cta: React.CSSProperties = {
  border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", fontSize: 15, fontWeight: 600,
  background: "var(--surface2)", color: "var(--t1)", cursor: "pointer",
};
const ctaFeatured: React.CSSProperties = { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" };
