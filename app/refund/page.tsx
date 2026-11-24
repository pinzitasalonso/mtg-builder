import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "How to cancel Spellpool Pro and get a refund.",
};

// Plain reading page, styled like /terms and /privacy, linked from the home
// footer. Web purchases are sold through Link (Stripe's Managed Payments).
const H2: React.CSSProperties = { fontFamily: "var(--font-display)", fontSize: 26, margin: "34px 0 10px", color: "var(--t1)" };
const P: React.CSSProperties = { margin: "0 0 14px", lineHeight: 1.65, color: "var(--t2)", fontSize: 15.5 };
const A: React.CSSProperties = { color: "var(--gold)" };
const CONTACT = "pinzitasalonso@gmail.com";

export default function RefundPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "28px 20px 80px" }}>
      <Link href="/" style={{ textDecoration: "none" }}><Logo size={18} /></Link>
      <h1 className="id-display" style={{ fontSize: "clamp(34px,6vw,52px)", margin: "26px 0 4px", color: "var(--t1)" }}>
        Refund Policy
      </h1>
      <p style={{ ...P, color: "var(--t3)" }}>Last updated November 24, 2026 · Applies to Spellpool Pro, sold on spellpool.com through Link (Stripe).</p>

      <h2 style={H2}>The short version</h2>
      <p style={P}>
        You can cancel Spellpool Pro at any time, and you keep Pro until the end of the period you&apos;ve paid
        for. If you&apos;re unhappy with a payment, ask within 14 days of that payment and we&apos;ll refund it in
        full.
      </p>

      <h2 style={H2}>Who sells it</h2>
      <p style={P}>
        Spellpool Pro is sold through Link, the merchant of record of Stripe&apos;s Managed Payments. Link
        (Stripe) takes the payment, handles the tax and sends your receipt.
      </p>
      <p style={P}>
        <b>Cancelling.</b>{" "}Open <Link href="/account" style={A}>Account</Link> and choose <i>Manage billing</i>, or manage
        the subscription at <a href="https://link.com" style={A}>link.com</a> with the email you paid with. Cancelling stops future charges; Pro stays on until the end of the
        current billing period.
      </p>
      <p style={P}>
        <b>Free trials.</b>{" "}If your plan starts with a free trial, cancel before the trial ends and you
        won&apos;t be charged at all.
      </p>
      <p style={P}>
        <b>Refunds.</b>{" "}Ask within 14 days of any payment, first or renewal, for a full refund of that
        payment: email <a href={`mailto:${CONTACT}`} style={A}>{CONTACT}</a> with the email address you paid
        with, or contact Link support at <a href="https://support.link.com" style={A}>support.link.com</a>. Refunds go back to
        the original payment method, usually within 5–10 business days. A refunded subscription ends when
        the refund is made.
      </p>

      <h2 style={H2}>Your rights</h2>
      <p style={P}>
        Nothing here limits the rights you have under the consumer law where you live.
      </p>

      <h2 style={H2}>Contact</h2>
      <p style={P}>
        Questions about a payment: <a href={`mailto:${CONTACT}`} style={A}>{CONTACT}</a>. See also the{" "}
        <Link href="/terms" style={A}>Terms of Use</Link> and the <Link href="/privacy" style={A}>Privacy Policy</Link>.
      </p>
    </main>
  );
}
