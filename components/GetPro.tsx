"use client";

/* The way to Spellpool Pro on the web, wherever a free plan runs out — the
   same moments the iOS app raises its ProPaywallSheet: the account (here, the
   home header), a spent AI budget, a spent scan, a full deck shelf.

   Renders nothing until the deployment offers the web paywall (see
   /api/subscription/config), so the free plan's messages stand on their own
   until then, the way the iOS app hides Upgrade when RevenueCat isn't keyed. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { loadPaywallConfig, presentProPaywall, syncSubscription } from "@/lib/pro-paywall";

export function useProPaywall(onUpgraded?: () => void) {
  const [available, setAvailable] = useState(false);
  // "opening" covers loading the SDK and the offering; "syncing" is the few
  // seconds after a purchase while the server confirms it with RevenueCat.
  const [phase, setPhase] = useState<"idle" | "opening" | "syncing">("idle");
  const [note, setNote] = useState<string | null>(null);
  // The latest callback, without making `open` change identity every render.
  const upgraded = useRef(onUpgraded);
  useEffect(() => {
    upgraded.current = onUpgraded;
  });

  useEffect(() => {
    let live = true;
    loadPaywallConfig().then((c) => live && setAvailable(Boolean(c.apiKey)));
    return () => {
      live = false;
    };
  }, []);

  // A note says its piece and goes.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 8000);
    return () => clearTimeout(t);
  }, [note]);

  const open = useCallback(async () => {
    if (phase !== "idle") return;
    setPhase("opening");
    setNote(null);
    try {
      const out = await presentProPaywall();
      if (out.status === "signed-out") {
        // Pro belongs to an account. /pro reopens the paywall once signed in.
        window.location.assign("/login?next=/pro");
        return;
      }
      if (out.status === "unavailable") setAvailable(false);
      if (out.status === "failed") setNote(out.message);
      if (out.status === "purchased" || out.status === "already-pro") {
        setPhase("syncing");
        const tier = await syncSubscription(3);
        if (tier !== "pro") setNote("Pro is on its way — it can take a minute to show up. Reload if it hasn't.");
        upgraded.current?.();
      }
    } finally {
      setPhase("idle");
    }
  }, [phase]);

  return { available, busy: phase !== "idle", syncing: phase === "syncing", note, open };
}

/* A "Get Pro" control. `pill` is the gold button for headers and panels;
   `link` sits inline after a limit message. */
export function GetProButton({
  onUpgraded,
  variant = "link",
  label = "Get Pro",
}: {
  onUpgraded?: () => void;
  variant?: "pill" | "link";
  label?: string;
}) {
  const { available, busy, syncing, note, open } = useProPaywall(onUpgraded);
  if (!available) return null;
  const text = syncing ? "Unlocking Pro…" : label;
  if (variant === "pill") {
    return (
      <>
        <button onClick={open} disabled={busy} className="id-btn home-icon-btn" style={{ padding: "9px 16px", opacity: busy ? 0.7 : 1 }} aria-label={label}>
          <Sparkles size={15} strokeWidth={2.25} /> <span className="home-hide">{text}</span>
        </button>
        {/* A header has no room for a sentence: the note floats instead. */}
        {note && <Toast>{note}</Toast>}
      </>
    );
  }
  return (
    <>
      <button
        onClick={open}
        disabled={busy}
        style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: "var(--gold)", cursor: busy ? "default" : "pointer", whiteSpace: "nowrap" }}
      >
        {text}
      </button>
      {note && (
        <>
          {" "}
          <span style={{ color: "var(--t3)", fontWeight: 400 }}>{note}</span>
        </>
      )}
    </>
  );
}

function Toast({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 24,
        transform: "translateX(-50%)",
        zIndex: 60,
        maxWidth: "min(440px, calc(100vw - 32px))",
        padding: "10px 16px",
        borderRadius: 12,
        background: "var(--bg2)",
        border: "1px solid var(--line)",
        color: "var(--t1)",
        fontSize: 13.5,
        lineHeight: 1.45,
        boxShadow: "0 10px 30px rgba(0,0,0,.35)",
      }}
    >
      {children}
    </div>
  );
}
