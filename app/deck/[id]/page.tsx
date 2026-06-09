"use client";

import { use, useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import SwipeModal from "@/components/SwipeModal";
import ToolSheet, { Tool } from "@/components/deck/ToolSheet";
import JudgeModal from "@/components/deck/JudgeModal";
import HandSimModal from "@/components/deck/HandSimModal";
import ComboModal from "@/components/deck/ComboModal";
import { ModalShell, Field, ErrorNote, paperInput, ghostBtn, goldBtn, toolBtn } from "@/components/deck/ui";
import { OutCard, resolveNamed } from "@/lib/scryfall";
import { PoolEntry, Board, poolByName, resolveAndAdd, moveCard } from "@/lib/pool-client";
import { cardWarnings } from "@/lib/legality";
import {
  CardArt,
  ManaCost,
  ColorPips,
  ClassicCard,
  ClassicRow,
  StatCard,
  ManaCurve,
  ColorBar,
  TypeBreakdown,
  CountRing,
  deckStats,
  categoryOf,
  deckTarget,
  TYPE_ORDER,
} from "@/components/mtg";

type SearchCard = OutCard;
type PoolCard = PoolEntry;

interface Deck {
  id: number;
  name: string;
  format: string;
  commander: string | null;
}

const COLORS = [
  { code: "w", label: "W" },
  { code: "u", label: "U" },
  { code: "b", label: "B" },
  { code: "r", label: "R" },
  { code: "g", label: "G" },
];

const TYPES = [
  "Creature", "Instant", "Sorcery", "Enchantment",
  "Artifact", "Planeswalker", "Land", "Legendary",
];

const MANA_VALUES = [0, 1, 2, 3, 4, 5, 6, 7];

const RARITIES = [
  { code: "common", label: "Common" },
  { code: "uncommon", label: "Uncommon" },
  { code: "rare", label: "Rare" },
  { code: "mythic", label: "Mythic" },
];

const FORMATS = [
  { code: "standard", label: "Standard" },
  { code: "pioneer", label: "Pioneer" },
  { code: "modern", label: "Modern" },
  { code: "legacy", label: "Legacy" },
  { code: "vintage", label: "Vintage" },
  { code: "commander", label: "Commander" },
  { code: "pauper", label: "Pauper" },
];

const EDIT_FORMATS = ["commander", "standard", "modern", "pioneer", "legacy", "vintage", "pauper", "draft"];

const AI_SUGGESTIONS = ["blue clones", "cheap card draw", "board wipes", "ramp"];

type SearchMode = "ai" | "scryfall" | "name";

/* The query text is the single source of truth. Chips toggle Scryfall tokens
   directly in and out of the input, and their selected state is derived from
   whatever is currently typed there. */
const ID_RE = /^id:([wubrg]+)$/i;
const queryTokens = (q: string) => q.split(/\s+/).filter(Boolean);

function toggleToken(query: string, token: string): string {
  const tokens = queryTokens(query);
  const i = tokens.indexOf(token);
  if (i >= 0) tokens.splice(i, 1);
  else tokens.push(token);
  return tokens.join(" ");
}
const hasToken = (q: string, token: string) => queryTokens(q).includes(token);

function toggleColor(query: string, letter: string): string {
  const tokens = queryTokens(query);
  const i = tokens.findIndex((t) => ID_RE.test(t));
  if (i >= 0) {
    const cur = tokens[i].slice(3).toLowerCase();
    const next = cur.includes(letter) ? cur.replace(letter, "") : cur + letter;
    const ordered = "wubrg".split("").filter((c) => next.includes(c)).join("");
    if (ordered) tokens[i] = `id:${ordered}`;
    else tokens.splice(i, 1);
  } else {
    tokens.push(`id:${letter}`);
  }
  return tokens.join(" ");
}
function colorActive(query: string, letter: string): boolean {
  const t = queryTokens(query).find((t) => ID_RE.test(t));
  return t ? t.slice(3).toLowerCase().includes(letter) : false;
}

/* parchment-on-dark pill toggle */
function Chip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={{
        padding: "6px 13px",
        borderRadius: 16,
        border: "none",
        cursor: "pointer",
        fontFamily: "var(--font-body)",
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        whiteSpace: "nowrap",
        background: active ? "var(--gold)" : "rgba(20,14,8,.5)",
        color: active ? "#211705" : "var(--text-muted)",
        boxShadow: active ? "none" : "inset 0 0 0 1px rgba(200,155,65,.2)",
        transition: "all .12s",
      }}
    >
      {children}
    </button>
  );
}

function FGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label-sc" style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8, letterSpacing: ".12em" }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const plateBtn: React.CSSProperties = {
  borderRadius: 9,
  border: "none",
  cursor: "pointer",
  color: "#f0e3c4",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  textDecoration: "none",
};

