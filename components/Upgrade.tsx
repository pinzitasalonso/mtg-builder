"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { FREE_AI_PER_DAY, FREE_SCANS_PER_DAY, utcDay } from "@/lib/limits";
import { rememberUpgradeFrom, usePlan } from "@/lib/plan-client";

/* The ways to Spellpool Pro that sit inside the app: the pill in a header,
   the notice where a daily limit was just reached, and the bar across a deck
   once today's free questions or scans are gone. All three go to /pricing. */

/** A header's plan pill for a free account: what's left today, then Go Pro.
    `left` is the coach questions left; omit it to show only the button. */
export function PlanPill({ left, className = "" }: { left?: number | null; className?: string }) {
  const spent = left === 0;
  const count =
    typeof left !== "number" ? null : spent ? `No coach questions left today` : `${left} coach ${left === 1 ? "question" : "questions"} left today`;
  return (
    <Link
      href="/pricing"
      onClick={rememberUpgradeFrom}
      className={`plan-pill ${className}`}
      data-spent={spent || undefined}
      title="Free plan. Spellpool Pro has no daily limits."
      aria-label={count ? `${count}. Go Pro` : "Go Pro"}
    >
      {count && <span className="plan-count">{count}</span>}
      <span className="plan-go">Go Pro</span>
    </Link>
  );
}

/** A reached limit, said where it happened, with the way past it. `text` is
    the route's own message (lib/limits.ts). */
export function LimitNotice({ text, style }: { text: string; style?: React.CSSProperties }) {
  return (
    <div role="alert" className="limit-note" style={style}>
      <span className="limit-note-text">{text}</span>
      <Link href="/pricing" onClick={rememberUpgradeFrom} className="id-btn limit-note-go">
        See Spellpool Pro <ArrowRight size={15} strokeWidth={2.5} aria-hidden="true" />
      </Link>
    </div>
  );
}

const many = (n: number, one: string, more: string) => (n === 1 ? `today's free ${one}` : `today's ${n} free ${more}`);

/** Across the top of a deck, for a free account that has used up today's
    coach questions or deck scans. It can be put away for the day. */
export function LimitBar() {
  const plan = usePlan();
  const key = `sp-limit-bar-${utcDay()}`;
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem(key) === "1");
    } catch {
      setHidden(false);
    }
  }, [key]);
  if (!plan || !plan.signedIn || plan.pro || hidden) return null;
  const noAi = plan.ai === 0;
  const noScans = plan.scans === 0;
  if (!noAi && !noScans) return null;
  const what =
    noAi && noScans
      ? "today's free coach questions and deck scans"
      : noAi
        ? many(FREE_AI_PER_DAY, "coach question", "coach questions")
        : many(FREE_SCANS_PER_DAY, "deck scan", "deck scans");
  return (
    <div className="limit-bar" role="status">
      <span className="limit-bar-text">
        <b>You&apos;ve used {what}.</b> <span className="limit-bar-more">Spellpool Pro has no daily limits.</span>
      </span>
      <Link href="/pricing" onClick={rememberUpgradeFrom} className="id-btn limit-bar-go">
        Go Pro
      </Link>
      <button
        type="button"
        className="limit-bar-x"
        aria-label="Hide until tomorrow"
        onClick={() => {
          try {
            sessionStorage.setItem(key, "1");
          } catch {}
          setHidden(true);
        }}
      >
        <X size={16} strokeWidth={2.25} />
      </button>
    </div>
  );
}
