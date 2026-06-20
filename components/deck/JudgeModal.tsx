"use client";

import { useEffect, useState } from "react";
import { PoolEntry, poolByName, resolveAndAdd } from "@/lib/pool-client";
import { ModalShell, ghostBtn } from "./ui";

interface JudgeResult {
  summary: string;
  working: string[];
  cuts: string[];
  missing: string[];
}

/* AI pool judge — sends the pool to /api/judge on mount and renders the
   structured verdict. "Missing" suggestions are tappable to add. */
export default function JudgeModal({
  deckId,
  pool,
  format,
  commander,
  onClose,
  onPoolChanged,
}: {
  deckId: string;
  pool: PoolEntry[];
  format?: string;
  commander?: string | null;
  onClose: () => void;
  onPoolChanged: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [judge, setJudge] = useState<JudgeResult | null>(null);
  const [adds, setAdds] = useState<Record<string, "adding" | "added" | "error">>({});

  // Run the judge once per mount — reopening the modal re-runs it on the
  // current pool.
  useEffect(() => {
    if (pool.length === 0) {
      setError("Add some cards to the pool first.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/judge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cards: pool.map((c) => ({ name: c.name, manaCost: c.manaCost, typeLine: c.typeLine, quantity: c.quantity })),
            format,
            commander,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(data.details ?? data.error ?? "AI judge failed");
        else setJudge(data as JudgeResult);
      } catch {
        if (!cancelled) setError("Network error");
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tap a suggested "missing" card to add it straight to the pool.
  async function addSuggested(name: string) {
    if (adds[name] === "adding" || adds[name] === "added") return;
    setAdds((m) => ({ ...m, [name]: "adding" }));
    const r = await resolveAndAdd(deckId, name, 1, poolByName(pool));
    setAdds((m) => ({ ...m, [name]: r === "added" ? "added" : "error" }));
    if (r === "added") onPoolChanged();
  }

  return (
    <ModalShell onDismiss={onClose} maxWidth={520} zIndex={72}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--frame-ink)" }}>
          AI Pool Judge ✨
        </h2>
        <button onClick={onClose} style={{ ...ghostBtn, padding: "6px 12px" }}>Close</button>
      </div>

      {loading && (
        <p style={{ margin: 0, fontStyle: "normal", color: "var(--t2)", fontSize: 15 }}>
          Consulting the oracle… analyzing {pool.length} cards.
        </p>
      )}
      {error && !loading && (
        <div style={{ color: "var(--danger)", fontSize: 14, padding: "10px 14px", background: "rgba(194,64,42,.07)", borderRadius: 10, boxShadow: "inset 0 0 0 1px rgba(194,64,42,.25)" }}>
          {error}
        </div>
      )}

      {judge && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {judge.summary && (
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "var(--frame-ink)" }}>{judge.summary}</p>
          )}
          {judge.working.length > 0 && (
            <JudgeSection title="Working well" color="#0d8a5f">
              {judge.working.map((w, i) => <JudgeLi key={i}>{w}</JudgeLi>)}
            </JudgeSection>
          )}
          {judge.cuts.length > 0 && (
            <JudgeSection title="Weakest — consider cutting" color="#cf7d5e">
              {judge.cuts.map((w, i) => <JudgeLi key={i}>{w}</JudgeLi>)}
            </JudgeSection>
          )}
          {judge.missing.length > 0 && (
            <JudgeSection title="Key cards missing — tap to add" color="var(--gold)">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                {judge.missing.map((name) => {
                  const st = adds[name];
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => addSuggested(name)}
                      disabled={st === "adding" || st === "added"}
                      style={{
                        padding: "7px 13px",
                        borderRadius: 16,
                        border: "none",
                        cursor: st === "added" || st === "adding" ? "default" : "pointer",
                        fontFamily: "var(--font-body)",
                        fontSize: 14,
                        background: st === "added" ? "rgba(13,138,95,.12)" : "rgba(0,0,0,.22)",
                        color: "var(--frame-ink)",
                        boxShadow: "inset 0 0 0 1px var(--line)",
                      }}
                    >
                      {name}{" "}
                      <span style={{ opacity: 0.85 }}>
                        {st === "adding" ? "…" : st === "added" ? "✓" : st === "error" ? "✕" : "+"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </JudgeSection>
          )}
        </div>
      )}
    </ModalShell>
  );
}

function JudgeSection({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label-sc" style={{ fontSize: 12, color, letterSpacing: ".1em", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>{children}</div>
    </div>
  );
}

function JudgeLi({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 14, lineHeight: 1.45, color: "var(--frame-ink)" }}>
      <span style={{ color: "var(--t3)", flexShrink: 0 }}>•</span>
      <span>{children}</span>
    </div>
  );
}