export default function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const deckId = Number(id);

  const [deck, setDeck] = useState<Deck | null>(null);
  const [deckMissing, setDeckMissing] = useState(false);
  const [pool, setPool] = useState<PoolCard[]>([]);
  const [searchResults, setSearchResults] = useState<SearchCard[]>([]);
  const [swipeOpen, setSwipeOpen] = useState(false);
  const [swipeQuery, setSwipeQuery] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [generatedQuery, setGeneratedQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [preview, setPreview] = useState<SearchCard | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>("ai");
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState("");
  const [nameAdding, setNameAdding] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");

  // settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [edit, setEdit] = useState({ name: "", format: "commander", commander: "" });
  const [saving, setSaving] = useState(false);

  // tool sheet (export / import / lands) — its state lives in <ToolSheet>
  const [tool, setTool] = useState<Tool | null>(null);

  // review-with-swipe mode (snapshot of the pool so live reloads don't disturb it)
  const [reviewCards, setReviewCards] = useState<PoolCard[] | null>(null);

  // AI pool judge — runs in <JudgeModal> while open
  const [judgeOpen, setJudgeOpen] = useState(false);

  // sample-hand simulator & combo finder
  const [handSimOpen, setHandSimOpen] = useState(false);
  const [combosOpen, setCombosOpen] = useState(false);

  // commander's color identity (resolved from Scryfall) for legality checks
  const [cmdrIdentity, setCmdrIdentity] = useState<string | null>(null);

  const loadPool = useCallback(async () => {
    const res = await fetch(`/api/decks/${deckId}/cards`);
    if (!res.ok) return;
    const data = await res.json();
    setPool(
      data.map((c: { id: number; scryfallId: string; name: string; imageUri: string; manaCost: string | null; typeLine: string | null; oracleText: string | null; quantity?: number; board?: string; role?: string | null; colorIdentity?: string | null; legalities?: string | null }) => {
        let legalities: Record<string, string> | null = null;
        if (c.legalities) {
          try {
            legalities = JSON.parse(c.legalities);
          } catch {
            legalities = null;
          }
        }
        return {
          dbId: c.id,
          id: c.scryfallId,
          name: c.name,
          imageUri: c.imageUri,
          manaCost: c.manaCost,
          typeLine: c.typeLine,
          oracleText: c.oracleText,
          quantity: c.quantity ?? 1,
          board: c.board === "deck" ? "deck" : "pool",
          role: c.role ?? null,
          colorIdentity: c.colorIdentity ?? null,
          legalities,
        };
      })
    );
  }, [deckId]);

  useEffect(() => {
    fetch(`/api/decks/${deckId}`)
      .then(async (r) => {
        if (r.ok) setDeck(await r.json());
        else setDeckMissing(true);
      })
      .catch(() => {});
    loadPool();
  }, [deckId, loadPool]);

  // Backfill legality data and AI role tags for rows that still lack them.
  // One attempt each per page load — both routes are idempotent.
  const enrichTried = useRef(false);
  const rolesTried = useRef(false);
  useEffect(() => {
    if (pool.length === 0) return;
    if (!enrichTried.current && pool.some((c) => c.colorIdentity === null)) {
      enrichTried.current = true;
      fetch(`/api/decks/${deckId}/enrich`, { method: "POST" })
        .then((r) => {
          if (r.ok) loadPool();
        })
        .catch(() => {});
    }
    if (!rolesTried.current && pool.some((c) => c.role === null)) {
      rolesTried.current = true;
      fetch(`/api/decks/${deckId}/roles`, { method: "POST" })
        .then((r) => {
          if (r.ok) loadPool();
        })
        .catch(() => {});
    }
  }, [pool, deckId, loadPool]);

  // Resolve the commander's color identity once per commander change.
  useEffect(() => {
    const name = deck?.commander?.trim();
    if (!name || (deck?.format ?? "").toLowerCase() !== "commander") {
      setCmdrIdentity(null);
      return;
    }
    let cancelled = false;
    resolveNamed(name).then((c) => {
      if (!cancelled) setCmdrIdentity(c?.colorIdentity ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [deck?.commander, deck?.format]);

  function clearAllFilters() {
    setQuery((q) =>
      queryTokens(q)
        .filter((t) => !ID_RE.test(t) && !/^t:/i.test(t) && !/^mv(=|>=)/i.test(t) && !/^r:/i.test(t) && !/^f:/i.test(t))
        .join(" ")
    );
  }

  const activeFilterCount =
    COLORS.filter((c) => colorActive(query, c.code)).length +
    TYPES.filter((t) => hasToken(query, `t:${t.toLowerCase()}`)).length +
    MANA_VALUES.filter((v) => hasToken(query, v >= 7 ? "mv>=7" : `mv=${v}`)).length +
    RARITIES.filter((r) => hasToken(query, `r:${r.code}`)).length +
    FORMATS.filter((f) => hasToken(query, `f:${f.code}`)).length;

  /* Core search — opens the swipe modal with the results on success. */
  const runSearch = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setSearching(true);
      setSearchError("");
      setSearchResults([]);
      setGeneratedQuery("");
      setSources([]);
      setSwipeQuery(text);
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text, mode: searchMode }),
        });
        const data = await res.json();
        if (!res.ok) {
          setSearchError(data.details?.details ?? data.error ?? "Search failed");
        } else {
          const poolIds = new Set(pool.map((c) => c.id));
          const filtered = (data.cards as SearchCard[]).filter((c) => !poolIds.has(c.id));
          setSearchResults(filtered);
          setGeneratedQuery(data.query);
          setTruncated(Boolean(data.truncated));
          setSources(Array.isArray(data.sources) ? data.sources : []);
          if (filtered.length > 0) setSwipeOpen(true);
          else setSearchError("No cards matched — try a different search.");
        }
      } catch {
        setSearchError("Network error");
      }
      setSearching(false);
    },
    [searchMode, pool]
  );

  function onSubmitSearch(e: React.FormEvent) {
    e.preventDefault();
    runSearch(query);
  }
  function onSuggestion(s: string) {
    setQuery(s);
    runSearch(s);
  }

  const addCard = useCallback(
    async (card: SearchCard) => {
      if (pool.some((c) => c.id === card.id)) return;
      await fetch(`/api/decks/${deckId}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scryfallId: card.id,
          name: card.name,
          imageUri: card.imageUri,
          manaCost: card.manaCost,
          typeLine: card.typeLine,
          oracleText: card.oracleText,
          colorIdentity: card.colorIdentity,
          legalities: card.legalities,
        }),
      });
      loadPool();
    },
    [pool, deckId, loadPool]
  );

  async function addByName(e: React.FormEvent) {
    e.preventDefault();
    const name = nameInput.trim();
    if (!name) return;
    setNameAdding(true);
    setNameError("");
    const r = await resolveAndAdd(deckId, name, 1, poolByName(pool));
    if (r === "added") {
      setNameInput("");
      await loadPool();
    } else {
      setNameError(r === "notfound" ? "Card not found — check the spelling." : "Couldn't add that card.");
    }
    setNameAdding(false);
  }

  async function removeCard(dbId: number) {
    await fetch(`/api/decks/${deckId}/cards/${dbId}`, { method: "DELETE" });
    loadPool();
  }

  function openSettings() {
    if (!deck) return;
    setEdit({ name: deck.name, format: deck.format, commander: deck.commander || "" });
    setSettingsOpen(true);
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!edit.name.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/decks/${deckId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: edit.name.trim(), format: edit.format, commander: edit.commander.trim() }),
    });
    if (res.ok) {
      const updated = await res.json();
      setDeck((d) => (d ? { ...d, name: updated.name, format: updated.format, commander: updated.commander } : d));
      setSettingsOpen(false);
    }
    setSaving(false);
  }

  async function moveTo(dbId: number, board: Board) {
    await moveCard(deckId, dbId, board);
    loadPool();
  }

  const inPool = (cardId: string) => pool.some((c) => c.id === cardId);

  // ── Boards: "deck" = the actual decklist, "pool" = candidates.
  const deckCards = pool.filter((c) => c.board === "deck");
  const poolCards = pool.filter((c) => c.board !== "deck");
  const deckCount = deckCards.reduce((s, c) => s + c.quantity, 0);

  // Review — triage the pool board: swipe right to promote into the deck.
  function startReview() {
    if (poolCards.length === 0) return;
    setSettingsOpen(false);
    setReviewCards([...poolCards]);
  }

  // Sidebar stats describe the deck once it has cards; before that, the pool.
  const statsOnDeck = deckCards.length > 0;
  const statsSource = statsOnDeck ? deckCards : pool;
  const stats = deckStats(statsSource);
  const poolColors = ["W", "U", "B", "R", "G"].filter((c) => stats.colors[c] > 0);
  const target = deckTarget(deck?.format);

  // Legality warnings (format + commander color identity).
  const warningOf = (c: PoolCard): string | undefined => {
    const ws = cardWarnings(c, deck?.format, cmdrIdentity);
    return ws.length ? ws.map((w) => w.message).join(" · ") : undefined;
  };
  const warningCount = pool.reduce((n, c) => n + (warningOf(c) ? 1 : 0), 0);

  // Role breakdown over the stats source (commander targets when relevant).
  const roleCounts: Record<string, number> = {};
  for (const c of statsSource) {
    const k = c.role ?? "untagged";
    roleCounts[k] = (roleCounts[k] ?? 0) + c.quantity;
  }
  const isCommander = (deck?.format ?? "").toLowerCase() === "commander";

  const groupedFor = (cards: PoolCard[]) =>
    TYPE_ORDER.map((t) => ({
      t,
      cards: cards.filter((c) => categoryOf(c.typeLine) === t),
    })).filter((g) => g.cards.length);

  if (deckMissing) {
    return (
      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🃏</div>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, color: "var(--text)" }}>
            Deck not found
          </h1>
          <p style={{ fontStyle: "italic", color: "var(--text-muted)", marginTop: 8 }}>
            It may have been deleted, or the link is wrong.
          </p>
          <Link href="/" className="cc-plate" style={{ ...plateBtn, display: "inline-flex", marginTop: 18, padding: "11px 24px", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16 }}>
            ‹ Back to decks
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ flex: 1 }}>
      {/* top bar */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 22px",
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "color-mix(in srgb, var(--app-bg) 84%, transparent)",
          backdropFilter: "blur(12px)",
          boxShadow: "0 1px 0 rgba(200,155,65,.12)",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <Link href="/" aria-label="Back to decks" className="cc-plate" style={{ ...plateBtn, width: 38, height: 38, fontSize: 18 }}>
            ‹
          </Link>
          <div className="cc-art" style={{ width: 40, height: 40, borderRadius: 7, flexShrink: 0 }}>
            <CardArt name={deck?.commander || deck?.name} colors={poolColors} radius={0} style={{ position: "absolute", inset: 0 }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 23,
                  fontWeight: 700,
                  color: "var(--text)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {deck?.name ?? "…"}
              </span>
              {poolColors.length > 0 && <ColorPips colors={poolColors} size={16} />}
            </div>
            {deck && (
              <div style={{ fontSize: 13.5, fontStyle: "italic", color: "var(--text-dim)", marginTop: -1 }}>
                {deck.format}
                {deck.commander ? ` · ${deck.commander}` : ""}
              </div>
            )}
          </div>
        </div>
        <button onClick={openSettings} className="cc-plate" style={{ ...plateBtn, width: 38, height: 38, fontSize: 16 }} title="Deck settings" aria-label="Deck settings">
          ⚙
        </button>
      </header>

      <div className="deck-layout" style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 22px 80px" }}>
        {/* main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
          {/* search panel */}
          <div style={{ background: "var(--app-bg2)", borderRadius: 9, padding: 16, boxShadow: "inset 0 0 0 1px rgba(200,155,65,.16)" }}>
            {/* segmented control */}
            <div style={{ display: "inline-flex", gap: 5, marginBottom: 14 }}>
              {(["ai", "scryfall", "name"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setSearchMode(mode)}
                  style={{
                    padding: "7px 16px",
                    borderRadius: 8,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "var(--font-display)",
                    fontSize: 16,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    background: searchMode === mode ? "var(--gold)" : "rgba(20,14,8,.5)",
                    color: searchMode === mode ? "#211705" : "var(--text-muted)",
                    boxShadow: searchMode === mode ? "none" : "inset 0 0 0 1px rgba(200,155,65,.2)",
                    transition: "all .12s",
                  }}
                >
                  {mode === "ai" ? "✦ AI" : mode === "scryfall" ? "⚡ Scryfall" : "Name"}
                </button>
              ))}
            </div>

            {/* scryfall filters */}
            {searchMode === "scryfall" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 15, marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span className="label-sc" style={{ fontSize: 12, color: "var(--text-dim)", letterSpacing: ".12em" }}>Colors</span>
                  {activeFilterCount > 0 && (
                    <button onClick={clearAllFilters} style={{ background: "transparent", border: "none", color: "var(--gold)", fontSize: 13, fontStyle: "italic", cursor: "pointer" }}>
                      Clear all ({activeFilterCount})
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: -6 }}>
                  {COLORS.map((c) => {
                    const on = colorActive(query, c.code);
                    return (
                      <button
                        key={c.code}
                        onClick={() => setQuery((q) => toggleColor(q, c.code))}
                        aria-pressed={on}
                        title={c.label}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                          background: "transparent",
                          boxShadow: on ? "0 0 0 2px var(--gold)" : "none",
                          opacity: on || !COLORS.some((cc) => colorActive(query, cc.code)) ? 1 : 0.4,
                          transition: "all .12s",
                        }}
                      >
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            background: { w: "#f6f3e1", u: "#a9def5", b: "#c9bfb9", r: "#f6a283", g: "#9bd3ad" }[c.code],
                            color: { w: "#6a5d34", u: "#0a3a57", b: "#2a221d", r: "#6e1810", g: "#114a28" }[c.code],
                            fontWeight: 800,
                            fontSize: 14,
                            boxShadow: "inset 0 0 0 1px rgba(0,0,0,.25), inset 0 -2px 3px rgba(0,0,0,.18)",
                          }}
                        >
                          {c.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <FGroup label="Card type">
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    {TYPES.map((t) => {
                      const token = `t:${t.toLowerCase()}`;
                      return (
                        <Chip key={t} active={hasToken(query, token)} onClick={() => setQuery((q) => toggleToken(q, token))}>
                          {t}
                        </Chip>
                      );
                    })}
                  </div>
                </FGroup>
                <div style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
                  <FGroup label="Mana value">
                    <div style={{ display: "flex", gap: 6 }}>
                      {MANA_VALUES.map((v) => {
                        const token = v >= 7 ? "mv>=7" : `mv=${v}`;
                        const on = hasToken(query, token);
                        return (
                          <button
                            key={v}
                            onClick={() => setQuery((q) => toggleToken(q, token))}
                            style={{
                              width: 31,
                              height: 31,
                              borderRadius: "50%",
                              border: "none",
                              cursor: "pointer",
                              fontFamily: "var(--font-display)",
                              fontSize: 15,
                              fontWeight: 600,
                              background: on ? "var(--gold)" : "rgba(20,14,8,.5)",
                              color: on ? "#211705" : "var(--text-muted)",
                              boxShadow: on ? "none" : "inset 0 0 0 1px rgba(200,155,65,.2)",
                              transition: "all .12s",
                            }}
                          >
                            {v >= 7 ? "7+" : v}
                          </button>
                        );
                      })}
                    </div>
                  </FGroup>
                  <FGroup label="Rarity">
                    <div style={{ display: "flex", gap: 7 }}>
                      {RARITIES.map((r) => {
                        const token = `r:${r.code}`;
                        return (
                          <Chip key={r.code} active={hasToken(query, token)} onClick={() => setQuery((q) => toggleToken(q, token))}>
                            {r.label}
                          </Chip>
                        );
                      })}
                    </div>
                  </FGroup>
                </div>
                <FGroup label="Format legality">
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    {FORMATS.map((f) => {
                      const token = `f:${f.code}`;
                      return (
                        <Chip key={f.code} active={hasToken(query, token)} onClick={() => setQuery((q) => toggleToken(q, token))}>
                          {f.label}
                        </Chip>
                      );
                    })}
                  </div>
                </FGroup>
              </div>
            )}

            {/* name mode vs search */}
            {searchMode === "name" ? (
              <form onSubmit={addByName} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    className="cc-paper"
                    placeholder="Search by card name…"
                    value={nameInput}
                    onChange={(e) => {
                      setNameInput(e.target.value);
                      setNameError("");
                    }}
                    disabled={nameAdding}
                    style={paperInput}
                  />
                  <button type="submit" disabled={nameAdding || !nameInput.trim()} style={goldSearchBtn(nameAdding)}>
                    {nameAdding ? "Adding…" : "Add"}
                  </button>
                </div>
                {nameError && <ErrorNote>{nameError}</ErrorNote>}
              </form>
            ) : (
              <>
                <form onSubmit={onSubmitSearch} style={{ display: "flex", gap: 10 }}>
                  <input
                    className="cc-paper"
                    placeholder={searchMode === "ai" ? "Describe the cards you seek…" : "Scryfall syntax:  t:wizard id:u…"}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={searching}
                    style={paperInput}
                  />
                  <button type="submit" disabled={searching || !query.trim()} style={goldSearchBtn(searching)}>
                    {searchMode === "ai" && <span style={{ marginRight: 6 }}>✦</span>}
                    {searching ? "Seeking…" : "Search"}
                  </button>
                </form>
                {searchMode === "ai" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontStyle: "italic", fontSize: 13, color: "var(--text-dim)" }}>Try:</span>
                    {AI_SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => onSuggestion(s)}
                        disabled={searching}
                        style={{
                          fontFamily: "var(--font-body)",
                          fontStyle: "italic",
                          fontSize: 14,
                          padding: "3px 11px",
                          borderRadius: 14,
                          border: "none",
                          cursor: searching ? "default" : "pointer",
                          background: "transparent",
                          color: "var(--gold)",
                          boxShadow: "inset 0 0 0 1px rgba(200,155,65,.3)",
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {searchError && <div style={{ marginTop: 12 }}><ErrorNote>{searchError}</ErrorNote></div>}
            {!swipeOpen && searchResults.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, color: "var(--text-muted)" }}>
                <span style={{ fontStyle: "italic" }}>
                  {searchResults.length} cards found{truncated ? " (first batch)" : ""}
                  {sources.length > 0 ? ` · via ${sources.join(", ")}` : ""}.
                </span>
                <button onClick={() => setSwipeOpen(true)} style={{ ...goldSearchBtn(false), padding: "6px 14px", fontSize: 14 }}>
                  Review again
                </button>
              </div>
            )}
          </div>

          {/* boards — the deck proper, then the candidate pool */}
          <div>
            <SectionHeader
              title="The Deck"
              count={deckCount}
              right={
                pool.length > 0 && (
                  <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <HeaderAction onClick={() => setHandSimOpen(true)} title="Draw sample opening hands">
                      🎲 Sample hand
                    </HeaderAction>
                    <div style={{ display: "inline-flex", gap: 4 }}>
                      {([["grid", "▦"], ["list", "≣"]] as const).map(([v, ic]) => (
                        <button
                          key={v}
                          onClick={() => setView(v)}
                          style={{
                            width: 36,
                            height: 32,
                            borderRadius: 8,
                            border: "none",
                            cursor: "pointer",
                            fontSize: 16,
                            background: view === v ? "var(--gold)" : "rgba(20,14,8,.5)",
                            color: view === v ? "#211705" : "var(--text-muted)",
                            boxShadow: view === v ? "none" : "inset 0 0 0 1px rgba(200,155,65,.2)",
                          }}
                        >
                          {ic}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              }
            />
            <div style={{ marginTop: 14 }}>
              {deckCards.length === 0 ? (
                <div className="cc-paper" style={{ padding: "26px 20px", textAlign: "center", fontStyle: "italic", color: "var(--ink-soft)" }}>
                  Nothing in the deck yet — promote cards from the pool with ⇧, or swipe right in “Review pool”.
                </div>
              ) : (
                <BoardCards cards={deckCards} dest="pool" view={view} warningOf={warningOf} onMove={moveTo} onRemove={removeCard} onPreview={setPreview} groupedFor={groupedFor} />
              )}
            </div>

            <div style={{ marginTop: 26 }}>
              <SectionHeader
                title="The Pool"
                count={poolCards.reduce((s, c) => s + c.quantity, 0)}
                right={
                  <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <HeaderAction gold onClick={() => setJudgeOpen(true)} disabled={pool.length === 0} title="AI judge — review the pool">
                      ✨ Judge
                    </HeaderAction>
                    <HeaderAction onClick={startReview} disabled={poolCards.length === 0} title="Swipe through the pool — right promotes to the deck">
                      ↩ Review
                    </HeaderAction>
                    <HeaderAction onClick={() => setCombosOpen(true)} disabled={pool.length === 0} title="Find combos in the pool">
                      ♾ Combos
                    </HeaderAction>
                    <HeaderAction onClick={() => setTool("lands")} title="Bulk-add lands & staples">
                      🌲 Add lands
                    </HeaderAction>
                  </div>
                }
              />
            </div>
            <div style={{ marginTop: 14 }}>
              {poolCards.length === 0 ? (
                <div className="cc-paper" style={{ padding: "26px 20px", textAlign: "center", fontStyle: "italic", color: "var(--ink-soft)" }}>
                  {pool.length === 0
                    ? "No cards yet — search above to begin filling the pool."
                    : "Pool is empty — every card has been promoted to the deck."}
                </div>
              ) : (
                <BoardCards cards={poolCards} dest="deck" view={view} warningOf={warningOf} onMove={moveTo} onRemove={removeCard} onPreview={setPreview} groupedFor={groupedFor} />
              )}
            </div>

          </div>
        </div>

        {/* stats sidebar */}
        <aside className="deck-sidebar" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <StatCard
            label="Overview"
            right={
              <span style={{ fontSize: 13.5, fontStyle: "italic", color: "var(--text-dim)" }}>
                avg MV <b style={{ color: "var(--text)", fontStyle: "normal" }}>{stats.avgMv.toFixed(1)}</b>
              </span>
            }
          >
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <CountRing count={deckCount} target={target} accent="var(--gold)" />
              <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 14 }}>
                <span style={{ color: "var(--text-dim)", fontStyle: "italic" }}>{deck?.format ?? "—"} deck</span>
                <span style={{ color: "var(--text)", fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600 }}>
                  {target - deckCount > 0 ? `${target - deckCount} to go` : "Deck complete"}
                </span>
                <span style={{ color: "var(--text-dim)", fontStyle: "italic", fontSize: 12.5 }}>
                  + {poolCards.reduce((s, c) => s + c.quantity, 0)} in the pool
                </span>
              </div>
            </div>
            {warningCount > 0 && (
              <div style={{ marginTop: 12, fontSize: 13, color: "#e0805f", fontStyle: "italic" }}>
                ⚠ {warningCount} card{warningCount === 1 ? "" : "s"} with legality warnings — hover the ⚠ badge.
              </div>
            )}
            {!statsOnDeck && pool.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-dim)", fontStyle: "italic" }}>
                Stats show the pool until the deck has cards.
              </div>
            )}
          </StatCard>
          <StatCard label="Roles">
            {statsSource.length > 0 ? (
              <RoleBreakdown counts={roleCounts} commander={isCommander} />
            ) : (
              <span style={{ fontSize: 13.5, fontStyle: "italic", color: "var(--text-dim)" }}>No cards yet.</span>
            )}
          </StatCard>
          <StatCard label="Mana Curve">
            <ManaCurve curve={stats.curve} accent="var(--gold)" />
          </StatCard>
          <StatCard label="Colors">
            {stats.count > 0 ? <ColorBar colors={stats.colors} /> : <span style={{ fontSize: 13.5, fontStyle: "italic", color: "var(--text-dim)" }}>No cards yet.</span>}
          </StatCard>
          <StatCard label="Card Types">
            {stats.types.length > 0 ? <TypeBreakdown types={stats.types} accent="var(--gold)" /> : <span style={{ fontSize: 13.5, fontStyle: "italic", color: "var(--text-dim)" }}>No cards yet.</span>}
          </StatCard>
        </aside>
      </div>

      {/* swipe-to-add modal */}
      {swipeOpen && searchResults.length > 0 && (
        <SwipeModal
          cards={searchResults}
          query={swipeQuery}
          intent={generatedQuery || undefined}
          onAdd={addCard}
          onInfo={setPreview}
          onClose={() => {
            setSwipeOpen(false);
            loadPool();
          }}
        />
      )}

      {/* settings modal */}
      {settingsOpen && (
        <ModalShell onDismiss={() => setSettingsOpen(false)} maxWidth={420} zIndex={70}>
          <h2 style={{ margin: "0 0 16px", fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, color: "var(--frame-ink)", textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>
            Deck settings
          </h2>
          <form onSubmit={saveSettings} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Name">
              <input className="cc-paper" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required autoFocus style={paperInput} />
            </Field>
            <Field label="Format">
              <select className="cc-paper" value={edit.format} onChange={(e) => setEdit({ ...edit, format: e.target.value })} style={paperInput}>
                {EDIT_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Commander">
              <input className="cc-paper" placeholder="(optional)" value={edit.commander} onChange={(e) => setEdit({ ...edit, commander: e.target.value })} style={paperInput} />
            </Field>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
              <button type="button" onClick={() => setSettingsOpen(false)} style={ghostBtn}>
                Cancel
              </button>
              <button type="submit" disabled={saving} style={goldBtn}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>

          {/* Tools — import/export live here; judge, lands & review are on the deck screen */}
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(0,0,0,.25)" }}>
            <div className="label-sc" style={{ fontSize: 11.5, color: "rgba(236,225,198,.75)", letterSpacing: ".1em", marginBottom: 10 }}>
              Import / Export
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button type="button" onClick={() => setTool("export")} style={toolBtn}>
                ⤓ Export list
              </button>
              <button type="button" onClick={() => setTool("import")} style={toolBtn}>
                ⤒ Import list
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* export / import / lands tool sheet */}
      {tool && (
        <ToolSheet tool={tool} deckId={deckId} pool={pool} onClose={() => setTool(null)} onChanged={loadPool} />
      )}

      {/* review-pool swipe modal — triage: right promotes to the deck */}
      {reviewCards && reviewCards.length > 0 && (
        <SwipeModal
          variant="review"
          cards={reviewCards}
          query="Building your deck"
          onAdd={(card) => {
            const pc = reviewCards.find((c) => c.id === card.id);
            if (pc) moveCard(deckId, pc.dbId, "deck");
          }}
          onInfo={setPreview}
          onClose={() => {
            setReviewCards(null);
            loadPool();
          }}
        />
      )}

      {/* sample-hand simulator */}
      {handSimOpen && (
        <HandSimModal
          cards={statsOnDeck ? deckCards : pool}
          sourceLabel={statsOnDeck ? "the deck" : "the whole pool"}
          onClose={() => setHandSimOpen(false)}
        />
      )}

      {/* combo finder */}
      {combosOpen && (
        <ComboModal
          deckId={deckId}
          pool={pool}
          commander={deck?.commander}
          onClose={() => setCombosOpen(false)}
          onPoolChanged={loadPool}
        />
      )}

      {/* AI pool judge */}
      {judgeOpen && (
        <JudgeModal
          deckId={deckId}
          pool={pool}
          format={deck?.format}
          commander={deck?.commander}
          onClose={() => setJudgeOpen(false)}
          onPoolChanged={loadPool}
        />
      )}

      {/* card preview modal */}
      {preview && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(8,6,4,0.82)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 65, animation: "sp-fade .15s ease" }}
          onClick={() => setPreview(null)}
        >
          <div
            className="cc-black"
            style={{ padding: 10, maxWidth: 340, width: "100%", animation: "sp-pop .18s ease" }}
            onClick={(e) => e.stopPropagation()}
          >
            {preview.imageUri ? (
              <Image src={preview.imageUri} alt={preview.name} width={320} height={446} style={{ borderRadius: 8, width: "100%", height: "auto", display: "block" }} unoptimized />
            ) : (
              <ClassicCard card={preview} variant="full" />
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button onClick={() => setPreview(null)} style={{ ...ghostBtn, flex: 1 }}>
                Close
              </button>
              {!inPool(preview.id) ? (
                <button
                  onClick={() => {
                    addCard(preview);
                    setPreview(null);
                  }}
                  style={{ ...goldBtn, flex: 1 }}
                >
                  Add to Pool
                </button>
              ) : (
                <button
                  onClick={() => {
                    const pc = pool.find((c) => c.id === preview.id);
                    if (pc) {
                      removeCard(pc.dbId);
                      setPreview(null);
                    }
                  }}
                  style={{ flex: 1, background: "var(--danger)", border: "none", borderRadius: 7, color: "#fff", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, padding: "9px 0", cursor: "pointer" }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* Compact action button for section headers — gold variant for the primary action. */
function HeaderAction({
  onClick,
  disabled,
  gold,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  gold?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: "7px 13px",
        borderRadius: 8,
        border: "none",
        cursor: disabled ? "default" : "pointer",
        fontFamily: "var(--font-display)",
        fontSize: 14.5,
        fontWeight: 700,
        whiteSpace: "nowrap",
        background: gold ? "var(--gold)" : "rgba(20,14,8,.5)",
        color: gold ? "#211705" : "var(--text)",
        boxShadow: gold ? "none" : "inset 0 0 0 1px rgba(200,155,65,.3)",
        opacity: disabled ? 0.45 : 1,
        transition: "all .12s",
      }}
    >
      {children}
    </button>
  );
}

function SectionHeader({ title, count, right }: { title: string; count: number; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
      <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
        {title} <span style={{ color: "var(--text-dim)", fontWeight: 500, fontStyle: "italic", fontSize: 19 }}>· {count} card{count === 1 ? "" : "s"}</span>
      </h2>
      {right}
    </div>
  );
}

/* One board's cards in the active view. `dest` is where the move button sends
   a card (the other board). */
function BoardCards({
  cards,
  dest,
  view,
  warningOf,
  onMove,
  onRemove,
  onPreview,
  groupedFor,
}: {
  cards: PoolCard[];
  dest: Board;
  view: "grid" | "list";
  warningOf: (c: PoolCard) => string | undefined;
  onMove: (dbId: number, board: Board) => void;
  onRemove: (dbId: number) => void;
  onPreview: (c: PoolCard) => void;
  groupedFor: (cards: PoolCard[]) => { t: string; cards: PoolCard[] }[];
}) {
  const moveLabel = dest === "deck" ? "Move to deck" : "Move to pool";
  if (view === "grid") {
    return (
      <div className="card-grid">
        {cards.map((card) => (
          <ClassicCard
            key={card.dbId}
            card={card}
            variant="tile"
            quantity={card.quantity}
            warning={warningOf(card)}
            onMove={() => onMove(card.dbId, dest)}
            moveLabel={moveLabel}
            onRemove={() => onRemove(card.dbId)}
            onClick={() => onPreview(card)}
          />
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {groupedFor(cards).map((g) => (
        <div key={g.t}>
          <div className="label-sc" style={{ fontSize: 13, color: "var(--gold)", padding: "0 4px 7px", letterSpacing: ".12em" }}>
            {g.t}{" "}
            <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-body)", textTransform: "none", letterSpacing: 0 }}>· {g.cards.reduce((s, c) => s + c.quantity, 0)}</span>
          </div>
          <div style={{ background: "var(--app-bg2)", borderRadius: 7, padding: 5, boxShadow: "inset 0 0 0 1px rgba(200,155,65,.16)" }}>
            {g.cards.map((c) => (
              <ClassicRow
                key={c.dbId}
                card={c}
                quantity={c.quantity}
                warning={warningOf(c)}
                onMove={() => onMove(c.dbId, dest)}
                moveLabel={moveLabel}
                onRemove={() => onRemove(c.dbId)}
                onClick={() => onPreview(c)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* Role counts vs the usual commander quotas. */
const ROLE_META: { key: string; label: string; target: number | null }[] = [
  { key: "land", label: "Lands", target: 36 },
  { key: "ramp", label: "Ramp", target: 10 },
  { key: "draw", label: "Draw", target: 10 },
  { key: "removal", label: "Removal", target: 8 },
  { key: "wincon", label: "Wincons", target: 3 },
  { key: "utility", label: "Utility", target: null },
  { key: "untagged", label: "Untagged", target: null },
];

function RoleBreakdown({ counts, commander }: { counts: Record<string, number>; commander: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {ROLE_META.filter((r) => (counts[r.key] ?? 0) > 0 || (commander && r.target !== null)).map((r) => {
        const n = counts[r.key] ?? 0;
        const short = commander && r.target !== null && n < r.target;
        return (
          <div key={r.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13.5 }}>
            <span style={{ color: r.key === "untagged" ? "var(--text-dim)" : "var(--text-muted)", fontStyle: r.key === "untagged" ? "italic" : "normal" }}>
              {r.label}
            </span>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: short ? "#e0805f" : "var(--text)" }}>
              {n}
              {commander && r.target !== null && (
                <span style={{ color: "var(--text-dim)", fontWeight: 500 }}> / {r.target}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function goldSearchBtn(busy: boolean): React.CSSProperties {
  return {
    padding: "0 24px",
    borderRadius: 8,
    border: "none",
    cursor: busy ? "wait" : "pointer",
    background: "var(--gold)",
    color: "#211705",
    fontFamily: "var(--font-display)",
    fontWeight: 700,
    fontSize: 17,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
    opacity: busy ? 0.7 : 1,
  };
}
