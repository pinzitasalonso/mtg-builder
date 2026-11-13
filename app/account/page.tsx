import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import { currentUser } from "@/lib/auth";
import { grantsAccess, subscriptionsFor } from "@/lib/paddle-billing";
import { paddleEnv } from "@/lib/paddle-config";
import { tiersFor } from "@/lib/pricing-tiers";
import { openBillingPortal } from "./actions";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false },
};

const P: React.CSSProperties = { margin: "0 0 12px", color: "var(--t2)", fontSize: 15.5, lineHeight: 1.6 };

function planOf(priceId: string): string {
  for (const t of tiersFor(paddleEnv())) {
    if (t.priceId.month === priceId) return `${t.name} · monthly`;
    if (t.priceId.year === priceId) return `${t.name} · yearly`;
  }
  return "Plan";
}

const STATUS: Record<string, string> = {
  active: "Active",
  trialing: "Free trial",
  past_due: "Payment failed — Paddle is retrying",
  paused: "Paused",
  canceled: "Canceled",
};

function day(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ billing?: string }> }) {
  const [user, { billing }] = await Promise.all([currentUser(), searchParams]);

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "28px 20px 80px", width: "100%" }}>
      <Link href="/" style={{ textDecoration: "none" }}><Logo size={18} /></Link>
      <h1 className="id-display" style={{ fontSize: "clamp(34px,6vw,52px)", margin: "26px 0 18px", color: "var(--t1)" }}>
        Account
      </h1>
      {!user ? (
        <p style={P}>
          <Link href="/login" style={{ color: "var(--accent)", fontWeight: 600 }}>Sign in</Link>{" "}to manage your subscription.
        </p>
      ) : (
        <Billing user={user} notice={billing} />
      )}
    </main>
  );
}

async function Billing({ user, notice }: { user: { id: number; email: string }; notice?: string }) {
  const subs = await subscriptionsFor(user);
  const current = subs.find(grantsAccess) ?? subs[0];

  return (
    <section style={{ padding: 22, borderRadius: 16, background: "var(--bg2)", border: "1px solid var(--border)" }}>
      <p style={{ ...P, color: "var(--t3)", fontSize: 14 }}>{user.email}</p>
      {current ? (
        <>
          <h2 style={{ margin: "0 0 6px", fontSize: 22, color: "var(--t1)" }}>{planOf(current.priceId)}</h2>
          <p style={P}>{STATUS[current.status] ?? current.status}</p>
          {current.scheduledChangeAction && current.scheduledChangeAt && (
            <p style={P}>
              {current.scheduledChangeAction === "cancel" ? "Ends" : current.scheduledChangeAction === "pause" ? "Pauses" : "Resumes"} on{" "}
              {day(current.scheduledChangeAt)}.
            </p>
          )}
        </>
      ) : (
        <p style={P}>
          No subscription yet.{" "}
          <Link href="/pricing" style={{ color: "var(--accent)", fontWeight: 600 }}>See plans</Link>
        </p>
      )}
      {notice === "none" && <p style={{ ...P, color: "var(--danger)" }}>There&apos;s no billing account for this email yet.</p>}
      {notice === "error" && <p style={{ ...P, color: "var(--danger)" }}>Couldn&apos;t open billing. Try again in a moment.</p>}
      {current && (
        <form action={openBillingPortal}>
          <button
            type="submit"
            style={{
              marginTop: 6, border: 0, borderRadius: 12, padding: "12px 18px", fontSize: 15, fontWeight: 600,
              background: "var(--accent)", color: "var(--accent-ink)", cursor: "pointer",
            }}
          >
            Manage billing
          </button>
          <p style={{ ...P, fontSize: 13.5, color: "var(--t3)", margin: "10px 0 0" }}>
            Update your card, cancel, or download invoices on Paddle&apos;s billing page.
          </p>
        </form>
      )}
    </section>
  );
}
