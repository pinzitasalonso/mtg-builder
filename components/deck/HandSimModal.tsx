"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { PoolEntry } from "@/lib/pool-client";
import { hypergeometricAtLeast, hypergeometric, shuffled } from "@/lib/probability";
import { ModalShell, ghostBtn, goldBtn } from "./ui";

const isLand = (c: { typeLine: string | null }) => /\bLand\b/.test(c.typeLine ?? "");

/* Sample-hand simulator — draws opening hands from the deck board and shows
   hypergeometric land odds. Pure client-side; state resets on close. */
export default function HandSimModal({
  cards,
  sourceLabel,
  onClose,
}: {
  cards: PoolEntry[]; // already the chosen board, quantities included
  sourceLabel: string;
  onClose: () => void;
}) {
  // Expand quantities into a flat library.
  const library = useMemo(() => {
    const lib: PoolEntry[] = [];
    for (const c of cards) for (let i = 0; i < c.quantity; i++) lib.push(c);
    return lib;
  }, [cards]);

  const landCount = useMemo(() => library.filter(isLand).length, [library]);

  const [handSize, setHandSize] = useState(7);
  const [hand, setHand] = useState<PoolEntry[]>(() => shuffled(library).slice(0, 7));
  const [draws, setDraws] = useState(0); // extra cards drawn after the opener

  function newHand(size: number) {
    setHandSize(size);
    setDraws(0);
    setHand(shuffled(library).slice(0, size));
  }
  function drawOne() {
    // Redraw a fresh shuffle each time would change the hand — instead draw
    // from the cards not currently in hand (sample without replacement).
    const inHand = new Map<string, number>();
    for (const c of hand) inHand.set(c.dbId + "", (inHand.get(c.dbId + "") ?? 0) + 1);
    const rest = library.filter((c) => {
      const k = c.dbId + "";
      const n = inHand.get(k) ?? 0;
      if (n > 0) {
        inHand.set(k, n - 1);
        return false;
      }
      return true;
    });
    if (rest.length === 0) return;
    setHand((h) => [...h, shuffled(rest)[0]]);
    setDraws((d) => d + 1);
  }

  const landsInHand = hand.filter(isLand).length;
  const N = library.length;

  // Odds table — chance of ≥k lands in a fresh 7 and in the top 10 (turn 3 on the draw).
  const odds = [2, 3, 4].map((k) => ({
    k,
    open: hypergeometricAtLeast(N, landCount, Math.min(7, N), k),
    t3: hypergeometricAtLeast(N, landCount, Math.min(10, N), k),
  }));
  const noLand = N >= 7 ? hypergeometric(N, landCount, 7, 0) : 0;

  const pct = (p: number) => `${Math.round(p * 100)}%`;

  return (
    <ModalShell onDismiss={onClose} maxWidth={560}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--frame-ink)" }}>
          Sample hand 🎲
        </h2>
        <button onClick={onClose} style={{ ...ghostBtn, padding: "6px 12px" }}>Close</button>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13.5, fontStyle: "normal", color: "var(--t2)" }}>
        Drawing from {sourceLabel} — {N} cards, {landCount} lands.
      </p>

      {N < 7 ? (
        <div style={{ color: "var(--danger)", fontSize: 14, padding: "10px 14px", background: "rgba(194,64,42,.07)", borderRadius: 10, boxShadow: "inset 0 0 0 1px rgba(194,64,42,.25)" }}>
          Not enough cards to draw a hand — you need at least 7.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* hand */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(86px, 1fr))", gap: 8 }}>
            {hand.map((c, i) => (
              <div key={i} style={{ position: "relative", borderRadius: 6, overflow: "hidden", boxShadow: i >= handSize ? "0 0 0 2px var(--gold)" : "0 2px 6px rgba(21,21,26,.15)" }} title={c.name}>
                {c.imageUri ? (
                  <Image src={c.imageUri} alt={c.name} width={86} height={120} style={{ width: "100%", height: "auto", display: "block" }} unoptimized />
                ) : (
                  <div style={{ aspectRatio: "0.716", background: "var(--bg3)", color: "var(--t1)", fontSize: 11, padding: 6 }}>{c.name}</div>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <span style={{ fontSize: 14, color: "var(--frame-ink)" }}>
              <b>{landsInHand}</b> land{landsInHand === 1 ? "" : "s"} in hand
              {draws > 0 ? ` · ${draws} drawn` : ""}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={drawOne} style={ghostBtn} disabled={hand.length >= N}>Draw</button>
              <button onClick={() => newHand(Math.max(4, handSize - 1))} style={ghostBtn} disabled={handSize <= 4}>
                Mulligan to {Math.max(4, handSize - 1)}
              </button>
              <button onClick={() => newHand(7)} style={goldBtn}>New hand</button>
            </div>
          </div>

          {/* odds */}
          <div style={{ background: "rgba(0,0,0,.18)", borderRadius: 8, padding: "10px 14px" }}>
            <div className="label-sc" style={{ fontSize: 11.5, color: "var(--t2)", letterSpacing: ".1em", marginBottom: 8 }}>
              Land odds
            </div>
            <table style={{ width: "100%", fontSize: 13.5, color: "var(--frame-ink)", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "right", color: "var(--t3)" }}>
                  <th style={{ textAlign: "left", fontWeight: 500, paddingBottom: 4 }}></th>
                  <th style={{ fontWeight: 500 }}>Opening 7</th>
                  <th style={{ fontWeight: 500 }}>By turn 3*</th>
                </tr>
              </thead>
              <tbody>
                {odds.map((o) => (
                  <tr key={o.k} style={{ textAlign: "right" }}>
                    <td style={{ textAlign: "left", padding: "2px 0" }}>≥ {o.k} lands</td>
                    <td>{pct(o.open)}</td>
                    <td>{pct(o.t3)}</td>
                  </tr>
                ))}
                <tr style={{ textAlign: "right", color: "#e8b09a" }}>
                  <td style={{ textAlign: "left", padding: "2px 0" }}>0 lands (mull)</td>
                  <td>{pct(noLand)}</td>
                  <td>—</td>
                </tr>
              </tbody>
            </table>
            <div style={{ fontSize: 11.5, fontStyle: "normal", color: "var(--t3)", marginTop: 6 }}>
              *top 10 cards — 7 + three draws, on the draw.
            </div>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
