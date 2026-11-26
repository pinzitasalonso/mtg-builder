"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, ScanSearch, Sparkles, Swords, X } from "lucide-react";
import { FIRST_STEPS, stepsHeading, type FirstSteps as Steps, type StepId } from "@/lib/first-steps";
import { rememberUpgradeFrom } from "@/lib/plan-client";

const ICONS = { coach: Sparkles, match: Swords, score: ScanSearch } as const;

/** A deck needs this many cards before a scan says anything (the deck
    page's own rule for its Scan button). */
const SCORE_MIN_CARDS = 40;

/** On home, for a free account that hasn't tried all three: what the free
    plan gives every day, and a way into each. A new account used to be told
    none of this; most never found the Deck Score. A step that's been tried
    is ticked, and the block goes once all three are (or when it's put away). */
export default function FirstSteps({
  steps,
  deck,
  onCoach,
  onNewDeck,
}: {
  steps: Steps;
  /** The player's fullest deck, for the two steps that need one. */
  deck: { publicId: string; name: string; cards: number } | null;
  onCoach: () => void;
  onNewDeck: () => void;
}) {
  const [off, setOff] = useState(false);
  if (off) return null;

  function putAway() {
    setOff(true);
    // Kept on the account: the server leaves the block out from now on.
    // If this doesn't get through, it's back on the next visit.
    void fetch("/api/first-steps", { method: "POST" }).catch(() => {});
  }

  // Where a step leads: the coach opens here; a match and a Score open on
  // the deck (its page reads ?open=). With no deck that will do, the step
  // says so and leads to building one.
  const ready = (id: StepId) => id === "coach" || (!!deck && deck.cards >= (id === "score" ? SCORE_MIN_CARDS : 1));
  const go = (id: StepId) => (id === "match" ? "Play" : id === "score" ? "Score" : "Ask");

  return (
    <section className="fs" aria-label="Your free plan">
      <header className="fs-head">
        <div>
          <div className="id-label fs-label">Your free plan</div>
          <h3 className="fs-title">{stepsHeading()}</h3>
        </div>
        <div className="fs-side">
          <Link href="/pricing" onClick={rememberUpgradeFrom} className="fs-pro">
            Pro has no daily limit <ArrowRight size={14} strokeWidth={2.25} aria-hidden="true" />
          </Link>
          <button type="button" className="fs-close" onClick={putAway} aria-label="Hide this">
            <X size={16} strokeWidth={2.25} />
          </button>
        </div>
      </header>
      <div className="fs-steps">
        {FIRST_STEPS.map((s) => {
          const Icon = ICONS[s.id];
          const body = (
            <>
              <span className="fs-icon" aria-hidden="true">
                <Icon size={18} strokeWidth={2} />
              </span>
              <span className="fs-body">
                <span className="fs-step-title">{s.title}</span>
                <span className="fs-step-text">{s.text}</span>
                <span className="fs-foot">
                  <span className="fs-daily">{s.daily}</span>
                  {steps[s.id] ? (
                    <span className="fs-tried">
                      <Check size={13} strokeWidth={2.75} aria-hidden="true" /> Tried
                    </span>
                  ) : (
                    <span className="fs-go">
                      {ready(s.id) ? go(s.id) : "Build a deck first"} <ArrowRight size={13} strokeWidth={2.5} aria-hidden="true" />
                    </span>
                  )}
                </span>
              </span>
            </>
          );
          const done = steps[s.id] ? "true" : undefined;
          if (s.id === "coach")
            return (
              <button key={s.id} type="button" className="fs-step" data-done={done} onClick={onCoach}>
                {body}
              </button>
            );
          if (!ready(s.id))
            return deck ? (
              <Link key={s.id} href={`/deck/${deck.publicId}`} className="fs-step" data-done={done}>
                {body}
              </Link>
            ) : (
              <button key={s.id} type="button" className="fs-step" data-done={done} onClick={onNewDeck}>
                {body}
              </button>
            );
          return (
            <Link key={s.id} href={`/deck/${deck!.publicId}?open=${s.id}`} className="fs-step" data-done={done} title={`${s.title}: ${deck!.name}`}>
              {body}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
