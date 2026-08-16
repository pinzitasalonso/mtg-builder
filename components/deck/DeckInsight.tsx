"use client";

// The three readings the iOS Stats tab shows that the web had no answer for:
// the bracket, the CRISPI performance index, and 8x8 counting.
//
// Bracket and 8x8 are computed here from cards the page already holds, exactly
// as iOS computes them locally — see lib/deck-insight. CRISPI is scored on the
// server because the rubric needs oracle text for every card, and it arrives
// with a `provisional` flag and a list of what was estimated or stubbed.
//
// THE PROVISIONAL NOTE IS NOT OPTIONAL. A number on a stats panel reads as a
// verdict unless it is told not to, and this one is derived from oracle-text
// pattern matching with three of its inputs not computed at all.

import { useEffect, useMemo, useState } from "react";
import {
  BRACKET_LABEL,
  BRACKET_NUMBER,
  countGameChangers,
  cubeBuckets,
  suggestedBracket,
  type InsightCard,
} from "@/lib/deck-insight";
import type { ComboResult } from "@/lib/combos";

interface Crispi {
  consistency: number;
  resilience: number;
  interaction: number;
  speed: number;
  index: number;
  provisional?: boolean;
  notes?: { estimated?: string[]; stubbed?: string[] };
}

/** Trailing zeros off a quarter-point scale: 6.25 stays, 6.00 becomes 6. */
const trim = (n: number): string => String(Number(n.toFixed(2)));

