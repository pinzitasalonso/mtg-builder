"use client";

import type { CSSProperties, ReactNode } from "react";
import { CardArt } from "@/components/mtg";
import type { LandingFeature } from "@/lib/landing";

/* Small illustrations for the landing page's feature cards: real card images
   and miniature versions of the app's own UI, so the section shows what each
   feature looks like instead of only saying it. Decorative (aria-hidden): the
   card's heading and text carry the meaning. */

const frame: CSSProperties = {
  height: 132,
  borderRadius: 14,
  background: "var(--bg)",
  boxShadow: "inset 0 0 0 1px var(--line)",
  marginBottom: 16,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  overflow: "hidden",
  position: "relative",
  padding: 12,
};

function Mini({ name, w = 52, style }: { name: string; w?: number; style?: CSSProperties }) {
  return (
    <div style={{ width: w, height: Math.round(w * 1.4), flex: "none", borderRadius: 5, overflow: "hidden", boxShadow: "0 6px 14px -6px rgba(0,0,0,.45)", ...style }}>
      <CardArt name={name} colors={["C"]} version="normal" radius={5} style={{ width: "100%", height: "100%" }} loading="lazy" />
    </div>
  );
}

const chip = (bg: string, color: string): CSSProperties => ({
  fontSize: 11.5,
  fontWeight: 700,
  padding: "4px 9px",
  borderRadius: 999,
  background: bg,
  color,
  whiteSpace: "nowrap",
});

export type VisualKind = LandingFeature["icon"] | "prompt" | "swipe" | "curve";

