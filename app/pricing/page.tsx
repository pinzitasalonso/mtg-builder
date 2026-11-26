import type { Metadata } from "next";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import Logo from "@/components/Logo";
import { currentUser } from "@/lib/auth";
import { isPro } from "@/lib/limits";
import { PRO } from "@/lib/pricing-tiers";
import { formatPrice, hasPaidAccess, planPrices, trialEligible } from "@/lib/stripe-billing";
import PricingClient, { type Prices } from "./PricingClient";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Spellpool is free to brew with. Spellpool Pro, monthly or yearly, removes the daily limits on the coach, deck scans and practice matches.",
};

// Rendered per request (it reads the session, and the prices from Stripe).
// Never prerendered at build: a missing Stripe variable shows on this page
// when it's opened, not on every deploy of the site.
export const dynamic = "force-dynamic";

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Can I cancel any time?",
    a: (
      <>
        Yes. Cancel from <Link href="/account" style={{ color: "var(--gold)" }}>Account</Link> → Manage billing and
        you keep Pro until the end of the period you&apos;ve paid for. See the{" "}
        <Link href="/refund" style={{ color: "var(--gold)" }}>refund policy</Link>.
      </>
    ),
  },
  {
    q: "Who handles the payment?",
    a: "Stripe. Purchases are sold through Link, Stripe's merchant of record: it takes the payment, handles VAT and sales tax, and sends your receipt. Your card details never reach Spellpool.",
  },
];

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const [user, { checkout }] = await Promise.all([currentUser(), searchParams]);
  let prices: Prices | null = null;
  try {
    const p = await planPrices();
    prices = { month: formatPrice(p.month), year: formatPrice(p.year) };
  } catch (e) {
    console.error("Stripe prices failed:", e instanceof Error ? e.message : e);
  }
  // The trial is for a first web subscription; a signed-out visitor sees it.
  const trial = user ? await trialEligible(user) : true;
  // Pro from either store, or a web subscription RevenueCat hasn't reported yet.
  const pro = isPro(user) || (user ? await hasPaidAccess(user) : false);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px clamp(20px,4vw,52px)" }}>
        <Link href="/" style={{ textDecoration: "none" }}><Logo size={18} /></Link>
        {user ? (
          <Link href="/" className="id-ghost" style={{ padding: "9px 16px", textDecoration: "none" }}>Your decks</Link>
        ) : (
          <Link href="/login" className="id-ghost" style={{ padding: "9px 16px", textDecoration: "none" }}>Sign in</Link>
        )}
      </header>

      <main style={{ flex: 1, width: "100%", maxWidth: 1080, margin: "0 auto", padding: "clamp(20px,4vw,48px) clamp(20px,4vw,52px) clamp(56px,7vw,96px)" }}>
        <div style={{ textAlign: "center", marginBottom: "clamp(28px,4vw,44px)" }}>
          <div className="id-label" style={{ color: "var(--gold)", marginBottom: 18, display: "inline-flex", alignItems: "center", gap: 9 }}>
            <span style={{ width: 22, height: 2, background: "var(--gold)" }} /> Spellpool Pro
            <span style={{ width: 22, height: 2, background: "var(--gold)" }} />
          </div>
          <h1 className="id-display" style={{ fontSize: "clamp(44px, 7vw, 84px)", margin: "0 0 18px", color: "var(--t1)" }}>
            Brew without<br />
            <span style={{ color: "var(--gold)" }}>the daily limits.</span>
          </h1>
          <p style={{ fontSize: "clamp(16px,1.5vw,19px)", lineHeight: 1.5, color: "var(--t2)", maxWidth: 520, margin: "0 auto" }}>
            Spellpool is free to brew with. Pro is for the days you want to edit your deck with the coach, play practice
            matches and score your deck as often as you like.
          </p>
        </div>

        <PricingClient
          tier={PRO}
          prices={prices}
          trial={trial}
          signedIn={!!user}
          isPro={pro}
          checkoutFailed={checkout === "error"}
        />

        <section aria-labelledby="pricing-faq" style={{ maxWidth: 760, margin: "clamp(56px,7vw,88px) auto 0" }}>
          <h2 id="pricing-faq" className="id-display" style={{ fontSize: "clamp(28px,3.6vw,40px)", margin: "0 0 18px", color: "var(--t1)" }}>
            Questions
          </h2>
          {FAQ.map((f) => (
            <details key={f.q} className="home-faq" style={{ borderTop: "1px solid var(--line)", padding: "16px 0" }}>
              <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 17, fontWeight: 700, color: "var(--t1)" }}>
                <h3 style={{ margin: 0, font: "inherit" }}>{f.q}</h3>
                <ChevronDown size={18} strokeWidth={2.25} className="home-faq-chevron" aria-hidden="true" style={{ flex: "none", color: "var(--t3)" }} />
              </summary>
              <p style={{ margin: "10px 0 0", fontSize: 15, lineHeight: 1.6, color: "var(--t2)" }}>{f.a}</p>
            </details>
          ))}
        </section>
      </main>

      <footer style={{ padding: "28px clamp(20px,4vw,52px) 34px", borderTop: "1px solid var(--line)", display: "flex", flexWrap: "wrap", gap: "8px 18px", fontSize: 13.5 }}>
        <Link href="/privacy" style={{ color: "var(--t2)", textDecoration: "none" }}>Privacy</Link>
        <Link href="/terms" style={{ color: "var(--t2)", textDecoration: "none" }}>Terms</Link>
        <Link href="/refund" style={{ color: "var(--t2)", textDecoration: "none" }}>Refunds</Link>
        <Link href="/updates" style={{ color: "var(--t2)", textDecoration: "none" }}>What&apos;s new</Link>
        <a href="mailto:pinzitasalonso@gmail.com" style={{ color: "var(--t2)", textDecoration: "none" }}>Contact</a>
      </footer>
    </div>
  );
}