export default function DeckInsight({
  deckId,
  cards,
  avgManaValue,
}: {
  deckId: string;
  cards: InsightCard[];
  avgManaValue: number;
}) {
  const [gameChangers, setGameChangers] = useState<Set<string> | null>(null);
  const [crispi, setCrispi] = useState<Crispi | null>(null);
  const [combos, setCombos] = useState<ComboResult | null>(null);
  const [openBucket, setOpenBucket] = useState<string | null>(null);
  const [showCombos, setShowCombos] = useState(false);

  // Both server readings are scored from the server's own copy of the deck, so
  // they follow a sync rather than a keystroke. The decklist's size is the
  // cheapest signal that one has happened.
  const deckCount = cards.filter((c) => c.board === "deck").length;

  useEffect(() => {
    let live = true;
    fetch("/api/gamechangers")
      .then((r) => (r.ok ? r.json() : { names: [] }))
      .then((b) => live && setGameChangers(new Set(b.names ?? [])))
      .catch(() => live && setGameChangers(new Set()));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    // Best-effort, like iOS: a deck with no cards scored yet, or a request that
    // fails, simply shows no CRISPI row rather than an error about a score.
    fetch(`/api/decks/${deckId}/crispi`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => live && setCrispi(b))
      .catch(() => live && setCrispi(null));
    return () => {
      live = false;
    };
    // Re-scored when the decklist's size changes — the server reads its own
    // copy, so this follows a sync rather than a keystroke.
  }, [deckId, deckCount]);

  useEffect(() => {
    let live = true;
    fetch(`/api/decks/${deckId}/combos`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => live && setCombos(b))
      .catch(() => live && setCombos(null));
    return () => {
      live = false;
    };
  }, [deckId, deckCount]);

  const buckets = useMemo(() => cubeBuckets(cards), [cards]);
  const changers = useMemo(
    () => (gameChangers ? countGameChangers(cards, gameChangers) : 0),
    [cards, gameChangers]
  );
  // The two-card combo feeds the bracket as well as the list. A deck with one
  // cannot be bracket 1 or 2 however few Game Changers it runs, which is why
  // iOS passes the same flag in.
  const bracket = suggestedBracket(changers, combos?.hasTwoCardCombo ?? false);

  const label = { color: "var(--w-3)" } as const;
  const figure = { fontFamily: "var(--font-mono)", color: "var(--w-1)" } as const;

  return (
    <div style={{ padding: "24px 0", borderBottom: "1px solid var(--w-line)" }}>
      <div className="id-label" style={{ ...label, marginBottom: 16 }}>Deck insight</div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "22px 36px", marginBottom: 22 }}>
        <Stat label="Bracket" value={`${BRACKET_NUMBER[bracket]} · ${BRACKET_LABEL[bracket]}`}
              note={gameChangers === null
                ? "counting…"
                : `${changers} game changer${changers === 1 ? "" : "s"}${combos?.hasTwoCardCombo ? " · two-card combo" : ""}`} />
        <Stat label="Avg. mana value" value={avgManaValue.toFixed(1)} />
        {crispi && (
          <Stat
            label="CRISPI"
            value={trim(crispi.index)}
            note={`C ${trim(crispi.consistency)} · R ${trim(crispi.resilience)} · I ${trim(crispi.interaction)} · S ${trim(crispi.speed)}`}
          />
        )}
      </div>

      {crispi?.provisional && (
        // The server says the score is provisional and why. Rendering the
        // number without this would present a pattern-matched estimate as a
        // measurement.
        <div style={{ fontSize: 12, color: "var(--w-3)", lineHeight: 1.5, marginBottom: 22, maxWidth: 620 }}>
          CRISPI is provisional — it reads card roles from oracle text, and some of the rubric&apos;s
          inputs aren&apos;t computed yet
          {crispi.notes?.stubbed?.length ? ` (${crispi.notes.stubbed.length} stubbed)` : ""}. Treat it as
          a rough shape, not a rating.
        </div>
      )}

      {combos && combos.combos.length > 0 && (
        // A line rather than the list, the way the iOS deck page carries it:
        // combos are reference material you consult when a game goes long, not
        // something to read on the way past.
        <div style={{ marginBottom: 22 }}>
          <button
            onClick={() => setShowCombos((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 14px",
              background: "none",
              border: "1px solid var(--w-line)",
              borderRadius: 999,
              cursor: "pointer",
              color: "var(--w-1)",
              font: "inherit",
              fontSize: 13,
            }}
          >
            🔗 {combos.combos.length} combo{combos.combos.length === 1 ? "" : "s"}
            <span style={{ color: "var(--w-3)", fontSize: 11.5 }}>{showCombos ? "hide" : "show"}</span>
          </button>
          {showCombos && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 14, maxWidth: 720 }}>
              {combos.combos.map((c) => (
                <div key={c.id}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--w-1)" }}>
                    {c.pieces.join("  +  ")}
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 3 }}>
                    {c.produces.length > 0 && (
                      <span style={{ fontSize: 12, color: "var(--gold)" }}>{c.produces.join(" · ")}</span>
                    )}
                    {c.manaNeeded && (
                      <span style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "var(--w-3)" }}>
                        {c.manaNeeded}
                      </span>
                    )}
                  </div>
                  {c.steps && (
                    <div style={{ fontSize: 12.5, color: "var(--w-2)", lineHeight: 1.5, marginTop: 5, whiteSpace: "pre-line" }}>
                      {c.steps}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="id-label" style={{ ...label, marginBottom: 4 }}>8×8 counting</div>
      <div style={{ fontSize: 12, color: "var(--w-3)", lineHeight: 1.5, marginBottom: 14, maxWidth: 620 }}>
        Eight categories of eight, plus thirty-five lands. A starting shape rather than a rule — one
        category at six and another at nine is fine.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {buckets.map((b) => {
          const open = openBucket === b.id;
          return (
            <div key={b.id}>
              <button
                onClick={() => setOpenBucket(open ? null : b.id)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "baseline",
                  gap: 10,
                  padding: "9px 0",
                  background: "none",
                  border: "none",
                  borderTop: "1px solid var(--w-line)",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "inherit",
                  font: "inherit",
                }}
              >
                <span style={{ fontSize: 13.5, color: "var(--w-1)", minWidth: 130 }}>{b.label}</span>
                <span style={{ ...figure, fontSize: 13.5 }}>{b.count}</span>
                <span style={{ fontSize: 12, color: "var(--w-3)" }}>
                  of {b.target}
                  {b.hint ? ` · ${b.hint}` : ""}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--w-3)" }}>
                  {b.entries.length ? (open ? "hide" : `${b.entries.length} cards`) : "—"}
                </span>
              </button>
              {open && b.entries.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", padding: "2px 0 12px" }}>
                  {b.entries.map((e) => (
                    <span key={e.name} style={{ fontSize: 12.5, color: "var(--w-2)" }}>
                      {e.quantity > 1 ? `${e.quantity}× ` : ""}
                      {e.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ minWidth: 130 }}>
      <div className="id-label" style={{ color: "var(--w-3)", marginBottom: 6 }}>{label}</div>
      <div className="id-display" style={{ fontSize: 22, color: "var(--w-1)", lineHeight: 1.05 }}>{value}</div>
      {note && <div style={{ fontSize: 11.5, color: "var(--w-3)", marginTop: 4 }}>{note}</div>}
    </div>
  );
}
