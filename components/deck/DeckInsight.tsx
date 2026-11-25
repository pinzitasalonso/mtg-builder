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

import Link from "next/link";
import { refreshPlan, rememberUpgradeFrom } from "@/lib/plan-client";
import { LimitNotice } from "@/components/Upgrade";
import { isLimitMessage } from "@/lib/limits";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ScanSearch } from "lucide-react";
import { CardName, CardThumb, LinkedText } from "@/components/deck/CardHover";
import type { DeckScoreReport } from "@/lib/deck-score-report";
import type { AnalysisDocument, DeckScan } from "@/lib/deck-analysis";
import {
  BRACKET_LABEL,
  BRACKET_NUMBER,
  shownBracket,
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
  /** The combo lookup is still in flight (combos is null until it answers). */
  combosLoading: boolean;
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
  const [combosLoading, setCombosLoading] = useState(true);
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
    setCombosLoading(true);
    fetch(`/api/decks/${deckId}/combos`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => live && setCombos(b))
      .catch(() => live && setCombos(null))
      .finally(() => live && setCombosLoading(false));
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
    combosLoading,
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
export function StatSection({ title, aside, children }: { title: string; /** Sits at the end of the title's line. */ aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, minHeight: 30 }}>
        <span className="id-label" style={{ color: "var(--w-2)", whiteSpace: "nowrap" }}>{title}</span>
        {/* Gold fading to nothing. Plain `var(--gold)` at half opacity rather
            than a color-mix() — lightningcss mangles those, and there is no
            reason to find out whether an inline style escapes it. */}
        <span
          aria-hidden
          style={{ flex: 1, height: 1, opacity: 0.5, background: "linear-gradient(to right, var(--gold), transparent)" }}
        />
        {aside}
      </div>
      {children}
    </section>
  );
}

/** One figure of the at-a-glance tiles: a small label, the number, a note. */
function StatTile({
  label,
  value,
  detail,
  warn,
  onClick,
  actionLabel,
}: {
  label: string;
  value: string;
  detail?: string | null;
  warn?: boolean;
  /** Makes the tile a button (Combos → the combo list). */
  onClick?: () => void;
  actionLabel?: string;
}) {
  const body = (
    <>
      <div className="id-label st-tile-label">
        {label}
        {onClick && <ChevronDown size={13} strokeWidth={2.5} aria-hidden />}
      </div>
      <div className="st-tile-value" data-warn={warn || undefined}>{value}</div>
      {detail && <div className="st-tile-detail">{detail}</div>}
    </>
  );
  if (!onClick) return <div className="st-tile">{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-label={actionLabel} className="st-tile stat-tile-link">
      {body}
    </button>
  );
}

/** Where the combos are, for the tile that jumps to them. */
const COMBOS_ID = "deck-combos";

/** What a combo list amounts to, in a few words. */
function comboSummary(list: ComboResult["combos"], hasTwoCard: boolean): string | null {
  const wins = list.filter(winsTheGame).length;
  return (
    [
      wins ? `${wins} win${wins === 1 ? "s" : ""} the game` : null,
      hasTwoCard ? "a two-card combo" : null,
      // Otherwise, what they make: "infinite tokens · infinite damage".
      ...(wins ? [] : [...new Set(list.map((c) => c.produces[0]?.toLowerCase()).filter(Boolean))].slice(0, 2)),
    ]
      .filter(Boolean)
      .join(" · ") || null
  );
}
const winsTheGame = (c: ComboResult["combos"][number]) => c.produces.some((p) => /win the game/i.test(p));

/**
 * The figures you glance at: size, average cost, lands, combos. The bracket
 * and the Score used to be two more of these; they are the panel above now.
 */
export function InsightTiles({
  insight,
  avgManaValue,
  cardCount,
  target,
  lands,
}: {
  insight: DeckInsightData;
  avgManaValue: number;
  cardCount: number;
  target: number;
  lands: number;
}) {
  const { combos } = insight;
  // Null while loading, or when Spellbook didn't answer: "0" would claim a
  // count we don't have.
  const comboList = combos?.combos ?? null;
  const comboValue = comboList === null ? (insight.combosLoading ? "…" : "—") : String(comboList.length);
  const comboDetail =
    comboList === null
      ? insight.combosLoading
        ? "checking Spellbook…"
        : "couldn’t check right now"
      : comboList.length === 0
        ? "none in the list"
        : comboSummary(comboList, combos?.hasTwoCardCombo ?? false);
  const missing = target - cardCount;
  const toCombos = () => document.getElementById(COMBOS_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="st-tiles">
      <StatTile
        label="Cards"
        value={`${cardCount}/${target}`}
        detail={missing > 0 ? `${missing} to go` : missing < 0 ? `${-missing} over` : "complete"}
        warn={missing < 0}
      />
      {Number.isFinite(avgManaValue) && <StatTile label="Average cost" value={avgManaValue.toFixed(2)} detail="lands excluded" />}
      <StatTile label="Lands" value={String(lands)} detail={cardCount ? `${Math.round((lands / cardCount) * 100)}% of the deck` : null} />
      <StatTile
        label="Combos"
        value={comboValue}
        detail={comboDetail}
        onClick={comboList && comboList.length > 0 ? toCombos : undefined}
        actionLabel={comboList && comboList.length > 0 ? `Go to the ${comboList.length} combo${comboList.length === 1 ? "" : "s"}` : undefined}
      />
    </div>
  );
}

