"use client";

// The deck page's Stats pane — everything ABOUT the deck rather than in it.
//
// Top to bottom:
//   THE SCORE — the pane's lead: the number, the bracket it plays at, the four
//     axes with their working a click away, and the scan's verdict in words.
//   Then two columns on a wide page:
//     the main one — COMBOS (each with its cards), the GAME PLAN (the primer,
//       or the scan's read of how to pilot it: one at a time, never both
//       stacked), and the RECORD of games;
//     the side one — the BUILD: the figures you glance at, the curve, the
//       composition, the colours and the roles.
//   On a phone it is one column: Score, combos, build, game plan, record. The
//   long things to read come after the short things to glance at.
//
// Every card name on the pane can be pointed at to see the card
// (components/deck/CardHover.tsx).

import { useEffect, useMemo, useRef, useState } from "react";
import {
  InsightCombos,
  InsightEightByEight,
  InsightGamePlan,
  InsightRecord,
  InsightScan,
  InsightScoreHero,
  InsightTiles,
  StatSection,
  useDeckInsight,
} from "@/components/deck/DeckInsight";
import { CardHoverProvider } from "@/components/deck/CardHover";
import DeckPrimer from "@/components/deck/DeckPrimer";
import {
  ColorPips,
  ManaCurve,
  deckStats,
  categoryOf,
  colorsOf,
  landProducedColors,
  COLOR_NAME,
  MANA,
} from "@/components/mtg";
import type { PoolEntry } from "@/lib/pool-client";
import type { InsightCard } from "@/lib/deck-insight";
import type { ScanSummary } from "@/lib/deck-analysis";

// Category accent colours for the composition matrix (matches the design).
const CAT_COLOR: Record<string, string> = {
  Creatures: "#fdf26f",
  Instants: "#7fb8ff",
  Sorceries: "#b5d6ff",
  Artifacts: "#d7dbe2",
  Enchantments: "#e3b3ff",
  Planeswalkers: "#ffcf8a",
  Lands: "#d9bd8a",
  Other: "#cfd3da",
};

