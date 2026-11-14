import type { Metadata } from "next";
import { ChevronDown } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import Logo from "@/components/Logo";
import { currentUser } from "@/lib/auth";
import { isPro } from "@/lib/limits";
import { customerIdsFor } from "@/lib/paddle-billing";
import { countryFromHeaders, paddleClientConfig } from "@/lib/paddle-config";
import { tiersFor } from "@/lib/pricing-tiers";
import PricingClient from "./PricingClient";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Spellpool is free to brew with. Spellpool Pro, monthly or yearly, removes the daily limits on AI, deck scans and practice games.",
};

// Rendered per request (it reads the visitor's country and session). Never
// prerendered at build: a missing Paddle variable must fail this page when
// it's opened, not every deploy of the site.
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
    q: "How does the free trial work?",
    a: "The monthly plan starts with a free trial. Cancel before it ends and you won't be charged.",
  },
  {
    q: "Does Pro work in the iOS app too?",
    a: "Yes. Pro belongs to your Spellpool account, so it's on wherever you sign in: on the web and in the iOS app.",
  },
  {
    q: "Who handles the payment?",
    a: "Paddle, our reseller and Merchant of Record. It takes the payment, handles sales tax and sends your receipt. Your card details never reach Spellpool.",
  },
];

export default async function PricingPage() {
  const [h, user] = await Promise.all([headers(), currentUser()]);
  const paddle = paddleClientConfig();
  const country = countryFromHeaders(h);
  // Paddle Retain wants the signed-in player's Paddle customer id, once they have one.
  const [customerId] = user ? await customerIdsFor(user) : [];

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
            Spellpool is free to brew with. Pro is for the days you want the assistant, the Score and the practice table
            as often as you like.
          </p>
        </div>

        <PricingClient
          paddle={paddle}
          tiers={tiersFor(paddle.environment)}
          customerId={customerId}
          country={country}
          email={user?.email}
          userId={user?.id}
          isPro={isPro(user)}
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
        <a href="mailto:pinzitasalonso@gmail.com" style={{ color: "var(--t2)", textDecoration: "none" }}>Contact</a>
      </footer>
    </div>
  );
}
