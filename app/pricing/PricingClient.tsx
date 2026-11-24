"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { rememberAfterSignIn } from "@/lib/after-sign-in";
import { FREE_PLAN, type BillingInterval, type Tier } from "@/lib/pricing-tiers";
import { startCheckout } from "./actions";

/** Each interval's price as the page shows it ("€4.99"), tax included. */
export type Prices = Record<BillingInterval, string>;

interface Props {
  tier: Tier;
  /** Null when Stripe couldn't be reached. */
  prices: Prices | null;
  /** Whether the free trial is on offer (only before a first web subscription). */
  trial: boolean;
  signedIn: boolean;
  /** Already on Pro (User.tier, from RevenueCat): no second subscription. */
  isPro?: boolean;
  /** Back from a checkout that couldn't be opened. */
  checkoutFailed?: boolean;
}

export default function PricingClient({ tier, prices, trial, signedIn, isPro, checkoutFailed }: Props) {
  const [interval, setInterval] = useState<BillingInterval>("month");
  const price = prices?.[interval];
  const trialDays = trial ? tier.trialDays[interval] : undefined;
  const error = !prices
    ? "Couldn't load prices. Try again in a moment."
    : checkoutFailed
      ? "Couldn't open checkout. Try again in a moment."
      : undefined;

  // A purchase is credited to an account through the checkout's metadata
  // (the RevenueCat app user id, and the mirror's link), so checkout needs one.
  function signInFirst() {
    rememberAfterSignIn("/pricing");
    window.location.href = "/login";
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
          {signedIn ? (
            <p style={{ ...footNote, marginTop: "auto", padding: "14px 0", textAlign: "center" }}>
              {isPro ? "Included with Pro." : "Your current plan."}
            </p>
          ) : (
            <Link href="/" className="id-ghost" style={{ ...ctaBase, marginTop: "auto" }}>Start brewing</Link>
          )}
        </section>

        <section style={{ ...card, ...cardFeatured }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 24 }}>
            <div className="id-label" style={{ color: "var(--gold)" }}>{tier.name}</div>
            {trialDays && <span style={badge}>{trialDays}-day free trial</span>}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 14, minHeight: 64 }} aria-live="polite">
            {price ? (
              <>
                <span className="id-display" style={priceBig}>{price}</span>
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--t2)" }}>/ {interval}</span>
              </>
            ) : (
              <span aria-label="Price unavailable" style={skeleton} />
            )}
          </div>
          <p style={sub}>{tier.description}</p>
          <ul style={list}>
            <li style={{ ...item, color: "var(--t1)", fontWeight: 700 }}>Everything in Free, plus:</li>
            {tier.features.map((f) => <Feature key={f} text={f} />)}
          </ul>
          {isPro ? (
            <Link href="/account" className="id-ghost" style={{ ...ctaBase, marginTop: "auto" }}>You&apos;re on Pro · Manage</Link>
          ) : signedIn ? (
            <form action={startCheckout} style={{ marginTop: "auto" }}>
              <input type="hidden" name="interval" value={interval} />
              <SubmitButton disabled={!price} label={trialDays ? "Start free trial" : "Subscribe"} />
            </form>
          ) : (
            <button type="button" className="id-btn" onClick={signInFirst} style={{ ...ctaBase, marginTop: "auto" }}>
              Sign in to subscribe
            </button>
          )}
        </section>
      </div>

      <p style={{ ...footNote, textAlign: "center", marginTop: 22 }}>
        Prices include tax · Cancel any time · Secure checkout by Stripe
      </p>
    </div>
  );
}

// Shows that the click went through while the server makes the checkout.
function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="id-btn" disabled={disabled || pending} style={ctaBase}>
      {pending ? "Opening checkout…" : label}
    </button>
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
