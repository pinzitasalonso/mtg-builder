"use client";

// The Stats pane's readings, in the pieces the pane arranges them in.
//
// This file used to export ONE <DeckInsight> block that rendered the bracket,
// the combos, the game history and the 8x8 back to back. The pane needs them
// apart. iOS reads top to bottom as "what the deck IS, how it PLAYS, what it's
// MADE of" — so the profile leads, the combos and the record belong beside the
// primer under "how it plays", and the 8x8 goes last because it is the densest
// thing on the pane. One block could not be interleaved with the primer, the
// and the shape strip that sit between those readings, so the fetching is
// a hook and each reading is its own component.
//
// Bracket and 8x8 are computed here from cards the page already holds, exactly
// as iOS computes them locally — see lib/deck-insight. The combos, the game
// record and the Score come from the server.
//
// A number on a stats panel reads as a verdict, so only put one here that is
// actually measured. The Score's predecessor did not clear that bar — two of
// its four axes were constants — and was removed. The Score measures all four
// (lib/deck-score-report) and arrives with its working, which the profile
// shows under the number so anyone can check it.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DeckScoreReport } from "@/lib/deck-score-report";
import {
  BRACKET_LABEL,
  BRACKET_NUMBER,
  countGameChangers,
  cubeBuckets,
  suggestedBracket,
  type InsightCard,
} from "@/lib/deck-insight";
import type { ComboResult } from "@/lib/combos";

interface GameRow {
  id: number;
  won: boolean;
  opponents: string[];
  note: string | null;
  isManual: boolean;
  playedAt: string;
}

interface History {
  pro: boolean;
  owns: boolean;
  games: GameRow[];
}

export interface DeckInsightData {
  bracket: ReturnType<typeof suggestedBracket>;
  /** null while the Game Changer list is still loading. */
  changers: number | null;
  combos: ComboResult | null;
  history: History | null;
  /** null until scored, or when the server could not score it. */
  score: DeckScoreReport | null;
  buckets: ReturnType<typeof cubeBuckets>;
  /** Whether "how it plays" has anything beyond the primer. */
  hasPlayReadings: boolean;
}

/**
 * Every reading the Stats pane needs, fetched once.
 *
 * Called from the pane rather than the page, so a deck opened on its decklist
 * never fires these four requests at all.
 */
export function useDeckInsight(deckId: string, cards: InsightCard[]): DeckInsightData {
  const [gameChangers, setGameChangers] = useState<Set<string> | null>(null);
  const [combos, setCombos] = useState<ComboResult | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [score, setScore] = useState<DeckScoreReport | null>(null);

  // The server readings are scored from the server's own copy of the deck, so
  // they follow a sync rather than a keystroke. The decklist's size is the
  // cheapest signal that one has happened.
  const deckCount = cards.filter((c) => c.board === "deck").length;
  // The Score is keyed on the decklist's CONTENT: a swap keeps the size and
  // must still re-score, which is the most common edit there is.
  const deckKey = useMemo(
    () =>
      cards
        .filter((c) => c.board === "deck")
        .map((c) => `${c.name}x${c.quantity}`)
        .sort()
        .join("|"),
    [cards]
  );

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
    fetch(`/api/decks/${deckId}/combos`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => live && setCombos(b))
      .catch(() => live && setCombos(null));
    return () => {
      live = false;
    };
  }, [deckId, deckCount]);

  useEffect(() => {
    let live = true;
    // Answers with an empty list for a free or non-owning viewer rather than a
    // 403, so there is nothing to distinguish here — no games is no section.
    fetch(`/api/decks/${deckId}/games`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => live && setHistory(b))
      .catch(() => live && setHistory(null));
    return () => {
      live = false;
    };
  }, [deckId, deckCount]);

  useEffect(() => {
    let live = true;
    if (!deckKey) {
      setScore(null);
      return;
    }
    // Best-effort: a deck the server cannot score simply shows no Score row.
    fetch(`/api/decks/${deckId}/score`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => live && setScore(b && typeof b.index === "number" ? b : null))
      .catch(() => live && setScore(null));
    return () => {
      live = false;
    };
  }, [deckId, deckKey]);

  const buckets = useMemo(() => cubeBuckets(cards), [cards]);
  const changers = useMemo(
    () => (gameChangers ? countGameChangers(cards, gameChangers) : null),
    [cards, gameChangers]
  );
  // The two-card combo feeds the bracket as well as the list. A deck with one
  // cannot be bracket 1 or 2 however few Game Changers it runs, which is why
  // iOS passes the same flag in.
  const bracket = suggestedBracket(changers ?? 0, combos?.hasTwoCardCombo ?? false);
  return {
    bracket,
    changers,
    combos,
    history,
    score,
    buckets,
    hasPlayReadings: Boolean(combos?.combos.length) || Boolean(history?.games.length),
  };
}

