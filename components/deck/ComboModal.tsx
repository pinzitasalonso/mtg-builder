"use client";

import { useEffect, useState } from "react";
import { PoolEntry, poolByName, resolveAndAdd } from "@/lib/pool-client";
import { ModalShell, ghostBtn } from "./ui";

interface Combo {
  id: string;
  cards: string[];
  produces: string[];
  missing: string[];
  description: string;
}

interface ComboResponse {
  included: Combo[];
  almostIncluded: Combo[];
  totalIncluded: number;
  totalAlmost: number;
}

/* Combo detection via Commander Spellbook — shows combos already in the pool
   and combos one missing card away (tappable to add). */
export default function ComboModal({
  deckId,
  pool,
  commander,
  onClose,
  onPoolChanged,
}: {
  deckId: number;
  pool: PoolEntry[];
  commander?: string | null;
  onClose: () => void;
  onPoolChanged: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [combos, setCombos] = useState<ComboResponse | null>(null);
  const [adds, setAdds] = useState<Record<string, "adding" | "added" | "error">>({});
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (pool.length === 0) {
      setError("Add some cards first.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/combos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cards: pool.map((c) => c.name),
            commanders: commander ? [commander] : [],
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(data.error ?? "Combo lookup failed");
        else setCombos(data as ComboResponse);
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

  async function addMissing(name: string) {
    if (adds[name] === "adding" || adds[name] === "added") return;
    setAdds((m) => ({ ...m, [name]: "adding" }));
    const r = await resolveAndAdd(deckId, name, 1, poolByName(pool));
    setAdds((m) => ({ ...m, [name]: r === "added" ? "added" : "error" }));
    if (r === "added") onPoolChanged();
  }

  function ComboCard({ combo, almost }: { combo: Combo; almost: boolean }) {
    const expanded = open === combo.id;
    return (
      <div
        style={{ background: "rgba(0,0,0,.2)", borderRadius: 8, padding: "10px 13px", cursor: combo.description ? "pointer" : "default" }}
        onClick={() => setOpen(expanded ? null : combo.id)}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {combo.cards.map((name, i) => {
            const miss = combo.missing.includes(name);
            const st = adds[name];
            return (
              <span key={name} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {i > 0 && <span style={{ color: "var(--t3)" }}>+</span>}
                {miss && almost ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      addMissing(name);
                    }}
                    disabled={st === "adding" || st === "added"}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 13,
                      border: "none",
                      cursor: st === "added" || st === "adding" ? "default" : "pointer",
                      fontFamily: "var(--font-body)",
                      fontSize: 13.5,
                      background: st === "added" ? "rgba(13,138,95,.12)" : "rgba(39,66,214,.08)",
                      color: "var(--frame-ink)",
                      boxShadow: "inset 0 0 0 1px var(--line)",
                    }}
                  >
                    {name} <span style={{ opacity: 0.85 }}>{st === "adding" ? "…" : st === "added" ? "✓" : st === "error" ? "✕" : "+"}</span>
                  </button>
                ) : (
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--frame-ink)" }}>{name}</span>
                )}
              </span>
            );
          })}
        </div>
        {combo.produces.length > 0 && (
          <div style={{ fontSize: 13, fontStyle: "normal", color: "var(--t2)", marginTop: 5 }}>
            → {combo.produces.join(" · ")}
          </div>
        )}
        {expanded && combo.description && (
          <div style={{ fontSize: 13, color: "var(--t2)", marginTop: 8, whiteSpace: "pre-line", lineHeight: 1.45 }}>
            {combo.description}
          </div>
        )}
      </div>
    );
  }

  return (
    <ModalShell onDismiss={onClose} maxWidth={560}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--frame-ink)" }}>
          Combos ♾
        </h2>
        <button onClick={onClose} style={{ ...ghostBtn, padding: "6px 12px" }}>Close</button>
      </div>

      {loading && (
        <p style={{ margin: 0, fontStyle: "normal", color: "var(--t2)", fontSize: 15 }}>
          Searching Commander Spellbook… checking {pool.length} cards.
        </p>
      )}
      {error && !loading && (
        <div style={{ color: "var(--danger)", fontSize: 14, padding: "10px 14px", background: "rgba(194,64,42,.07)", borderRadius: 10, boxShadow: "inset 0 0 0 1px rgba(194,64,42,.25)" }}>
          {error}
        </div>
      )}

      {combos && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {combos.included.length === 0 && combos.almostIncluded.length === 0 && (
            <p style={{ margin: 0, fontStyle: "normal", color: "var(--t2)", fontSize: 14.5 }}>
              No known combos in this pool yet — and none within one card. Keep brewing!
            </p>
          )}
          {combos.included.length > 0 && (
            <div>
              <div className="label-sc" style={{ fontSize: 12, color: "#0d8a5f", letterSpacing: ".1em", marginBottom: 8 }}>
                In your pool · {combos.totalIncluded}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {combos.included.map((c) => <ComboCard key={c.id} combo={c} almost={false} />)}
              </div>
            </div>
          )}
          {combos.almostIncluded.length > 0 && (
            <div>
              <div className="label-sc" style={{ fontSize: 12, color: "var(--gold)", letterSpacing: ".1em", marginBottom: 8 }}>
                One card away · {combos.totalAlmost} — tap the missing piece to add
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {combos.almostIncluded.map((c) => <ComboCard key={c.id} combo={c} almost />)}
              </div>
            </div>
          )}
          <div style={{ fontSize: 11.5, fontStyle: "normal", color: "var(--t3)" }}>
            Data: Commander Spellbook.
          </div>
        </div>
      )}
    </ModalShell>
  );
}
