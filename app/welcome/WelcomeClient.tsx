"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import Logo from "@/components/Logo";
import { FREE_AI_PER_DAY, FREE_PRACTICE_PER_DAY, FREE_SCANS_PER_DAY } from "@/lib/limits";
import { refreshPlan, upgradeFrom } from "@/lib/plan-client";

/* The page after checkout. It asks the server to re-check the subscription
   (the same call the iOS app makes after a purchase) until the account is
   Pro, and shows what just changed: the three daily limits, gone. */

const UNLOCKED: { was: number; what: string; where: string }[] = [
  { was: FREE_AI_PER_DAY, what: "Coach questions", where: "The coach, smart search and primer drafts" },
  { was: FREE_SCANS_PER_DAY, what: "Deck scans", where: "The Score, the bracket and the written analysis" },
  { was: FREE_PRACTICE_PER_DAY, what: "Practice matches", where: "Against the smart opponent" },
];

type Status = "checking" | "on" | "slow";

// Every 2.5 seconds for a minute: RevenueCat usually has the purchase within a few.
const EVERY_MS = 2500;
const TRIES = 24;

export default function WelcomeClient() {
  const [status, setStatus] = useState<Status>("checking");
  const [back, setBack] = useState<string | null>(null);

  useEffect(() => {
    setBack(upgradeFrom());
    let live = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      tries += 1;
      const res = await fetch("/api/subscription/sync", { method: "POST" }).catch(() => null);
      const body = res?.ok ? await res.json().catch(() => null) : null;
      if (!live) return;
      if (body?.tier === "pro") {
        setStatus("on");
        refreshPlan();
        return;
      }
      // Signed out here (another browser, say): asking again won't help.
      if (res?.status === 401 || tries >= TRIES) return setStatus("slow");
      timer = setTimeout(check, EVERY_MS);
    };
    void check();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <main className="wl" data-status={status}>
      <Link href="/" style={{ textDecoration: "none", display: "block", width: "fit-content" }} aria-label="Spellpool home">
        <Logo size={18} />
      </Link>

      <div className="wl-status" role="status">
        <span className="wl-dot" aria-hidden="true">{status === "on" && <Check size={13} strokeWidth={3.5} />}</span>
        {status === "on" ? "Pro is on" : status === "checking" ? "Turning Pro on…" : "Pro is on its way"}
      </div>

      <h1 className="id-display wl-title">
        Welcome to <span>Pro.</span>
      </h1>
      <p className="wl-lede">
        {status === "slow"
          ? "Your subscription is set up. Switching Pro on is taking longer than usual: it will be on within a few minutes, and there is nothing else to do."
          : "Your subscription is set up. The daily limits are gone: ask, scan and play as much as you like."}
      </p>

      <ul className="wl-list">
        {UNLOCKED.map((u, i) => (
          <li key={u.what} className="wl-item" style={{ animationDelay: `${180 + i * 110}ms` }}>
            <span className="wl-was">{u.was} a day</span>
            <span className="wl-now">Unlimited</span>
            <span className="wl-what">{u.what}</span>
            <span className="wl-where">{u.where}</span>
          </li>
        ))}
      </ul>

      <div className="wl-actions">
        <Link href={back ?? "/"} className="id-btn" style={{ padding: "15px 26px", fontSize: 16, textDecoration: "none" }}>
          {back ? "Back to your deck" : "Go to your decks"} <ArrowRight size={17} strokeWidth={2.25} aria-hidden="true" />
        </Link>
        {back && (
          <Link href="/" className="id-ghost" style={{ padding: "14px 22px" }}>
            All your decks
          </Link>
        )}
      </div>

      <p className="wl-foot">
        Stripe emails your receipt. You can change or cancel the plan any time from{" "}
        <Link href="/account" style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 3 }}>your account</Link>.
      </p>
    </main>
  );
}