/**
 * A labelled block: a kerned eyebrow with a gold hairline running off it, the
 * same chrome the iOS Stats pane gives every section.
 */
export function StatSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 34 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span className="id-label" style={{ color: "var(--w-2)", whiteSpace: "nowrap" }}>{title}</span>
        {/* Gold fading to nothing. Plain `var(--gold)` at half opacity rather
            than a color-mix() — lightningcss mangles those, and there is no
            reason to find out whether an inline style escapes it. */}
        <span
          aria-hidden
          style={{ flex: 1, height: 1, opacity: 0.5, background: "linear-gradient(to right, var(--gold), transparent)" }}
        />
      </div>
      {children}
    </section>
  );
}

/** Label left, figure right, the reasoning under the figure. iOS `profileRow`. */
function ProfileRow({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "9px 0", borderTop: "1px solid var(--w-line)" }}>
      <span style={{ fontSize: 13.5, color: "var(--w-2)" }}>{label}</span>
      <span style={{ flex: 1 }} />
      <span style={{ textAlign: "right" }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--w-1)" }}>{value}</span>
        {detail && <span style={{ display: "block", fontSize: 11.5, color: "var(--w-3)", marginTop: 2 }}>{detail}</span>}
      </span>
    </div>
  );
}

/**
 * The verdict: bracket, average cost, Score. One glance, the numbers that
 * judge the deck — and, under the Score, the working.
 */
export function InsightProfile({
  insight,
  avgManaValue,
}: {
  insight: DeckInsightData;
  avgManaValue: number;
}) {
  const { bracket, changers, combos, score } = insight;
  // Nil at zero, deliberately — iOS `gameChangerDetail`. `changers` is also
  // null before the list has loaded, and "from 0 game changers" would be
  // claiming a measurement we have not taken.
  const bracketDetail =
    changers === null
      ? "counting…"
      : [
          changers > 0 ? `${changers} game changer${changers === 1 ? "" : "s"}` : null,
          combos?.hasTwoCardCombo ? "two-card combo" : null,
        ]
          .filter(Boolean)
          .join(" · ") || null;

  // The Score's floors only ever bump a deck UP, and only as a note: the
  // bracket is Wizards' rule set, and this is a reading of the same list.
  const floorNote =
    score && score.bracketFloor > BRACKET_NUMBER[bracket]
      ? `plays like at least Bracket ${score.bracketFloor} by its Score`
      : null;

  return (
    <div style={{ maxWidth: 560 }}>
      <ProfileRow
        label="Bracket"
        value={`${BRACKET_NUMBER[bracket]} · ${BRACKET_LABEL[bracket]}`}
        detail={[bracketDetail, floorNote].filter(Boolean).join(" · ") || null}
      />
      {Number.isFinite(avgManaValue) && <ProfileRow label="Average cost" value={avgManaValue.toFixed(2)} />}
      {score && <InsightScore score={score} />}
    </div>
  );
}

/** Trailing zeros off the quarter grid: 6.25 stays, 6.00 becomes 6. */
const trim = (n: number): string => String(Number(n.toFixed(2)));

/**
 * The Score row, the four axes under it, and the working behind a toggle.
 *
 * The axes are always shown because the index alone hides the shape: 9/3/3/9
 * and 6/7/7/6 average to nearly the same number and play nothing alike. The
 * working stays folded — it runs to a few dozen lines on a real deck.
 */
