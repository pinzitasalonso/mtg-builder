import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "How to cancel Spellpool Pro and get a refund, on the web and in the iOS app.",
};

// Plain reading page, styled like /terms and /privacy. Paddle's domain review
// needs a refund policy linked from the site's navigation (the home footer).
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
      <p style={{ ...P, color: "var(--t3)" }}>Last updated November 14, 2026 · Applies to Spellpool Pro, sold by Spellpool.</p>

      <h2 style={H2}>The short version</h2>
      <p style={P}>
        You can cancel Spellpool Pro at any time, and you keep Pro until the end of the period you&apos;ve paid
        for. If you&apos;re unhappy with a payment made on spellpool.com, ask within 14 days of that payment and
        we&apos;ll refund it in full.
      </p>

      <h2 style={H2}>Bought on spellpool.com</h2>
      <p style={P}>
        Web purchases are processed by Paddle.com, our reseller and Merchant of Record, which takes the
        payment and issues your receipt.
      </p>
      <p style={P}>
        <b>Cancelling.</b>{" "}Open <Link href="/account" style={A}>Account</Link> and choose <i>Manage billing</i>, or use
        the link in any Paddle receipt. Cancelling stops future charges; Pro stays on until the end of the
        current billing period.
      </p>
      <p style={P}>
        <b>Free trials.</b>{" "}If your plan starts with a free trial, cancel before the trial ends and you
        won&apos;t be charged at all.
      </p>
      <p style={P}>
        <b>Refunds.</b>{" "}Ask within 14 days of any payment, first or renewal, for a full refund of that
        payment: email <a href={`mailto:${CONTACT}`} style={A}>{CONTACT}</a> with the email address you paid
        with, or contact Paddle at <a href="https://paddle.net" style={A}>paddle.net</a>. Refunds go back to
        the original payment method, usually within 5–10 business days. A refunded subscription ends when
        the refund is made.
      </p>

      <h2 style={H2}>Bought in the iOS app</h2>
      <p style={P}>
        Purchases in the iOS app are made through your Apple ID, and Apple handles them: cancel in your Apple
        ID subscription settings, and request a refund at{" "}
        <a href="https://reportaproblem.apple.com" style={A}>reportaproblem.apple.com</a>. We can&apos;t refund App
        Store purchases ourselves.
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
