import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import { currentUser } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { grantsAccess, subscriptionsFor } from "@/lib/stripe-billing";
import { openBillingPortal } from "./actions";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false },
};

const P: React.CSSProperties = { margin: "0 0 12px", color: "var(--t2)", fontSize: 15.5, lineHeight: 1.6 };

function planOf(interval: string): string {
  return interval === "month" ? "Pro · monthly" : interval === "year" ? "Pro · yearly" : "Pro";
}

const STATUS: Record<string, string> = {
  active: "Active",
  trialing: "Free trial",
  past_due: "Payment failed — Stripe is retrying",
  unpaid: "Unpaid",
  paused: "Paused",
  canceled: "Canceled",
  incomplete: "Waiting for payment",
  incomplete_expired: "Payment not completed",
};

// When a subscription that's still on will end, if the player cancelled it.
function endsAt(s: { status: string; cancelAt: Date | null; cancelAtPeriodEnd: boolean; currentPeriodEnd: Date | null }): Date | null {
  if (!grantsAccess(s)) return null;
  return s.cancelAt ?? (s.cancelAtPeriodEnd ? s.currentPeriodEnd : null);
}

function day(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ billing?: string }> }) {
  const [user, { billing }] = await Promise.all([currentUser(), searchParams]);
  const dials = user ? await prisma.device.count({ where: { userId: user.id } }) : 0;

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
        <>
          <Billing user={user} notice={billing} />
          {/* For a player who has a Spellpool Dial. (A new dial shows the address itself.) */}
          {dials > 0 && (
            <p style={{ ...P, marginTop: 18 }}>
              <Link href="/dial" style={{ color: "var(--accent)", fontWeight: 600 }}>Your dials</Link>{" "}— {dials === 1 ? "1 dial" : `${dials} dials`}. Choose the decks each carries.
            </p>
          )}
        </>
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
          <h2 style={{ margin: "0 0 6px", fontSize: 22, color: "var(--t1)" }}>{planOf(current.interval)}</h2>
          <p style={P}>
            {STATUS[current.status] ?? current.status}
            {current.status === "trialing" && current.trialEnd && !endsAt(current) && <> · first payment on {day(current.trialEnd)}</>}
          </p>
          {endsAt(current) && <p style={P}>Ends on {day(endsAt(current)!)}.</p>}
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
            Update your card, cancel, or download invoices on Stripe&apos;s billing page.
          </p>
        </form>
      )}
    </section>
  );
}
