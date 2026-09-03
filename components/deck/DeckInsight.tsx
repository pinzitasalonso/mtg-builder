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
// record and the last scan come from the server.
//
// A number on a stats panel reads as a verdict, so only put one here that is
// actually measured. The Score's predecessor did not clear that bar — two of
// its four axes were constants — and was removed. The Score measures all four
// (lib/deck-score-report) and arrives with its working, which the profile
// shows under the number so anyone can check it. It is run ON DEMAND — a scan
// is metered — so the pane reads whatever the last scan stored and offers the
// button to run a new one.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DeckScoreReport } from "@/lib/deck-score-report";
import type { AnalysisDocument, DeckScan } from "@/lib/deck-analysis";
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
  /** The last scan, or null when the deck has never been scanned. */
  scan: DeckScan | null;
  /** Replace the stored scan after running a new one. */
  setScan: (scan: DeckScan | null) => void;
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
  const [scan, setScan] = useState<DeckScan | null>(null);

  // The server readings are scored from the server's own copy of the deck, so
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
    // The stored scan only. Nothing is computed until the player asks.
    fetch(`/api/decks/${deckId}/scan`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => live && setScan(b?.scan ?? null))
      .catch(() => live && setScan(null));
    return () => {
      live = false;
    };
  }, [deckId]);

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
    scan,
    setScan,
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
  const { bracket, changers, combos, scan } = insight;
  const score = scan?.score ?? null;
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
      {score && <InsightScore score={score} scannedAt={scan?.scannedAt ?? null} />}
    </div>
  );
}

/** Trailing zeros off the quarter grid: 6.25 stays, 6.00 becomes 6. */
const trim = (n: number): string => String(Number(n.toFixed(2)));

/**
 * The Score row. The four axes and the working sit behind a click on the
 * row itself, DeckCheck-style: the profile is a glance, and a real deck's
 * working runs to a few dozen lines.
 *
 * The axes are the first thing the detail shows because the index alone
 * hides the shape: 9/3/3/9 and 6/7/7/6 average to nearly the same number and
 * play nothing alike.
 */