export default function DeckStatsPane({
  deckId,
  deckCards,
  insightCards,
  identity,
  avgManaValue,
  canEdit,
  primer,
  primerOpen,
  onPrimerSaved,
  scanOpen,
  onHoverCurveBar,
  onClickCurveBar,
  target,
  commanderFormat,
  onScanned,
}: {
  /** The pane's scan, as its summary, whenever it loads or a new one is run: the page's top line shows it. */
  onScanned?: (scan: ScanSummary | null) => void;
  /** Whether the deck's format is Commander (brackets are Commander's). */
  commanderFormat: boolean;
  /** The deck's size target: 100 for Commander, 60 otherwise. */
  target: number;
  deckId: string;
  deckCards: PoolEntry[];
  /** Every card on the page, both boards — 8x8 and the bracket filter it themselves. */
  insightCards: InsightCard[];
  identity: string[];
  avgManaValue: number;
  canEdit: boolean;
  primer: string;
  primerOpen: boolean;
  onPrimerSaved: (text: string) => void;
  /** Opened from the Tools menu: the scan box shows straight away. */
  scanOpen: boolean;
  onHoverCurveBar: (i: number | null) => void;
  onClickCurveBar?: (i: number) => void;
}) {
  const insight = useDeckInsight(deckId, insightCards);
  const stats = deckStats(deckCards);

  // The game plan is one thing to read: the owner's primer, or the scan's
  // read of how to pilot the deck. With both, a switch picks one; the primer
  // leads, because its owner wrote it (or kept it).
  const plan = insight.scan?.analysis ?? null;
  const hasPrimer = primer.trim().length > 0;
  const [planView, setPlanView] = useState<"primer" | "scan" | null>(null);
  const view = !plan ? "primer" : (planView ?? (hasPrimer ? "primer" : "scan"));

  // The page's top line carries the Score too, and follows a new scan.
  const scanned = insight.scan;
  const tell = useRef(onScanned);
  tell.current = onScanned;
  const scannedAt = scanned?.scannedAt ?? null;
  useEffect(() => {
    if (!scanned) return;
    const { index, label, bracketFloor } = scanned.score;
    tell.current?.({ score: index, label, bracket: Number.isInteger(bracketFloor) && bracketFloor >= 1 && bracketFloor <= 5 ? bracketFloor : null });
    // Keyed on the scan's time: the same scan is told once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedAt]);

  // Tools → Primer brings the primer into view.
  const primerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!primerOpen) return;
    setPlanView("primer");
    requestAnimationFrame(() => primerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [primerOpen]);

  // Every card on the page, for the names the pane lets you point at.
  const hoverCards = useMemo(() => deckCards.map((c) => ({ name: c.name, imageUri: c.imageUri })), [deckCards]);

  if (deckCards.length === 0) {
    return (
      <div style={{ padding: "54px 20px", textAlign: "center", color: "var(--w-3)" }}>
        <div className="id-display" style={{ fontSize: 26, color: "var(--w-2)", marginBottom: 8 }}>
          Nothing to measure yet
        </div>
        <div style={{ fontSize: 13.5 }}>Promote cards to the deck and its stats appear here.</div>
      </div>
    );
  }

  const lands = stats.types.find((t) => t.name === "Lands")?.n ?? 0;

  return (
    <CardHoverProvider cards={hoverCards}>
      <div className="st">
        <InsightScoreHero
          insight={insight}
          canEdit={canEdit}
          commanderFormat={commanderFormat}
          scanSlot={<InsightScan deckId={deckId} insight={insight} canEdit={canEdit} open={scanOpen} primer={primer} />}
        />

        <div className="st-main">
          <div className="st-combos-slot">
            <InsightCombos insight={insight} />
          </div>

          <div className="st-plan-slot" ref={primerRef} style={{ scrollMarginTop: 90 }}>
            <StatSection
              title="Game plan"
              aside={
                plan && (
                  <div className="st-switch" role="tablist" aria-label="Which game plan">
                    <button type="button" role="tab" aria-selected={view === "primer"} onClick={() => setPlanView("primer")}>
                      Primer
                    </button>
                    <button type="button" role="tab" aria-selected={view === "scan"} onClick={() => setPlanView("scan")}>
                      From the scan
                    </button>
                  </div>
                )
              }
            >
              {view === "scan" && plan ? (
                <InsightGamePlan analysis={plan} />
              ) : (
                <DeckPrimer deckId={deckId} primer={primer} canEdit={canEdit} onSaved={onPrimerSaved} />
              )}
            </StatSection>
          </div>

          <div className="st-record-slot">
            <InsightRecord insight={insight} />
          </div>
        </div>

        <aside className="st-side" aria-label="The build">
          <StatSection title="At a glance">
            <InsightTiles insight={insight} avgManaValue={avgManaValue} cardCount={stats.count} target={target} lands={lands} />
          </StatSection>

          <StatSection title="Mana curve">
            <ManaCurve curve={stats.curve} accent="var(--gold)" onHoverBar={onHoverCurveBar} onClickBar={onClickCurveBar} />
          </StatSection>

          <StatSection title={`Composition · ${stats.count} cards`}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
              {stats.types.flatMap((t) =>
                Array.from({ length: t.n }).map((_, i) => (
                  <span key={t.name + i} style={{ width: 9, height: 9, borderRadius: 2.5, background: CAT_COLOR[t.name] || "#ccc" }} />
                ))
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 14px" }}>
              {stats.types.map((t) => (
                <span key={t.name} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--w-2)" }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2.5, background: CAT_COLOR[t.name] || "#ccc" }} />
                  {t.name} <b style={{ color: "var(--w-1)", fontFamily: "var(--font-mono)" }}>{t.n}</b>
                </span>
              ))}
            </div>
          </StatSection>

          <StatSection title="Colors & mana">
            <ColorIdentity deckCards={deckCards} identity={identity} />
          </StatSection>

          <StatSection title="Roles · 8×8">
            <InsightEightByEight insight={insight} />
          </StatSection>
        </aside>
      </div>
    </CardHoverProvider>
  );
}

/**
 * Colour requirements (spell pips) against the lands that can produce each
 * colour, read from what each land actually adds. Cards are not either/or: a
 * spell//land MDFC counts on both sides.
 */
function ColorIdentity({ deckCards, identity }: { deckCards: PoolEntry[]; identity: string[] }) {
  const spell: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const land: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const colored = identity.filter((c) => "WUBRG".includes(c));
  for (const c of deckCards) {
    const qty = c.quantity > 0 ? c.quantity : 1;
    if (categoryOf(c.typeLine) === "Lands") {
      for (const col of landProducedColors(c.typeLine, c.oracleText, c.colorIdentity, colored))
        if (land[col] != null) land[col] += qty;
    }
    for (const col of colorsOf(c.manaCost)) if (spell[col] != null) spell[col] += qty;
  }
  const order = (["W", "U", "B", "R", "G"] as const).filter((c) => spell[c] > 0 || land[c] > 0);
  const max = Math.max(1, ...order.flatMap((c) => [spell[c], land[c]]));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
        {identity.length > 0 && <ColorPips colors={identity} size={20} />}
        <span className="id-display" style={{ fontSize: 16, color: "var(--w-1)", lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: 1 }}>
          {identity.length ? identity.map((c) => COLOR_NAME[c]).join(" · ") : "Colorless"}
        </span>
      </div>
      {order.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 14, marginBottom: 7, fontSize: 10.5, color: "var(--w-2)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 9, height: 6, borderRadius: 2, background: "var(--w-1)" }} /> spells
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 2, height: 10, background: "var(--w-1)", boxShadow: "0 0 0 1px rgba(0,0,0,.3)" }} /> land sources
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {order.map((c) => {
              const fill = MANA[c]?.bg ?? "#9aa0a8";
              const landPos = Math.min(100, (land[c] / max) * 100);
              return (
                <div key={c} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ColorPips colors={[c]} size={14} />
                  <div style={{ flex: 1, position: "relative", height: 7, borderRadius: 4, background: "var(--w-fill)", overflow: "hidden" }}>
                    {/* spell requirement fill */}
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(spell[c] / max) * 100}%`, background: fill, borderRadius: 4, transition: "width .4s cubic-bezier(.2,.8,.2,1)" }} />
                    {/* land-sources marker line */}
                    <div
                      title={`${land[c]} land source${land[c] === 1 ? "" : "s"}`}
                      style={{ position: "absolute", top: 0, bottom: 0, left: `calc(${landPos}% - 1px)`, width: 2, background: "var(--w-1)", boxShadow: "0 0 0 1px rgba(0,0,0,.3)", transition: "left .4s cubic-bezier(.2,.8,.2,1)" }}
                    />
                  </div>
                  <span className="id-mono" style={{ fontSize: 11, width: 52, textAlign: "right", whiteSpace: "nowrap", flexShrink: 0 }}>
                    <span style={{ color: "var(--w-1)" }}>{spell[c]}</span>
                    <span style={{ color: "var(--w-3)" }}> / {land[c]}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* The average cost moved to the At a glance tiles. */}
      <p style={{ fontSize: 12, color: "var(--w-3)", margin: 0, lineHeight: 1.45 }}>
        Land sources are what each land can produce; fetches and any-colour lands count toward your identity.
      </p>
    </>
  );
}
