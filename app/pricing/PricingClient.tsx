"use client";

import { initializePaddle, type Paddle, type PricePreviewParams } from "@paddle/paddle-js";
import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { rememberAfterSignIn } from "@/lib/after-sign-in";
import type { PaddleClientConfig } from "@/lib/paddle-config";
import { FREE_PLAN, type BillingInterval, type Tier } from "@/lib/pricing-tiers";

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
  /** Already on Pro (User.tier, from RevenueCat): no second subscription. */
  isPro?: boolean;
}

// priceId → Paddle's formatted total ("£8.00"), shown exactly as it comes back,
// and the price's trial as Paddle reports it (null when it has none).
type Prices = Record<string, { total: string; trial: string | null }>;

function trialLabel(t: { interval: string; frequency: number } | null | undefined): string | null {
  if (!t) return null;
  return `${t.frequency}-${t.interval} free trial`;
}

export default function PricingClient({ paddle: config, tiers, customerId, country, email, userId, isPro }: Props) {
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
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
        <div className="mn-seg" role="radiogroup" aria-label="Billing period" style={{ padding: 4 }}>
          {(["month", "year"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={interval === v}
              data-on={interval === v}
              onClick={() => setInterval(v)}
              style={{ fontSize: 14, padding: "9px 22px" }}
            >
              {v === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" style={{ textAlign: "center", color: "var(--danger)", margin: "0 0 18px", fontSize: 14.5 }}>{error}</p>
      )}

      <div className="pricing-grid">
        {/* Free, for comparison */}
        <section style={card}>
          <div style={{ minHeight: 24, display: "flex", alignItems: "center" }}>
            <div className="id-label" style={{ color: "var(--t3)" }}>{FREE_PLAN.name}</div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", marginTop: 14, minHeight: 64 }}>
            <span className="id-display" style={priceBig}>Free</span>
          </div>
          <p style={sub}>{FREE_PLAN.description}</p>
          <ul style={list}>
            {FREE_PLAN.features.map((f) => <Feature key={f} text={f} muted />)}
          </ul>
          {userId ? (
            <p style={{ ...footNote, marginTop: "auto", padding: "14px 0", textAlign: "center" }}>
              {isPro ? "Included with Pro." : "Your current plan."}
            </p>
          ) : (
            <Link href="/" className="id-ghost" style={{ ...ctaBase, marginTop: "auto" }}>Start brewing</Link>
          )}
        </section>

        {tiers.map((tier) => {
          const priceId = tier.priceId[interval];
          const price = prices[priceId];
          return (
            <section key={tier.name} style={{ ...card, ...cardFeatured }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 24 }}>
                <div className="id-label" style={{ color: "var(--gold)" }}>{tier.name}</div>
                {price?.trial && <span style={badge}>{price.trial}</span>}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 14, minHeight: 64 }} aria-live="polite">
                {price ? (
                  <>
                    <span className="id-display" style={priceBig}>{price.total}</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: "var(--t2)" }}>/ {interval}</span>
                  </>
                ) : (
                  <span aria-label="Loading price" style={skeleton} />
                )}
              </div>
              <p style={sub}>{tier.description}</p>
              <ul style={list}>
                <li style={{ ...item, color: "var(--t1)", fontWeight: 700 }}>Everything in Free, plus:</li>
                {tier.features.map((f) => <Feature key={f} text={f} />)}
              </ul>
              {isPro ? (
                <Link href="/account" className="id-ghost" style={{ ...ctaBase, marginTop: "auto" }}>You&apos;re on Pro · Manage</Link>
              ) : (
                <button
                  type="button"
                  className="id-btn"
                  onClick={() => subscribe(priceId)}
                  disabled={!paddle || !price}
                  style={{ ...ctaBase, marginTop: "auto" }}
                >
                  {userId ? (price?.trial ? "Start free trial" : "Subscribe") : "Sign in to subscribe"}
                </button>
              )}
            </section>
          );
        })}
      </div>

      <p style={{ ...footNote, textAlign: "center", marginTop: 22 }}>
        Cancel any time · Secure checkout by Paddle
      </p>
    </div>
  );
}

function Feature({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <li style={item}>
      <span
        aria-hidden="true"
        style={{
          flex: "none", width: 20, height: 20, borderRadius: 999, display: "inline-flex", alignItems: "center",
          justifyContent: "center", marginTop: 1,
          background: muted ? "var(--bg3)" : "var(--accent)", color: muted ? "var(--t2)" : "var(--accent-ink)",
        }}
      >
        <Check size={12} strokeWidth={3} />
      </span>
      <span>{text}</span>
    </li>
  );
}

const card: React.CSSProperties = {
  display: "flex", flexDirection: "column", padding: "26px 26px 24px", borderRadius: 22,
  background: "var(--bg2)", boxShadow: "inset 0 0 0 1px var(--line)",
};
const cardFeatured: React.CSSProperties = {
  boxShadow: "inset 0 0 0 2px var(--accent), 0 24px 48px -28px rgba(0, 0, 0, 0.45)",
};
const priceBig: React.CSSProperties = { fontSize: "clamp(44px, 5vw, 56px)", lineHeight: 1, color: "var(--t1)" };
const sub: React.CSSProperties = { margin: "12px 0 22px", fontSize: 15, lineHeight: 1.5, color: "var(--t2)" };
const list: React.CSSProperties = {
  listStyle: "none", padding: "20px 0 0", margin: "0 0 26px", display: "flex", flexDirection: "column", gap: 12,
  borderTop: "1px solid var(--line)",
};
const item: React.CSSProperties = { display: "flex", gap: 10, fontSize: 14.5, lineHeight: 1.45, color: "var(--t2)" };
const ctaBase: React.CSSProperties = { width: "100%", padding: "14px 20px", fontSize: 15.5, textDecoration: "none", justifyContent: "center", textAlign: "center" };
const footNote: React.CSSProperties = { margin: 0, fontSize: 13.5, color: "var(--t3)" };
const badge: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
  background: "var(--accent)", color: "var(--accent-ink)", whiteSpace: "nowrap",
};
const skeleton: React.CSSProperties = {
  display: "inline-block", width: 150, height: 48, borderRadius: 10, background: "var(--bg3)",
};