function InsightScore({ score }: { score: DeckScoreReport }) {
  const [open, setOpen] = useState(false);
  const [openAxis, setOpenAxis] = useState<string | null>(null);
  return (
    <div>
      <ProfileRow label="Score" value={score.label} detail={`${score.axes.map((a) => `${a.label[0]} ${trim(a.score)}`).join(" · ")}`} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, padding: "2px 0 10px" }}>
        {score.axes.map((a) => (
          <div key={a.key} style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, color: "var(--w-1)" }}>{trim(a.score)}</div>
            <div className="id-label" style={{ fontSize: 10, color: "var(--w-3)", marginTop: 2 }}>{a.label}</div>
            <div style={{ fontSize: 11, color: "var(--w-2)", marginTop: 1 }}>{a.descriptor}</div>
          </div>
        ))}
      </div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", fontSize: 12, color: "var(--gold)" }}
      >
        {open ? "Hide the working" : "Show the working"}
      </button>
      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12 }}>
          {score.axes.map((a) => {
            const showCards = openAxis === a.key;
            return (
              <div key={a.key} style={{ borderTop: "1px solid var(--w-line)", paddingTop: 10 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--w-1)" }}>{a.label} {trim(a.score)}</span>
                  <span style={{ fontSize: 12, color: "var(--w-3)" }}>{a.summary}</span>
                </div>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--w-2)", lineHeight: 1.5 }}>
                  {a.facts.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
                {a.cards.length > 0 && (
                  <button
                    onClick={() => setOpenAxis(showCards ? null : a.key)}
                    aria-expanded={showCards}
                    style={{ background: "none", border: "none", padding: 0, marginTop: 6, cursor: "pointer", font: "inherit", fontSize: 11.5, color: "var(--w-3)" }}
                  >
                    {showCards ? "hide the cards it counted" : `the ${a.cards.reduce((n, g) => n + g.names.length, 0)} cards it counted`}
                  </button>
                )}
                {showCards &&
                  a.cards.map((g) => (
                    <div key={g.label} style={{ marginTop: 6 }}>
                      <span className="id-label" style={{ fontSize: 10, color: "var(--w-3)" }}>{g.label}</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 12px", marginTop: 3 }}>
                        {g.names.map((n) => (
                          <span key={n} style={{ fontSize: 12, color: "var(--w-2)" }}>{n}</span>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            );
          })}
          <p style={{ fontSize: 11.5, color: "var(--w-3)", lineHeight: 1.5, margin: 0 }}>
            {score.caveats.join(" ")}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The combos and the game record — the two readings that belong with the
 * primer rather than with the figures.
 *
 * Combos stay collapsed by default, the way the iOS deck page carries them:
 * reference material you consult when a game goes long, not something to read
 * on the way past.
 */
export function InsightPlay({ insight }: { insight: DeckInsightData }) {
  const [showCombos, setShowCombos] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const { combos, history } = insight;
  const comboCount = combos?.combos.length ?? 0;
  const games = history?.games ?? [];
  if (comboCount === 0 && games.length === 0) return null;

  const won = games.filter((g) => g.won).length;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {comboCount > 0 && (
          <Pill on={showCombos} onClick={() => setShowCombos((v) => !v)}>
            🔗 {comboCount} combo{comboCount === 1 ? "" : "s"}
          </Pill>
        )}
        {games.length > 0 && (
          <Pill on={showHistory} onClick={() => setShowHistory((v) => !v)}>
            ▤ Record {won}/{games.length}
          </Pill>
        )}
      </div>

      {showCombos && comboCount > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16, maxWidth: 720 }}>
          {combos!.combos.map((c) => (
            <div key={c.id}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--w-1)" }}>{c.pieces.join("  +  ")}</div>
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

      {showHistory && games.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 16, maxWidth: 720 }}>
          {games.slice(0, 12).map((g) => (
            <div
              key={g.id}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                padding: "7px 0",
                borderTop: "1px solid var(--w-line)",
                fontSize: 13,
              }}
            >
              <span style={{ color: g.won ? "var(--gold)" : "var(--w-3)", fontWeight: 600, minWidth: 34 }}>
                {g.won ? "Won" : "Lost"}
              </span>
              <span style={{ color: "var(--w-2)", flex: 1, minWidth: 0 }}>
                {g.opponents.length ? g.opponents.join(" · ") : "—"}
              </span>
              {g.isManual && <span style={{ fontSize: 11, color: "var(--w-3)" }}>typed in</span>}
              <span style={{ fontSize: 11.5, color: "var(--w-3)", fontFamily: "var(--font-mono)" }}>
                {new Date(g.playedAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-expanded={on}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 14px",
        background: on ? "var(--w-fill)" : "none",
        border: "1px solid var(--w-line)",
        borderRadius: 999,
        cursor: "pointer",
        color: "var(--w-1)",
        font: "inherit",
        fontSize: 13,
      }}
    >
      {children}
      <span style={{ color: "var(--w-3)", fontSize: 11.5 }}>{on ? "hide" : "show"}</span>
    </button>
  );
}

/** Eight categories of eight plus thirty-five lands, each row openable. */
export function InsightEightByEight({ insight }: { insight: DeckInsightData }) {
  const [openBucket, setOpenBucket] = useState<string | null>(null);
  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--w-3)", lineHeight: 1.5, margin: "0 0 14px", maxWidth: 620 }}>
        Eight categories of eight, plus thirty-five lands. A starting shape rather than a rule — one
        category at six and another at nine is fine.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {insight.buckets.map((b) => {
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
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--w-1)", fontSize: 13.5 }}>{b.count}</span>
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