function InsightScore({ score, scannedAt }: { score: DeckScoreReport; scannedAt: string | null }) {
  const [open, setOpen] = useState(false);
  const [openAxis, setOpenAxis] = useState<string | null>(null);
  const when = scannedAt ? new Date(scannedAt).toLocaleDateString() : null;
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ display: "block", width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: "inherit", textAlign: "left" }}
      >
        <ProfileRow
          label="Score"
          value={`${score.label} ${open ? "▾" : "▸"}`}
          detail={[score.axes.map((a) => `${a.label[0]} ${trim(a.score)}`).join(" · "), when ? `scanned ${when}` : null].filter(Boolean).join(" · ")}
        />
      </button>
      {open && (
        <div style={{ padding: "4px 0 12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {score.axes.map((a) => {
              const showAxis = openAxis === a.key;
              return (
                <div key={a.key}>
                  <button
                    onClick={() => setOpenAxis(showAxis ? null : a.key)}
                    aria-expanded={showAxis}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "none", border: "none", padding: "4px 0", cursor: "pointer", font: "inherit", color: "inherit", textAlign: "left" }}
                  >
                    <span className="id-label" style={{ fontSize: 10, color: "var(--w-3)", width: 92 }}>{a.label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 13.5, color: "var(--w-1)", width: 38 }}>{trim(a.score)}</span>
                    <span style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--w-fill)", overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: `${Math.max(2, (a.score / 10) * 100)}%`, background: "var(--gold)", borderRadius: 3 }} />
                    </span>
                    <span style={{ fontSize: 11, color: "var(--w-2)", width: 140, textAlign: "right" }}>{a.descriptor}</span>
                  </button>
                  {showAxis && (
                    <div style={{ padding: "4px 0 8px 102px" }}>
                      <div style={{ fontSize: 12, color: "var(--w-3)" }}>{a.summary}</div>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--w-2)", lineHeight: 1.5 }}>
                        {a.facts.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                      {a.cards.map((g) => (
                        <div key={g.label} style={{ marginTop: 8 }}>
                          <span className="id-label" style={{ fontSize: 10, color: "var(--w-3)" }}>{g.label} · {g.names.length}</span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 12px", marginTop: 3 }}>
                            {g.names.map((n) => (
                              <span key={n} style={{ fontSize: 12, color: "var(--w-2)" }}>{n}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 11.5, color: "var(--w-3)", lineHeight: 1.5, margin: "12px 0 0" }}>
            Select an axis to see how it was calculated. {score.caveats.join(" ")}
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

/**
 * The scan action: an optional note to guide the analysis, the button, and
 * the plan's meter. The Score and the analysis it produces land in the
 * profile and under "How it plays" the moment the server answers.
 *
 * Metered on purpose — a scan is two third-party calls, a goldfish and a
 * model pass — so the free plan gets one a day and the button says so.
 */
export function InsightScan({
  deckId,
  insight,
  canEdit,
  open,
  primer,
}: {
  deckId: string;
  insight: DeckInsightData;
  canEdit: boolean;
  /** Opened from the Tools menu: the notes box is shown straight away. */
  open: boolean;
  /** The deck's primer. When there is one it guides the scan, and nothing is asked. */
  primer: string;
}) {
  const hasPrimer = primer.trim().length > 0;
  const [showNotes, setShowNotes] = useState(open && !hasPrimer);
  const [notes, setNotes] = useState(insight.scan?.notes ?? "");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null | undefined>(undefined);

  // From the Tools menu: a deck with a primer runs at once, one without
  // gets the notes box.
  const [pendingOpen, setPendingOpen] = useState(0);
  useEffect(() => {
    if (!open) return;
    if (hasPrimer) setPendingOpen((n) => n + 1);
    else setShowNotes(true);
  }, [open, hasPrimer]);

  // The meter, read once and after every scan. `undefined` is "not loaded",
  // null is "unlimited".
  useEffect(() => {
    let live = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => live && setRemaining(b?.user ? (b.user.scansRemaining ?? null) : 0))
      .catch(() => live && setRemaining(undefined));
    return () => {
      live = false;
    };
  }, [insight.scan?.scannedAt]);

  useEffect(() => {
    if (pendingOpen > 0 && !running) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpen]);

  if (!canEdit) return null;

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/decks/${deckId}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "The scan failed.");
        if (res.status === 429) setRemaining(0);
        return;
      }
      insight.setScan(body.scan ?? null);
      setShowNotes(false);
    } catch {
      setError("The scan failed — check the connection and try again.");
    } finally {
      setRunning(false);
    }
  }

  const meter =
    remaining === undefined ? null : remaining === null ? "Unlimited scans on Pro" : `${remaining} free scan${remaining === 1 ? "" : "s"} left today`;
  const exhausted = remaining === 0;

  return (
    <div style={{ marginTop: 12 }}>
      {!showNotes ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Pill on={running} onClick={() => (hasPrimer ? void run() : setShowNotes(true))}>
            🔍 {running ? "Scanning…" : insight.scan ? "Scan again" : "Scan deck"}
          </Pill>
          {hasPrimer && !running && <span style={{ fontSize: 11.5, color: "var(--w-3)" }}>guided by your primer</span>}
          {meter && <span style={{ fontSize: 11.5, color: exhausted ? "var(--gold)" : "var(--w-3)" }}>{meter}</span>}
          {running && <span style={{ fontSize: 11.5, color: "var(--w-3)" }}>about half a minute — you can keep working</span>}
          {error && <span style={{ fontSize: 12, color: "var(--gold)" }}>{error}</span>}
        </div>
      ) : (
        <div className="id-panel" style={{ padding: 14, maxWidth: 560 }}>
          <div style={{ fontSize: 13.5, color: "var(--w-1)", fontWeight: 600, marginBottom: 4 }}>Scan the deck</div>
          <div style={{ fontSize: 12.5, color: "var(--w-2)", lineHeight: 1.5, marginBottom: 10 }}>
            The Score on four measured axes, plus a written analysis: the plan, the mulligans, the key cards, the
            weaknesses. Know this deck? A line or two about how it actually plays makes the read more accurate.
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 1500))}
            placeholder="Optional — the intended strategy, the combos that matter, anything the list doesn't say…"
            rows={3}
            style={{ width: "100%", border: "1px solid var(--w-line)", borderRadius: 8, outline: "none", resize: "vertical", background: "transparent", fontFamily: "var(--font-body)", fontSize: 13.5, lineHeight: 1.5, color: "var(--text)", padding: 8, boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
            <button
              onClick={run}
              disabled={running || exhausted}
              style={{ padding: "9px 16px", borderRadius: 999, border: "none", background: "var(--gold)", color: "#181228", font: "inherit", fontSize: 13, fontWeight: 700, cursor: running || exhausted ? "default" : "pointer", opacity: running || exhausted ? 0.6 : 1 }}
            >
              {running ? "Scanning…" : "Run the scan"}
            </button>
            <button
              onClick={() => setShowNotes(false)}
              disabled={running}
              style={{ background: "none", border: "none", padding: 0, font: "inherit", fontSize: 13, color: "var(--w-2)", cursor: "pointer" }}
            >
              Cancel
            </button>
            {meter && <span style={{ fontSize: 11.5, color: exhausted ? "var(--gold)" : "var(--w-3)" }}>{meter}</span>}
          </div>
          {running && (
            <div style={{ fontSize: 12, color: "var(--w-3)", marginTop: 8 }}>Reading the list, goldfishing a few hundred hands, writing it up — about half a minute.</div>
          )}
          {error && <div style={{ fontSize: 12.5, color: "var(--gold)", marginTop: 8, lineHeight: 1.5 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

/** The scan's written analysis — the document a pilot would hand you. */
export function InsightAnalysis({ analysis }: { analysis: AnalysisDocument }) {
  const [open, setOpen] = useState(true);
  const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <div style={{ marginTop: 14 }}>
      <div className="id-label" style={{ fontSize: 10, color: "var(--w-3)", marginBottom: 5 }}>{title}</div>
      {children}
    </div>
  );
  const List = ({ items, ordered }: { items: string[]; ordered?: boolean }) =>
    items.length === 0 ? null : ordered ? (
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "var(--w-2)", lineHeight: 1.55 }}>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ol>
    ) : (
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--w-2)", lineHeight: 1.55 }}>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    );
  return (
    <div className="id-panel" style={{ padding: 16, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="id-label" style={{ color: "var(--w-2)" }}>Analysis</span>
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ background: "none", border: "none", padding: 0, font: "inherit", fontSize: 11.5, color: "var(--w-3)", cursor: "pointer" }}>
          {open ? "hide" : "show"}
        </button>
      </div>
      <p style={{ fontSize: 13.5, color: "var(--w-1)", lineHeight: 1.55, margin: "8px 0 0" }}>{analysis.overview}</p>
      {open && (
        <>
          {analysis.strategy.length > 0 && <Section title="Core strategy"><List items={analysis.strategy} ordered /></Section>}
          {analysis.mulligan.length > 0 && <Section title="Mulligan priorities"><List items={analysis.mulligan} /></Section>}
          {analysis.keyCards.length > 0 && (
            <Section title="Key cards">
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--w-2)", lineHeight: 1.55 }}>
                {analysis.keyCards.map((c) => (
                  <li key={c.name}><b style={{ color: "var(--w-1)" }}>{c.name}</b>{" "}— {c.why}</li>
                ))}
              </ul>
            </Section>
          )}
          {analysis.tips.length > 0 && <Section title="Key tips"><List items={analysis.tips} /></Section>}
          {(analysis.weaknesses.critical.length > 0 || analysis.weaknesses.minor.length > 0) && (
            <Section title="Weaknesses">
              {analysis.weaknesses.critical.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--gold)", marginBottom: 3 }}>Critical</div>
              )}
              <List items={analysis.weaknesses.critical} />
              {analysis.weaknesses.minor.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--w-3)", margin: "8px 0 3px" }}>Minor</div>
              )}
              <List items={analysis.weaknesses.minor} />
            </Section>
          )}
          {analysis.axes.length > 0 && (
            <Section title="On the axes">
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--w-2)", lineHeight: 1.55 }}>
                {analysis.axes.map((a) => (
                  <li key={a.key}><b style={{ color: "var(--w-1)", textTransform: "capitalize" }}>{a.key}</b>{" "}— {a.note}</li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
