"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CustomerInfo } from "@revenuecat/purchases-js";
import AuthShell, { errorBox, footNote, goldBtn, h1, lede } from "@/components/AuthShell";
import { useProPaywall } from "@/components/GetPro";
import { hasPro, loadCustomerInfo, loadPaywallConfig, PRO_ENTITLEMENT, type PaywallConfig } from "@/lib/pro-paywall";

/* What Pro lifts, in the free plan's own numbers (lib/limits.ts). */
const PERKS = ["Unlimited decks (free holds 5)", "Unlimited AI asks (free gets 4 a day)", "Unlimited deck scans (free gets 1 a day)"];

export default function ProView() {
  const router = useRouter();
  const [cfg, setCfg] = useState<PaywallConfig | null>(null);
  const [info, setInfo] = useState<CustomerInfo | null>(null);

  const refresh = useCallback(async () => {
    const c = await loadPaywallConfig(true);
    setCfg(c);
    setInfo(await loadCustomerInfo());
  }, []);
  const paywall = useProPaywall(refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Signed out: sign in, then come straight back here.
  useEffect(() => {
    if (cfg && !cfg.appUserId) router.replace("/login?next=/pro");
  }, [cfg, router]);

  const pro = cfg?.tier === "pro" || hasPro(info);

  // Arriving free with the paywall on offer: open it, once. Closing it leaves
  // the page below, with a way back in.
  const opened = useRef(false);
  useEffect(() => {
    if (!cfg?.appUserId || pro || !paywall.available || opened.current) return;
    opened.current = true;
    void paywall.open();
  }, [cfg, pro, paywall]);

  if (!cfg || !cfg.appUserId) return <AuthShell>{null}</AuthShell>;

  if (pro) return <ProAccount info={info} syncing={paywall.syncing} />;

  return (
    <AuthShell>
      <h1 style={h1}>Spellpool Pro</h1>
      <p style={lede}>Lifts every limit on the free plan.</p>
      <Perks />
      {paywall.note && <div style={{ ...errorBox, marginBottom: 12 }}>{paywall.note}</div>}
      {paywall.available ? (
        <button onClick={paywall.open} disabled={paywall.busy} style={{ ...goldBtn, width: "100%", opacity: paywall.busy ? 0.7 : 1 }}>
          {paywall.syncing ? "Unlocking Pro…" : paywall.busy ? "Opening…" : "See the plans"}
        </button>
      ) : (
        <p style={{ ...lede, margin: 0 }}>Spellpool Pro is coming soon.</p>
      )}
      <p style={footNote}>
        <Link href="/" style={{ color: "var(--gold)", fontWeight: 600 }}>Back to your decks</Link>
      </p>
    </AuthShell>
  );
}

function Perks() {
  return (
    <ul style={{ margin: "0 0 18px", padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
      {PERKS.map((p) => (
        <li key={p} style={{ fontSize: 14.5, color: "var(--t1)", display: "flex", gap: 9 }}>
          <span style={{ color: "var(--gold)", fontWeight: 800 }}>✓</span> {p}
        </li>
      ))}
    </ul>
  );
}

/* Where the subscription is billed decides where it's managed — the iOS app
   can't cancel a web subscription, and the web can't cancel an Apple one. */
function billedBy(store: string | undefined): string | null {
  switch (store) {
    case "app_store":
    case "mac_app_store":
      return "Billed through the App Store.";
    case "paddle":
      return "Billed by Paddle, our reseller on spellpool.com.";
    case "rc_billing":
    case "stripe":
      return "Billed on spellpool.com.";
    case "play_store":
      return "Billed through Google Play.";
    case "promotional":
      return "Granted by Spellpool — nothing to pay or manage.";
    default:
      return null;
  }
}

function day(d: Date): string {
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function ProAccount({ info, syncing }: { info: CustomerInfo | null; syncing: boolean }) {
  const ent = info?.entitlements.active[PRO_ENTITLEMENT];
  const billing = billedBy(ent?.store);
  const when = ent?.expirationDate
    ? ent.willRenew
      ? `Renews on ${day(ent.expirationDate)}.`
      : `Ends on ${day(ent.expirationDate)} — it won't renew.`
    : null;
  const manage = info?.managementURL ?? null;
  return (
    <AuthShell>
      <h1 style={h1}>You&apos;re on Spellpool Pro</h1>
      <p style={lede}>{syncing ? "Unlocking Pro on your account…" : "Every limit on the free plan is lifted."}</p>
      <Perks />
      {ent?.billingIssueDetectedAt && (
        <div style={{ ...errorBox, marginBottom: 12 }}>The last payment didn&apos;t go through — update it below to keep Pro.</div>
      )}
      {(billing || when) && (
        <p style={{ ...lede, marginBottom: 14 }}>
          {[billing, when].filter(Boolean).join(" ")}
        </p>
      )}
      {manage ? (
        <a href={manage} target="_blank" rel="noopener noreferrer" style={{ ...goldBtn, display: "block", textAlign: "center", textDecoration: "none" }}>
          Manage subscription
        </a>
      ) : (
        ent?.store !== "promotional" && (
          <p style={{ ...lede, margin: 0 }}>Manage or cancel it where you bought it.</p>
        )
      )}
      <p style={footNote}>
        <Link href="/" style={{ color: "var(--gold)", fontWeight: 600 }}>Back to your decks</Link>
      </p>
    </AuthShell>
  );
}