const VISUALS: Record<VisualKind, () => ReactNode> = {
  // How it works, step 1: the ask.
  prompt: () => (
    <div style={{ width: "100%", maxWidth: 250, padding: "10px 12px", borderRadius: 12, background: "var(--bg2)", boxShadow: "inset 0 0 0 1px var(--line)", fontSize: 12.5, color: "var(--t1)", lineHeight: 1.45 }}>
      Goblins that win out of nowhere, Krenko at the helm, on a budget
      <span style={{ display: "inline-block", width: 2, height: 13, background: "var(--gold)", marginLeft: 2, verticalAlign: "-2px" }} />
    </div>
  ),
  // Step 2: keep or toss.
  swipe: () => (
    <>
      <span style={{ ...chip("rgba(194,64,42,.12)", "var(--danger)"), fontSize: 16 }}>✕</span>
      <Mini name="Goblin Chieftain" w={62} style={{ transform: "rotate(-4deg)" }} />
      <span style={{ ...chip("rgba(13,138,95,.14)", "#0d8a5f"), fontSize: 16 }}>✓</span>
    </>
  ),
  // Step 3: the curve fills and the count lands on 100.
  curve: () => (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 70 }}>
        {[4, 11, 14, 15, 7, 6, 2].map((h, i) => (
          <div key={i} style={{ width: 14, height: `${(h / 15) * 100}%`, borderRadius: 3, background: "var(--gold)" }} />
        ))}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: "var(--t1)", lineHeight: 1 }}>
        100<span style={{ fontSize: 14, color: "var(--t3)" }}>/100</span>
      </div>
    </div>
  ),
  sparkles: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", maxWidth: 240 }}>
      <div style={{ alignSelf: "flex-end", ...chip("var(--bg3)", "var(--t1)"), fontWeight: 600 }}>Which deck is strongest?</div>
      <div style={{ alignSelf: "flex-start", fontSize: 12, lineHeight: 1.45, color: "var(--t2)", padding: "7px 10px", borderRadius: 10, background: "var(--bg2)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
        <b style={{ color: "var(--gold)", textDecoration: "underline" }}>Krenko</b> — 7.5, plays like bracket 3. Add{" "}
        <b style={{ color: "var(--gold)", textDecoration: "underline dotted" }}>Skullclamp</b>.
      </div>
    </div>
  ),
  gauge: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 34, fontWeight: 800, color: "var(--t1)", lineHeight: 1 }}>7.5</div>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", color: "var(--t3)", marginTop: 4 }}>BRACKET 3</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 110 }}>
        {[["S", 9], ["C", 8], ["I", 6], ["R", 7]].map(([k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--t3)", width: 10 }}>{k}</span>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--bg3)" }}>
              <div style={{ width: `${(Number(v) / 10) * 100}%`, height: "100%", borderRadius: 3, background: "var(--gold)" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
  link: () => (
    <>
      <Mini name="Thassa's Oracle" />
      <span style={{ fontSize: 20, fontWeight: 800, color: "var(--t3)" }}>+</span>
      <Mini name="Demonic Consultation" />
      <span style={{ ...chip("var(--gold)", "var(--accent-ink)"), position: "absolute", bottom: 10, right: 10 }}>Win the game</span>
    </>
  ),
  library: () => (
    <div style={{ position: "relative", width: 150, height: 90 }}>
      {["Sol Ring", "Sheoldred, the Apocalypse", "Rhystic Study"].map((n, i) => (
        <Mini key={n} name={n} w={60} style={{ position: "absolute", left: i * 42, top: i * 3, transform: `rotate(${(i - 1) * 6}deg)` }} />
      ))}
      <span style={{ ...chip("#0d8a5f", "#fff"), position: "absolute", right: -8, top: -6 }}>×4 owned</span>
    </div>
  ),
  dices: () => (
    <div style={{ position: "relative", width: 200, height: 96 }}>
      {["Mountain", "Goblin Matron", "Sol Ring", "Krenko, Mob Boss", "Mountain"].map((n, i) => (
        <Mini key={i} name={n} w={48} style={{ position: "absolute", left: 16 + i * 30, top: Math.abs(i - 2) * 6, transform: `rotate(${(i - 2) * 8}deg)`, transformOrigin: "bottom center" }} />
      ))}
    </div>
  ),
  history: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, alignItems: "flex-start" }}>
      <span style={chip("rgba(13,138,95,.14)", "#0d8a5f")}>+ Arcane Signet</span>
      <span style={chip("rgba(194,64,42,.12)", "var(--danger)")}>− Mind Stone</span>
      <span style={{ ...chip("var(--gold)", "var(--accent-ink)") }}>↺ Restore this version</span>
    </div>
  ),
  cart: () => (
    <div style={{ width: "100%", maxWidth: 220, fontSize: 12.5, color: "var(--t2)", display: "flex", flexDirection: "column", gap: 5 }}>
      {[["Sol Ring", "$1.42", true], ["Rhystic Study", "$38.10", false], ["Smothering Tithe", "$16.90", false]].map(([n, p, own]) => (
        <div key={String(n)} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ color: "var(--t1)", fontWeight: 600 }}>{n}</span>
          <span>{own ? <b style={{ color: "#0d8a5f" }}>owned</b> : p}</span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 5, fontWeight: 800, color: "var(--t1)" }}>
        <span>To buy</span>
        <span>$55.00</span>
      </div>
    </div>
  ),
  phone: () => (
    <div style={{ width: 70, height: 118, borderRadius: 14, border: "3px solid var(--t1)", padding: 5, display: "flex", flexDirection: "column", gap: 4, background: "var(--bg2)" }}>
      <div style={{ height: 40, borderRadius: 6, background: "linear-gradient(165deg, #d2452f, #9a2a18)" }} />
      <div style={{ height: 40, borderRadius: 6, background: "linear-gradient(165deg, #2f7a4c, #195030)" }} />
      <div style={{ height: 6, width: "60%", borderRadius: 3, background: "var(--bg3)" }} />
    </div>
  ),
};

export default function LandingVisual({ icon }: { icon: VisualKind }) {
  return (
    <div style={frame} aria-hidden="true">
      {VISUALS[icon]()}
    </div>
  );
}
