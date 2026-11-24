"use client";

import { useState } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import type { PlannedSwap, ReplacePlan } from "@/app/api/decks/[id]/assemble/replace/route";
import { CardArt, scanVersionURL } from "@/components/mtg";
import { ModalShell, ghostBtn, goldBtn } from "./ui";

/* "Replace what I haven't found", from Assemble deck. Three steps: say what
   it does (it costs an AI ask, so nothing starts by itself); show the swaps
   it found, each one to take or leave; make them, in this deck or a new one.
   Nothing changes before the last step. */

type Phase = { at: "intro" } | { at: "looking" } | { at: "review"; plan: ReplacePlan; keep: Set<number> } | { at: "making" };

export interface Replaced {
  /** The deck the swaps were made in: this one, or the new one. */
  deck: string;
  replaced: number;
  copy: boolean;
  /** Replacements the format doesn't allow: their cards stayed. */
  skipped: string[];
}

export default function ReplaceMissing({ deckId, count, onClose, onDone }: { deckId: string; /** Unticked cards that can be swapped. */ count: number; onClose: () => void; onDone: (r: Replaced) => void }) {
  const [phase, setPhase] = useState<Phase>({ at: "intro" });
  const [error, setError] = useState("");
  // What was last on the review, to go back to when making the swaps fails.
  const [last, setLast] = useState<{ plan: ReplacePlan; keep: Set<number> } | null>(null);

  const send = async (body: unknown) => {
    try {
      const r = await fetch(`/api/decks/${deckId}/assemble/replace`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => null);
      return { ok: r.ok, data: d as Record<string, unknown> | null };
    } catch {
      return { ok: false, data: null };
    }
  };

  async function look() {
    setError("");
    setPhase({ at: "looking" });
    const { ok, data } = await send({});
    if (!ok || !data) {
      setError(typeof data?.error === "string" ? data.error : "Couldn’t look just now. Try again.");
      setPhase({ at: "intro" });
      return;
    }
    const plan = data as unknown as ReplacePlan;
    setPhase({ at: "review", plan, keep: new Set(plan.swaps.map((s) => s.outId)) });
  }

  async function make(as: "deck" | "copy") {
    if (phase.at !== "review") return;
    const { plan, keep } = phase;
    const swaps = plan.swaps.filter((s) => keep.has(s.outId)).map((s) => ({ outId: s.outId, in: s.in }));
    if (!swaps.length) return;
    setError("");
    setLast({ plan, keep });
    setPhase({ at: "making" });
    const { ok, data } = await send({ swaps, as });
    if (!ok || !data || typeof data.deck !== "string") {
      setError(typeof data?.error === "string" ? data.error : "Couldn’t make the swaps. Nothing was changed. Try again.");
      setPhase({ at: "review", plan, keep });
      return;
    }
    onDone({ deck: data.deck, replaced: Number(data.replaced) || 0, copy: as === "copy", skipped: Array.isArray(data.skipped) ? (data.skipped as string[]) : [] });
  }

  const toggle = (id: number) => {
    if (phase.at !== "review") return;
    const keep = new Set(phase.keep);
    if (keep.has(id)) keep.delete(id);
    else keep.add(id);
    setPhase({ ...phase, keep });
  };

  const review = phase.at === "review" ? phase : phase.at === "making" ? last : null;
  const kept = review ? review.plan.swaps.filter((s) => review.keep.has(s.outId)).length : 0;
  const busy = phase.at === "looking" || phase.at === "making";

  return (
    <ModalShell onDismiss={busy ? () => {} : onClose} maxWidth={520} zIndex={90} labelledBy="replace-title">
      {/* The frame pads and scrolls; this only lays out. In the review the
          list is what scrolls, so the buttons stay in reach. */}
      <div style={{ display: "flex", flexDirection: "column", maxHeight: "calc(88vh - 50px)" }}>
        <h3 id="replace-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: 9, fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, lineHeight: 1.2, color: "var(--frame-ink)" }}>
          <Sparkles size={20} strokeWidth={2} style={{ flex: "none" }} /> Replace missing cards
        </h3>

        {!review && (
          <>
            <p style={{ margin: "10px 0 12px", fontSize: 15, lineHeight: 1.45, color: "var(--t1)" }}>
              For each of the {count} {count === 1 ? "card" : "cards"} you haven’t ticked, Spellpool picks a card you own that does the same job.
            </p>
            <ul style={{ listStyle: "none", margin: "0 0 14px", padding: 0, display: "flex", flexDirection: "column", gap: 7, fontSize: 13.5, lineHeight: 1.4, color: "var(--t2)" }}>
              {["Only cards that aren’t in another of your decks.", "Your commander and basic lands stay.", "You see every swap first, and choose which to keep."].map((line) => (
                <li key={line} style={{ display: "flex", gap: 8 }}>
                  <Check size={15} strokeWidth={2.75} style={{ flex: "none", marginTop: 2, color: "var(--gold)" }} />
                  {line}
                </li>
              ))}
            </ul>
            {error && <p role="alert" style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.4, color: "#ff9c86" }}>{error}</p>}
            {phase.at === "looking" ? (
              <p role="status" style={{ margin: "4px 0 2px", fontSize: 14.5, color: "var(--t1)", fontWeight: 600 }}>Looking through your collection… This can take a minute.</p>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={onClose} style={{ ...ghostBtn, flex: "none", padding: "10px 16px" }}>Cancel</button>
                  <button onClick={() => void look()} style={{ ...goldBtn, flex: 1, padding: "10px 16px", whiteSpace: "nowrap" }}>
                    <Sparkles size={15} strokeWidth={2.25} style={{ flex: "none" }} /> Find replacements
                  </button>
                </div>
                <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--t3)", textAlign: "center" }}>On the free plan this uses today’s coach question.</p>
              </>
            )}
          </>
        )}

        {review && (
          <>
            <p style={{ margin: "8px 0 6px", fontSize: 13.5, color: "var(--t2)", lineHeight: 1.45 }}>
              {review.plan.swaps.length ? "Untick a swap to keep the card the deck has now." : "Nothing spare in your collection fits this deck. The cards stay as they are."}
            </p>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
              <ul data-testid="replace-swaps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {review.plan.swaps.map((s) => (
                  <SwapRow key={s.outId} swap={s} on={review.keep.has(s.outId)} disabled={phase.at === "making"} onToggle={() => toggle(s.outId)} />
                ))}
              </ul>
              {review.plan.unmatched.length > 0 && (
                <p style={{ margin: "10px 0 4px", fontSize: 13, color: "var(--t3)", lineHeight: 1.45 }}>
                  Nothing in your collection for {review.plan.unmatched.length === 1 ? "this one" : `these ${review.plan.unmatched.length}`}, so {review.plan.unmatched.length === 1 ? "it stays" : "they stay"}: {review.plan.unmatched.join(", ")}.
                </p>
              )}
            </div>
            <div style={{ paddingTop: 14 }}>
              {error && <p role="alert" style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.4, color: "#ff9c86" }}>{error}</p>}
              {phase.at === "making" ? (
                <p role="status" style={{ margin: 0, fontSize: 14.5, color: "var(--t1)", fontWeight: 600 }}>Making the swaps…</p>
              ) : (
                <>
                  {/* The main choice takes a whole line; the two others share the next. */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {kept > 0 && (
                      <button onClick={() => void make("deck")} style={{ ...goldBtn, flex: "1 1 100%", padding: "10px 16px", whiteSpace: "nowrap" }}>
                        <Check size={15} strokeWidth={3} style={{ flex: "none" }} /> Update this deck ({kept})
                      </button>
                    )}
                    {kept > 0 && (
                      <button onClick={() => void make("copy")} style={{ ...ghostBtn, flex: "1 1 0", padding: "9px 12px", whiteSpace: "nowrap" }} title="This deck stays as it is. A new deck gets the swaps.">
                        Make a new deck
                      </button>
                    )}
                    <button onClick={onClose} style={{ ...ghostBtn, flex: "1 1 0", padding: "9px 12px", whiteSpace: "nowrap" }}>{review.plan.swaps.length ? "Cancel" : "Close"}</button>
                  </div>
                  {kept > 0 && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--t3)", textAlign: "center" }}>Updating keeps the list as it is now in Versions.</p>}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

function SwapRow({ swap, on, disabled, onToggle }: { swap: PlannedSwap; on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <li style={{ borderBottom: "1px solid var(--line)" }}>
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-label={`Replace ${swap.out} with ${swap.in}`}
        disabled={disabled}
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 0", border: "none", background: "none", cursor: disabled ? "default" : "pointer", textAlign: "left", fontFamily: "var(--font-ui)", color: "var(--t1)", opacity: on ? 1 : 0.55 }}
      >
        <span style={{ flex: "none", width: 22, height: 22, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", background: on ? "var(--gold)" : "transparent", boxShadow: on ? "none" : "inset 0 0 0 2px var(--line)", color: "var(--bg)" }}>
          {on && <Check size={15} strokeWidth={3.25} />}
        </span>
        <span style={{ flex: "1 1 0", minWidth: 0 }}>
          {/* On a narrow screen the two names don't fit on a line: the new one goes under the old, both whole. */}
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 6, rowGap: 1, fontSize: 14.5, fontWeight: 600 }}>
            <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--t3)", textDecoration: on ? "line-through" : "none" }}>{swap.out}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, maxWidth: "100%" }}>
              <ArrowRight size={14} strokeWidth={2.5} style={{ flex: "none", color: "var(--t3)" }} />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{swap.in}</span>
            </span>
          </span>
          {swap.why && <span style={{ display: "block", marginTop: 2, fontSize: 12.5, color: "var(--t2)" }}>{swap.why}</span>}
        </span>
        <span style={{ flex: "none", width: 38, height: 53, borderRadius: 4, overflow: "hidden", background: "var(--bg3)" }}>
          <CardArt name={swap.in} src={scanVersionURL(swap.imageUri || undefined, "small") ?? (swap.imageUri || undefined)} prefer="src" version="small" loading="lazy" radius={0} style={{ width: "100%", height: "100%" }} />
        </span>
      </button>
    </li>
  );
}