/** Trailing zeros off the quarter grid: 6.25 stays, 6.00 becomes 6. */
const trim = (n: number): string => String(Number(n.toFixed(2)));

/** What each axis measures, for a deck that hasn't been scanned. */
const AXIS_MEANS: { key: string; label: string; means: string }[] = [
  { key: "consistency", label: "Consistency", means: "How reliably it finds what it needs" },
  { key: "resilience", label: "Resilience", means: "How well it recovers" },
  { key: "interaction", label: "Interaction", means: "How much it can stop" },
  { key: "speed", label: "Speed", means: "How early it takes a player out" },
];

const DEPENDENCY: Record<string, string> = {
  none: "Plays fine without its commander",
  moderate: "Leans on its commander",
  high: "Needs its commander",
};

/**
 * The Score, as the pane's lead: the number, the bracket it plays at, the
 * four axes with their working a click away, and the scan's verdict in
 * words (what the deck is, what beats it). A deck that hasn't been scanned
 * gets the same panel with the offer to scan it.
 *
 * The axes are bars beside the number because the index alone hides the
 * shape: 9/3/3/9 and 6/7/7/6 average to nearly the same and play nothing alike.
 */
export function InsightScoreHero({
  insight,
  scanSlot,
  canEdit,
  commanderFormat,
}: {
  insight: DeckInsightData;
  /** The scan button and its meter (nothing, for a viewer). */
  scanSlot: ReactNode;
  canEdit: boolean;
  /** Brackets are Commander's: another format's deck shows none. */
  commanderFormat: boolean;
}) {
  const { bracket, changers, combos, scan } = insight;
  const score = scan?.score ?? null;
  const analysis = scan?.analysis ?? null;
  const [openAxis, setOpenAxis] = useState<string | null>(null);

  // Nil at zero, deliberately. `changers` is also null before the list has
  // loaded, and "from 0 game changers" would claim a measurement not taken.
  const bracketDetail =
    changers === null
      ? "counting…"
      : [changers > 0 ? `${changers} game changer${changers === 1 ? "" : "s"}` : null, combos?.hasTwoCardCombo ? "two-card combo" : null]
          .filter(Boolean)
          .join(" · ") || null;
  // When the deck plays above its rules bracket, the Score's floor is the
  // bracket shown and the rules one becomes the note: a deck that plays like
  // a 3 is a 3 at the table, whatever its Game Changer count.
  const shown = shownBracket(bracket, score?.bracketFloor);
  const bracketNote = shown.byScore
    ? `By its Score. By the rules alone: ${BRACKET_NUMBER[bracket]}${bracketDetail ? ` (${bracketDetail})` : ""}.`
    : bracketDetail;
  const noteFor = (key: string) => analysis?.axes.find((a) => a.key === key)?.note ?? null;
  const turn = score && Number.isFinite(score.fundamentalTurn) ? Math.round(score.fundamentalTurn * 2) / 2 : null;

  return (
    <section className="st-hero" aria-label="Deck Score">
      <div className="st-hero-top">
        <div className="st-hero-score">
          <div className="id-label st-eyebrow">Deck Score</div>
          {score ? (
            <div className="st-score-num">
              {score.label}
              <span>/10</span>
            </div>
          ) : (
            <div className="st-score-none">Not scored yet</div>
          )}
          {commanderFormat && (
            <>
              <div className="st-bracket">
                <b>Bracket {BRACKET_NUMBER[shown.bracket]}</b> · {BRACKET_LABEL[shown.bracket]}
              </div>
              {bracketNote && <div className="st-bracket-note">{bracketNote}</div>}
            </>
          )}
          {score && (
            <ul className="st-facts">
              {turn !== null && <li>Takes a player out around turn {trim(turn)}</li>}
              {DEPENDENCY[score.commanderDependency] && <li>{DEPENDENCY[score.commanderDependency]}</li>}
            </ul>
          )}
        </div>

        <div className="st-axes">
          {score
            ? score.axes.map((a) => {
                const open = openAxis === a.key;
                const note = noteFor(a.key);
                return (
                  <div key={a.key} className="st-axis" data-open={open || undefined}>
                    <button type="button" className="st-axis-row" onClick={() => setOpenAxis(open ? null : a.key)} aria-expanded={open}>
                      <span className="st-axis-label">{a.label}</span>
                      <span className="st-axis-track">
                        <span style={{ width: `${Math.max(2, (a.score / 10) * 100)}%` }} />
                      </span>
                      <span className="st-axis-score">{trim(a.score)}</span>
                      <span className="st-axis-desc">{a.descriptor}</span>
                      <ChevronDown size={15} strokeWidth={2.25} className="st-axis-chev" aria-hidden />
                    </button>
                    {open && (
                      <div className="st-axis-work">
                        {note && (
                          <p className="st-axis-note">
                            <LinkedText text={note} />
                          </p>
                        )}
                        <div className="id-label st-work-label">How it was counted</div>
                        <p className="st-work-summary">{a.summary}</p>
                        <ul className="st-list">
                          {a.facts.map((f, i) => (
                            <li key={i}>{f}</li>
                          ))}
                        </ul>
                        {a.cards.map((g) => (
                          <div key={g.label} className="st-work-cards">
                            <span className="id-label st-work-label">
                              {g.label} · {g.names.length}
                            </span>
                            <div className="st-names">
                              {g.names.map((n) => (
                                <CardName key={n} name={n} />
                              ))}
                            </div>
                          </div>
                        ))}
                        {/* What is estimated rather than counted. It sat under
                            the scan button as a paragraph of small print; it
                            belongs with the working it qualifies. */}
                        {score.caveats.length > 0 && <p className="st-hero-small" style={{ marginTop: 12 }}>{score.caveats.join(" ")}</p>}
                      </div>
                    )}
                  </div>
                );
              })
            : AXIS_MEANS.map((a) => (
                <div key={a.key} className="st-axis" data-empty>
                  <div className="st-axis-row">
                    <span className="st-axis-label">{a.label}</span>
                    <span className="st-axis-track" />
                    <span className="st-axis-means">{a.means}</span>
                  </div>
                </div>
              ))}
        </div>
      </div>

      {analysis && (analysis.overview || analysis.weaknesses.critical.length > 0 || analysis.weaknesses.minor.length > 0) && (
        <div className="st-read">
          {analysis.overview && (
            <p className="st-read-lede">
              <LinkedText text={analysis.overview} />
            </p>
          )}
          {(analysis.weaknesses.critical.length > 0 || analysis.weaknesses.minor.length > 0) && (
            <div className="st-weak">
              {analysis.weaknesses.critical.length > 0 && (
                <div>
                  <div className="id-label st-weak-label" data-critical>What beats it</div>
                  <ul className="st-list">
                    {analysis.weaknesses.critical.map((t, i) => (
                      <li key={i}><LinkedText text={t} /></li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.weaknesses.minor.length > 0 && (
                <div>
                  <div className="id-label st-weak-label">What slows it</div>
                  <ul className="st-list">
                    {analysis.weaknesses.minor.map((t, i) => (
                      <li key={i}><LinkedText text={t} /></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* The foot is the scan button (the owner's) or, before any scan, what
          a scan is. A viewer of a scanned deck has neither. */}
      {(canEdit || !score) && (
        <div className="st-hero-foot">
          {!score && (
            <p className="st-hero-pitch">
              {canEdit
                ? "A scan measures the deck on four axes and writes up how it plays: the plan, the hands to keep, the key cards and what beats it."
                : "This deck hasn’t been scanned yet. A scan measures it on four axes and writes up how it plays."}
            </p>
          )}
          {scanSlot}
        </div>
      )}
    </section>
  );
}

/** How many combos show before "Show all". Each one is a few lines tall. */
const COMBOS_SHOWN = 4;
/** How many of a combo's results show before its steps are opened. */
const MAKES_SHOWN = 3;

/**
 * The combos the list can assemble, each with its pieces as cards you can
 * point at, what it makes, and its steps a click away.
 *
 * They used to sit folded behind a pill at the very foot of the pane, as
 * names in a line of text. A player looks for "how does this deck win", and
 * a combo is the shortest answer to that: it belongs in view, near the top.
 */
export function InsightCombos({ insight }: { insight: DeckInsightData }) {
  const [all, setAll] = useState(false);
  const [openSteps, setOpenSteps] = useState<string | null>(null);
  const { combos, combosLoading } = insight;
  // The ones that end the game first, then the ones that need fewest cards.
  const list = useMemo(
    () => [...(combos?.combos ?? [])].sort((a, b) => Number(winsTheGame(b)) - Number(winsTheGame(a)) || a.pieces.length - b.pieces.length),
    [combos]
  );
  const shown = all ? list : list.slice(0, COMBOS_SHOWN);

  let body: ReactNode;
  if (!combos) {
    body = <p className="st-quiet">{combosLoading ? "Checking Commander Spellbook…" : "Couldn’t check for combos right now."}</p>;
  } else if (list.length === 0) {
    body = <p className="st-quiet">No combos in this list.</p>;
  } else {
    const summary = comboSummary(list, combos.hasTwoCardCombo);
    body = (
      <>
        {summary && <p className="st-quiet" style={{ marginBottom: 12 }}>{summary.charAt(0).toUpperCase() + summary.slice(1)}.</p>}
        <div className="st-combos">
          {shown.map((c) => {
            const open = openSteps === c.id;
            // A win first, whatever order Spellbook gives them in.
            const made = [...c.produces].sort((a, b) => Number(/win the game/i.test(b)) - Number(/win the game/i.test(a)));
            return (
              <article key={c.id} className="st-combo">
                <div className="st-combo-thumbs">
                  {c.pieces.map((n) => (
                    <CardThumb key={n} name={n} width={58} />
                  ))}
                </div>
                <div className="st-combo-body">
                  <div className="st-combo-pieces">
                    {c.pieces.map((n, i) => (
                      <span key={n}>
                        {i > 0 && <span className="st-combo-plus"> + </span>}
                        <CardName name={n} />
                      </span>
                    ))}
                  </div>
                  {/* Spellbook lists every by-product ("infinite LTB", "infinite
                      storm count"…). The first few say what the combo is for;
                      the rest show with its steps. */}
                  <div className="st-combo-makes">
                    {(open ? made : made.slice(0, MAKES_SHOWN)).map((p) => (
                      <span key={p} className="st-chip" data-win={/win the game/i.test(p) || undefined}>
                        {p}
                      </span>
                    ))}
                    {!open && made.length > MAKES_SHOWN && <span className="st-combo-also">and {made.length - MAKES_SHOWN} more</span>}
                    {c.manaNeeded && <span className="st-combo-mana">{c.manaNeeded}</span>}
                  </div>
                  {c.steps && (
                    <>
                      <button type="button" className="st-more" onClick={() => setOpenSteps(open ? null : c.id)} aria-expanded={open}>
                        How it goes off <ChevronDown size={14} strokeWidth={2.25} aria-hidden style={{ transform: open ? "rotate(180deg)" : undefined }} />
                      </button>
                      {open && (
                        <ol className="st-list st-steps">
                          {c.steps
                            .split("\n")
                            .map((t) => t.trim())
                            .filter(Boolean)
                            .map((t, i) => (
                              <li key={i}><LinkedText text={t} /></li>
                            ))}
                        </ol>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {list.length > COMBOS_SHOWN && (
          <button type="button" className="st-more" style={{ marginTop: 12 }} onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? "Show fewer" : `Show all ${list.length}`}
          </button>
        )}
      </>
    );
  }
  return (
    <div id={COMBOS_ID} style={{ scrollMarginTop: 90 }}>
      <StatSection title={list.length ? `Combos · ${list.length}` : "Combos"}>{body}</StatSection>
    </div>
  );
}

/** The games played with the deck, newest first. Nothing when there are none. */
export function InsightRecord({ insight }: { insight: DeckInsightData }) {
  const games = insight.history?.games ?? [];
  if (games.length === 0) return null;
  const won = games.filter((g) => g.won).length;
  return (
    <StatSection title={`Record · ${won} won of ${games.length}`}>
      <div className="st-record">
        {games.slice(0, 12).map((g) => (
          <div key={g.id} className="st-record-row">
            <span data-won={g.won || undefined}>{g.won ? "Won" : "Lost"}</span>
            <span>{g.opponents.length ? g.opponents.join(" · ") : "—"}</span>
            {g.isManual && <small>typed in</small>}
            <time>{new Date(g.playedAt).toLocaleDateString()}</time>
          </div>
        ))}
      </div>
    </StatSection>
  );
}

/** Eight categories of eight plus thirty-five lands, each row openable. */
export function InsightEightByEight({ insight }: { insight: DeckInsightData }) {
  const [openBucket, setOpenBucket] = useState<string | null>(null);
  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--w-3)", lineHeight: 1.5, margin: "0 0 10px", maxWidth: 620 }}>
        The 8×8 shape: eight categories of eight, plus thirty-five lands. A starting point, not a rule.
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
                      <CardName name={e.name} />
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
      refreshPlan();
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
  const scannedOn = insight.scan?.scannedAt ? new Date(insight.scan.scannedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null;
  // Out of scans for today: the way to more sits beside the meter, and a
  // refused scan gets the full notice.
  const goPro = exhausted && !isLimitMessage(error) && (
    <Link href="/pricing" onClick={rememberUpgradeFrom} className="go-pro-link" style={{ fontSize: 12 }}>
      Go Pro for unlimited scans
    </Link>
  );
  const refused = isLimitMessage(error) && error ? <LimitNotice text={error} style={{ marginTop: 10, maxWidth: 560 }} /> : null;

  return (
    <div>
      {!showNotes ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {/* The panel's one action, so it is the filled button, for a first
              scan and for another. (It used to be a pill that ended in the
              word "show".) */}
          <button
            type="button"
            className="id-btn"
            style={{ padding: "11px 20px", fontSize: 14.5 }}
            disabled={running}
            onClick={() => (hasPrimer ? void run() : setShowNotes(true))}
          >
            <ScanSearch size={16} strokeWidth={2.25} /> {running ? "Scanning…" : insight.scan ? "Scan again" : "Scan this deck"}
          </button>
          {scannedOn && !running && <span style={{ fontSize: 11.5, color: "var(--w-3)" }}>last scanned {scannedOn}</span>}
          {hasPrimer && !running && <span style={{ fontSize: 11.5, color: "var(--w-3)" }}>guided by your primer</span>}
          {meter && <span style={{ fontSize: 11.5, color: exhausted ? "var(--gold)" : "var(--w-3)" }}>{meter}</span>}
          {goPro}
          {running && <span style={{ fontSize: 11.5, color: "var(--w-3)" }}>about half a minute — you can keep working</span>}
          {error && !refused && <span style={{ fontSize: 12, color: "var(--gold)" }}>{error}</span>}
          {refused && <div style={{ flexBasis: "100%" }}>{refused}</div>}
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
            {goPro}
          </div>
          {running && (
            <div style={{ fontSize: 12, color: "var(--w-3)", marginTop: 8 }}>Reading the list, goldfishing a few hundred hands, writing it up — about half a minute.</div>
          )}
          {error && !refused && <div style={{ fontSize: 12.5, color: "var(--gold)", marginTop: 8, lineHeight: 1.5 }}>{error}</div>}
          {refused}
        </div>
      )}
    </div>
  );
}

/**
 * The piloting half of the scan's write-up: the plan in steps, the hands to
 * keep, the key cards, the tips. (Its other half, what the deck is and what
 * beats it, and its note on each axis, sit with the Score they explain.)
 */
export function InsightGamePlan({ analysis }: { analysis: AnalysisDocument }) {
  const Part = ({ title, children }: { title: string; children: ReactNode }) => (
    <div className="st-plan-part">
      <div className="id-label st-work-label">{title}</div>
      {children}
    </div>
  );
  return (
    <div className="id-panel st-plan">
      {analysis.strategy.length > 0 && (
        <Part title="The plan">
          <ol className="st-list st-steps">
            {analysis.strategy.map((t, i) => (
              <li key={i}><LinkedText text={t} /></li>
            ))}
          </ol>
        </Part>
      )}
      {analysis.mulligan.length > 0 && (
        <Part title="Opening hands">
          <ul className="st-list">
            {analysis.mulligan.map((t, i) => (
              <li key={i}><LinkedText text={t} /></li>
            ))}
          </ul>
        </Part>
      )}
      {analysis.keyCards.length > 0 && (
        <Part title="Key cards">
          <div className="st-keys">
            {analysis.keyCards.map((c) => (
              <div key={c.name} className="st-key">
                <CardThumb name={c.name} width={46} />
                <div>
                  <CardName name={c.name} strong />
                  <p><LinkedText text={c.why} /></p>
                </div>
              </div>
            ))}
          </div>
        </Part>
      )}
      {analysis.tips.length > 0 && (
        <Part title="Tips">
          <ul className="st-list">
            {analysis.tips.map((t, i) => (
              <li key={i}><LinkedText text={t} /></li>
            ))}
          </ul>
        </Part>
      )}
    </div>
  );
}
