"use client";

import { use, useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import SwipeModal from "@/components/SwipeModal";
import ToolSheet, { Tool } from "@/components/deck/ToolSheet";
import JudgeModal from "@/components/deck/JudgeModal";
import HandSimModal from "@/components/deck/HandSimModal";
import ComboModal from "@/components/deck/ComboModal";
import OrderModal from "@/components/deck/OrderModal";
import { ModalShell, Field, ErrorNote, paperInput, ghostBtn, goldBtn, toolBtn } from "@/components/deck/ui";
import { OutCard, resolveNamed } from "@/lib/scryfall";
import { PoolEntry, Board, poolByName, resolveAndAdd, moveCard } from "@/lib/pool-client";
import { cardWarnings } from "@/lib/legality";
import {
  CardArt,
  ManaCost,
  ColorPips,
  ClassicCard,
  ManaCurve,
  deckStats,
  categoryOf,
  manaValue,
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
  notes: string | null;
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
        background: active ? "var(--gold)" : "var(--bg3)",
        color: active ? "#ffffff" : "var(--text-muted)",
        boxShadow: active ? "none" : "inset 0 0 0 1px var(--line)",
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
  color: "var(--t1)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  textDecoration: "none",
};

export default function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const deckId = Number(id);
  const router = useRouter();

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

  // settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [edit, setEdit] = useState({ name: "", format: "commander", commander: "" });
  const [saving, setSaving] = useState(false);

  // tool sheet (export / import / lands) — its state lives in <ToolSheet>
  const [tool, setTool] = useState<Tool | null>(null);

  // review-with-swipe mode (snapshot of the pool so live reloads don't disturb it)
  const [reviewCards, setReviewCards] = useState<PoolCard[] | null>(null);
  // Index the review opens on — tapping a pool card starts review from that card.
  const [reviewStart, setReviewStart] = useState(0);

  // deck review — same swipe UI over the deck board: keep (→) or discard (←,
  // removes from the deck entirely; not returned to the pool).
  const [deckReviewCards, setDeckReviewCards] = useState<PoolCard[] | null>(null);
  const [deckReviewStart, setDeckReviewStart] = useState(0);

  // On mobile the pool and deck stack; this toggles which one is shown so you
  // don't have to scroll the whole pool to reach the deck. Ignored ≥1024px.
  const [mobileView, setMobileView] = useState<"pool" | "deck">("pool");

  // Hovering a mana-curve bar or a type dot filters the decklist below to that
  // selection. null = no filter (show the whole deck).
  const [deckFilter, setDeckFilter] = useState<
    { kind: "mv"; value: number } | { kind: "type"; value: string } | null
  >(null);

  // AI pool judge — runs in <JudgeModal> while open
  const [judgeOpen, setJudgeOpen] = useState(false);

  // sample-hand simulator & combo finder
  const [handSimOpen, setHandSimOpen] = useState(false);
  const [combosOpen, setCombosOpen] = useState(false);

  // "Order on CardTrader" — runs in <OrderModal> while open
  const [orderOpen, setOrderOpen] = useState(false);

  // commander's color identity (resolved from Scryfall) for legality checks
  const [cmdrIdentity, setCmdrIdentity] = useState<string | null>(null);

  // play notes — autosaved, debounced
  const [notes, setNotes] = useState("");
  const [noteStatus, setNoteStatus] = useState<"idle" | "saving" | "saved">("idle");
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedNotes = useRef("");

  const saveNotes = useCallback(
    async (text: string) => {
      if (text === lastSavedNotes.current) return;
      setNoteStatus("saving");
      const res = await fetch(`/api/decks/${deckId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: text }),
      });
      if (res.ok) {
        lastSavedNotes.current = text;
        setNoteStatus("saved");
      } else {
        setNoteStatus("idle");
      }
    },
    [deckId]
  );

  function onNotesChange(text: string) {
    setNotes(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => saveNotes(text), 900);
  }

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
        if (r.ok) {
          const d: Deck = await r.json();
          setDeck(d);
          setNotes(d.notes ?? "");
          lastSavedNotes.current = d.notes ?? "";
        } else if (r.status === 401) router.replace("/login");
        else setDeckMissing(true);
      })
      .catch(() => {});
    loadPool();
  }, [deckId, loadPool, router]);

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
          body: JSON.stringify({
            prompt: text,
            mode: searchMode,
            currentDeck: {
              commander: deck?.commander ?? null,
              cards: pool.map((c) => ({ name: c.name, manaCost: c.manaCost, typeLine: c.typeLine })),
            },
          }),
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

  // Review — triage the pool board: swipe right to promote into the deck, left
  // to drop from the pool. Opens on `startCard` when a pool tile is tapped.
  function startReview(startCard?: PoolCard) {
    if (poolCards.length === 0) return;
    setSettingsOpen(false);
    const idx = startCard ? poolCards.findIndex((c) => c.dbId === startCard.dbId) : 0;
    setReviewStart(idx < 0 ? 0 : idx);
    setReviewCards([...poolCards]);
  }

  // Deck review — triage the decklist: keep a card or discard it from the deck.
  // Opens on `startCard` when a deck row is tapped. Cards are ordered the same
  // way the rail groups them so the swipe order matches what's on screen.
  function startDeckReview(startCard?: PoolCard) {
    if (deckCards.length === 0) return;
    setSettingsOpen(false);
    const ordered = groupedFor(deckCards).flatMap((g) => g.cards);
    const idx = startCard ? ordered.findIndex((c) => c.dbId === startCard.dbId) : 0;
    setDeckReviewStart(idx < 0 ? 0 : idx);
    setDeckReviewCards(ordered);
  }

  // Sidebar stats describe the deck once it has cards; before that, the pool.
  const statsOnDeck = deckCards.length > 0;
  const statsSource = statsOnDeck ? deckCards : pool;
  const stats = deckStats(statsSource);
  const poolColors = ["W", "U", "B", "R", "G"].filter((c) => stats.colors[c] > 0);
  const target = deckTarget(deck?.format);

  // Deck-view theme driven by the deck's colour identity (commander identity
  // when known, else the colours actually present).
  const identityStr = cmdrIdentity != null && cmdrIdentity !== "" ? cmdrIdentity : poolColors.join("");
  const theme = getIdentityTheme(identityStr);
  const identityPips = (identityStr.toUpperCase().replace(/[^WUBRG]/g, "").split("").filter(Boolean));

  // Legality warnings (format + commander color identity).
  const warningOf = (c: PoolCard): string | undefined => {
    const ws = cardWarnings(c, deck?.format, cmdrIdentity);
    return ws.length ? ws.map((w) => w.message).join(" · ") : undefined;
  };
  const warningCount = pool.reduce((n, c) => n + (warningOf(c) ? 1 : 0), 0);


  const groupedFor = (cards: PoolCard[]) =>
    TYPE_ORDER.map((t) => ({
      t,
      cards: cards.filter((c) => categoryOf(c.typeLine) === t),
    })).filter((g) => g.cards.length);

  // Does a card match the active hover filter? Mana-value buckets mirror the
  // curve (lands excluded, anything ≥7 lands in the "7+" bucket).
  const matchesDeckFilter = (c: PoolCard): boolean => {
    if (!deckFilter) return true;
    if (deckFilter.kind === "type") return categoryOf(c.typeLine) === deckFilter.value;
    if (categoryOf(c.typeLine) === "Lands") return false;
    return Math.min(manaValue(c.manaCost), 7) === deckFilter.value;
  };

  if (deckMissing) {
    return (
      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🃏</div>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, color: "var(--text)" }}>
            Deck not found
          </h1>
          <p style={{ fontStyle: "normal", color: "var(--text-muted)", marginTop: 8 }}>
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
      <div className="deck-theme" style={{ ...theme.vars, background: theme.bg, color: theme.text, minHeight: "100vh" }}>
        {/* slim top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 22px",
            position: "sticky",
            top: 0,
            zIndex: 20,
            background: theme.bg,
            gap: 12,
          }}
        >
          <Link href="/" aria-label="Back to decks" style={{ ...plateBtn, width: 36, height: 36, fontSize: 18, background: "var(--bg3)", color: "var(--text)" }}>
            ‹
          </Link>
          <button onClick={openSettings} style={{ ...plateBtn, width: 36, height: 36, fontSize: 15, background: "var(--bg3)", color: "var(--text)" }} title="Deck settings" aria-label="Deck settings">
            ⚙
          </button>
        </div>

        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "10px 22px 80px" }}>
          {/* title */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28, minWidth: 0 }}>
            {identityPips.length > 0 && <ColorPips colors={identityPips} size={28} />}
            <div style={{ minWidth: 0 }}>
              <h1
                style={{
                  margin: 0,
                  fontFamily: "var(--font-display)",
                  fontSize: "clamp(28px, 5vw, 46px)",
                  fontWeight: 800,
                  letterSpacing: ".01em",
                  textTransform: "uppercase",
                  lineHeight: 1.02,
                  color: "var(--text)",
                }}
              >
                {deck?.commander || deck?.name || "…"}
              </h1>
              {deck && (
                <div style={{ marginTop: 5, fontSize: 14, color: "var(--text-muted)" }}>
                  {deck.name} · {deck.format}
                </div>
              )}
            </div>
          </div>

          {/* mobile pool/deck switcher — sticky segmented control, hidden ≥1024px */}
          <div className="deck-mobile-tabs">
            <button
              type="button"
              aria-pressed={mobileView === "pool"}
              className={mobileView === "pool" ? "is-active" : ""}
              onClick={() => {
                setMobileView("pool");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Pool <span>{poolCards.reduce((s, c) => s + c.quantity, 0)}</span>
            </button>
            <button
              type="button"
              aria-pressed={mobileView === "deck"}
              className={mobileView === "deck" ? "is-active" : ""}
              onClick={() => {
                setMobileView("deck");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Deck <span>{deckCount}</span>
            </button>
          </div>

          <div className="deck-layout" data-mobile-view={mobileView}>
            {/* ── left: YOUR POOL ── */}
            <div className="deck-pool" style={{ gap: 18, minWidth: 0 }}>
              <span className="mn-label" style={{ color: "var(--text-muted)" }}>Your pool</span>
              {/* search panel */}
          <div style={{ background: "var(--bg2)", borderRadius: 16, padding: 18, border: "1px solid var(--line)" }}>
            {/* mode tabs — underline style */}
            <div style={{ display: "flex", gap: 22, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
              {(["ai", "scryfall", "name"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setSearchMode(mode)}
                  style={{
                    padding: "8px 2px 12px",
                    border: "none",
                    cursor: "pointer",
                    background: "transparent",
                    fontFamily: "var(--font-ui)",
                    fontSize: 14,
                    fontWeight: searchMode === mode ? 600 : 500,
                    whiteSpace: "nowrap",
                    color: searchMode === mode ? "var(--t1)" : "var(--t3)",
                    boxShadow: searchMode === mode ? "inset 0 -2px 0 var(--accent)" : "none",
                    transition: "all .12s",
                  }}
                >
                  {mode === "ai" ? "AI" : mode === "scryfall" ? "Scryfall" : "Name"}
                </button>
              ))}
            </div>

            {/* scryfall filters */}
            {searchMode === "scryfall" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 15, marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span className="label-sc" style={{ fontSize: 12, color: "var(--text-dim)", letterSpacing: ".12em" }}>Colors</span>
                  {activeFilterCount > 0 && (
                    <button onClick={clearAllFilters} style={{ background: "transparent", border: "none", color: "var(--gold)", fontSize: 13, fontStyle: "normal", cursor: "pointer" }}>
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
                            background: { w: "#dcd1a4", u: "#4a90c9", b: "#9b85b5", r: "#d96b45", g: "#58a877" }[c.code],
                            color: "#fbfbf8",
                            fontWeight: 700,
                            fontSize: 14,
                            boxShadow: "inset 0 0 0 1px rgba(21,21,26,.08)",
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
                              background: on ? "var(--gold)" : "var(--bg3)",
                              color: on ? "#ffffff" : "var(--text-muted)",
                              boxShadow: on ? "none" : "inset 0 0 0 1px var(--line)",
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
                    <span style={{ fontStyle: "normal", fontSize: 13, color: "var(--text-dim)" }}>Try:</span>
                    {AI_SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => onSuggestion(s)}
                        disabled={searching}
                        style={{
                          fontFamily: "var(--font-body)",
                          fontStyle: "normal",
                          fontSize: 14,
                          padding: "3px 11px",
                          borderRadius: 14,
                          border: "none",
                          cursor: searching ? "default" : "pointer",
                          background: "transparent",
                          color: "var(--gold)",
                          boxShadow: "inset 0 0 0 1px var(--line)",
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
                <span style={{ fontStyle: "normal" }}>
                  {searchResults.length} cards found{truncated ? " (first batch)" : ""}
                  {sources.length > 0 ? ` · via ${sources.join(", ")}` : ""}.
                </span>
                <button onClick={() => setSwipeOpen(true)} style={{ ...goldSearchBtn(false), padding: "6px 14px", fontSize: 14 }}>
                  Review again
                </button>
              </div>
            )}
          </div>

          {/* pool actions */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", color: "var(--text)" }}>
              {poolCards.reduce((s, c) => s + c.quantity, 0)} cards
            </span>
            <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <HeaderAction onClick={() => startReview()} disabled={poolCards.length === 0} title="Swipe through the pool — right promotes to the deck, left removes from the pool">
                ✓ Review pool
              </HeaderAction>
              <HeaderAction gold onClick={() => setJudgeOpen(true)} disabled={pool.length === 0} title="AI judge — review the pool">
                ✨ Judge
              </HeaderAction>
              <HeaderAction onClick={() => setCombosOpen(true)} disabled={pool.length === 0} title="Find combos in the pool">
                ♾ Combos
              </HeaderAction>
              <HeaderAction onClick={() => setTool("lands")} title="Bulk-add lands & staples">
                🌲 Lands
              </HeaderAction>
            </div>
          </div>
          <div>
            {poolCards.length === 0 ? (
              <div style={{ padding: "44px 20px", textAlign: "center", color: "var(--text-muted)", borderRadius: 14, border: "1px dashed var(--line)" }}>
                {pool.length === 0
                  ? "No cards yet — search above to begin filling the pool."
                  : "Pool is empty — every card has been promoted to the deck."}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
                {poolCards.map((card) => (
                  <PoolImageCard
                    key={card.dbId}
                    card={card}
                    warning={warningOf(card)}
                    onOpen={() => startReview(card)}
                    onMove={() => moveTo(card.dbId, "deck")}
                    onRemove={() => removeCard(card.dbId)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── right: YOUR DECK rail ── */}
        <aside className="deck-sidebar" style={{ gap: 16 }}>
          {/* play guide (notes) */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span className="mn-label" style={{ color: "var(--text-muted)" }}>Play guide</span>
              <span className="mn-label" style={{ fontSize: 10, color: noteStatus === "saving" ? "var(--text-dim)" : "var(--accent)" }}>
                {noteStatus === "saving" ? "Saving…" : noteStatus === "saved" ? "Saved" : ""}
              </span>
            </div>
            <textarea
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              onBlur={() => {
                if (noteTimer.current) clearTimeout(noteTimer.current);
                saveNotes(notes);
              }}
              placeholder="How does this deck play? Mulligans, key lines, win routes…"
              rows={4}
              style={{
                width: "100%",
                border: "none",
                outline: "none",
                resize: "vertical",
                background: "transparent",
                fontFamily: "var(--font-body)",
                fontSize: 14.5,
                lineHeight: 1.55,
                color: "var(--text)",
                minHeight: 76,
                padding: 0,
              }}
            />
          </div>

          {/* your deck header + review + buy */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", color: "var(--text)" }}>
              Your deck
            </span>
            <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => startDeckReview()}
                disabled={deckCards.length === 0}
                title="Swipe through the deck — right keeps, left removes from the deck"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 13px",
                  borderRadius: 999,
                  border: "1px solid var(--line)",
                  cursor: deckCards.length ? "pointer" : "default",
                  background: "var(--bg3)",
                  color: "var(--text)",
                  fontWeight: 600,
                  fontSize: 13.5,
                  opacity: deckCards.length ? 1 : 0.5,
                }}
              >
                ✓ Review
              </button>
              <button
                onClick={() => setOrderOpen(true)}
                disabled={deckCards.length === 0}
                title="Order the deck on CardTrader"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 15px",
                  borderRadius: 999,
                  border: "none",
                  cursor: deckCards.length ? "pointer" : "default",
                  background: "var(--accent)",
                  color: "var(--accent-ink)",
                  fontWeight: 700,
                  fontSize: 13.5,
                  opacity: deckCards.length ? 1 : 0.5,
                }}
              >
                🛒 Buy
              </button>
            </div>
          </div>

          {/* mana curve + dot-grid meter — hovering a bar or dot filters the
              decklist below to that mana value / card type */}
          <div style={{ display: "flex", gap: 16, alignItems: "flex-end", justifyContent: "space-between" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ManaCurve
                curve={stats.curve}
                accent="rgba(255,255,255,.9)"
                onHoverBar={(i) => setDeckFilter(i === null ? null : { kind: "mv", value: i })}
              />
            </div>
            <DotGrid
              types={deckStats(deckCards).types}
              count={deckCount}
              target={target}
              empty={theme.dotEmpty}
              onHoverType={(name) => setDeckFilter(name === null ? null : { kind: "type", value: name })}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13, color: "var(--text-muted)", marginTop: -6 }}>
            <span>
              <b style={{ color: "var(--text)" }}>{deckCount}</b> / {target}
            </span>
            <span>
              avg MV <b style={{ color: "var(--text)" }}>{stats.avgMv.toFixed(1)}</b>
            </span>
            <button onClick={() => setHandSimOpen(true)} title="Draw sample opening hands" style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 13, padding: 0 }}>
              🎲 Hand
            </button>
          </div>
          {warningCount > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--accent)" }}>
              ⚠ {warningCount} card{warningCount === 1 ? "" : "s"} with legality warnings — hover the ⚠ on a card.
            </div>
          )}

          {/* grouped decklist */}
          {deckCards.length === 0 ? (
            <div style={{ padding: "26px 16px", textAlign: "center", color: "var(--text-muted)", border: "1px dashed var(--line)", borderRadius: 12, fontSize: 13.5 }}>
              Nothing here yet — promote cards from the pool with ⤴, or use “Review pool”.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {groupedFor(deckCards)
                .map((g) => ({ t: g.t, cards: g.cards.filter(matchesDeckFilter) }))
                .filter((g) => g.cards.length)
                .map((g) => (
                  <div key={g.t}>
                    <div className="mn-label" style={{ color: "var(--text-muted)", marginBottom: 8, display: "flex", gap: 8, alignItems: "baseline" }}>
                      {g.t}
                      <span style={{ color: "var(--text-dim)" }}>{g.cards.reduce((s, c) => s + c.quantity, 0)}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      {g.cards.map((c) => (
                        <DeckRailRow
                          key={c.dbId}
                          card={c}
                          warning={warningOf(c)}
                          onOpen={() => startDeckReview(c)}
                          onMove={() => moveTo(c.dbId, "pool")}
                          onRemove={() => removeCard(c.dbId)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </aside>
        </div>
        </div>
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
          <h2 style={{ margin: "0 0 16px", fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, color: "var(--frame-ink)" }}>
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
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
            <div className="label-sc" style={{ fontSize: 11.5, color: "var(--t3)", letterSpacing: ".1em", marginBottom: 10 }}>
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

      {/* review-pool swipe modal — triage: right promotes to the deck, left
          drops the card from the pool. Loads the pool on close so the fire-and-
          forget moves/removes are reflected once. */}
      {reviewCards && reviewCards.length > 0 && (
        <SwipeModal
          variant="review"
          cards={reviewCards}
          query="Building your deck"
          startIndex={reviewStart}
          onAdd={(card) => {
            const pc = reviewCards.find((c) => c.id === card.id);
            if (pc) moveCard(deckId, pc.dbId, "deck");
          }}
          onPass={(card) => {
            const pc = reviewCards.find((c) => c.id === card.id);
            if (pc) fetch(`/api/decks/${deckId}/cards/${pc.dbId}`, { method: "DELETE" });
          }}
          onInfo={setPreview}
          onClose={() => {
            setReviewCards(null);
            loadPool();
          }}
        />
      )}

      {/* deck review swipe modal — triage the decklist: right keeps the card,
          left discards it from the deck entirely (not returned to the pool). */}
      {deckReviewCards && deckReviewCards.length > 0 && (
        <SwipeModal
          variant="deck-review"
          cards={deckReviewCards}
          query="Reviewing your deck"
          startIndex={deckReviewStart}
          onAdd={() => {
            /* keep — the card stays in the deck, nothing to do */
          }}
          onPass={(card) => {
            const dc = deckReviewCards.find((c) => c.id === card.id);
            if (dc) fetch(`/api/decks/${deckId}/cards/${dc.dbId}`, { method: "DELETE" });
          }}
          onInfo={setPreview}
          onClose={() => {
            setDeckReviewCards(null);
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

      {/* CardTrader order */}
      {orderOpen && <OrderModal cards={deckCards} onClose={() => setOrderOpen(false)} />}

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
          style={{ position: "fixed", inset: 0, background: "rgba(21,21,26,.4)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 65, animation: "sp-fade .15s ease" }}
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
        padding: "8px 16px",
        borderRadius: 999,
        border: gold ? "none" : "1px solid var(--line)",
        cursor: disabled ? "default" : "pointer",
        fontFamily: "var(--font-ui)",
        fontSize: 13.5,
        fontWeight: gold ? 600 : 500,
        whiteSpace: "nowrap",
        background: gold ? "var(--accent)" : "var(--bg2)",
        color: gold ? "var(--accent-ink)" : "var(--t2)",
        opacity: disabled ? 0.45 : 1,
        transition: "all .12s",
      }}
    >
      {children}
    </button>
  );
}

function goldSearchBtn(busy: boolean): React.CSSProperties {
  return {
    padding: "0 26px",
    borderRadius: 999,
    border: "none",
    cursor: busy ? "wait" : "pointer",
    background: "var(--accent)",
    color: "var(--accent-ink)",
    fontFamily: "var(--font-ui)",
    fontWeight: 700,
    fontSize: 14.5,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
    opacity: busy ? 0.7 : 1,
  };
}

/* ── identity → deck-view theme ─────────────────────────────────────────────
   The deck/pool view background is driven by the deck's colour identity
   (mono-blue → blue, etc). Returns CSS-variable overrides applied on a wrapper
   so every existing component reskins through the same tokens. */
type IdentityTheme = {
  bg: string;
  text: string;
  dotEmpty: string;
  vars: React.CSSProperties;
};

const IDENTITY_BG: Record<string, { bg: string; light?: boolean }> = {
  W: { bg: "#d9cda2", light: true },
  U: { bg: "#3f3ce6" },
  B: { bg: "#191921" },
  R: { bg: "#b22f33" },
  G: { bg: "#2b7a48" },
  multi: { bg: "#8a6f2c" },
  c: { bg: "#45464f" },
};

function getIdentityTheme(identity: string | null | undefined): IdentityTheme {
  const set = new Set((identity ?? "").toUpperCase().replace(/[^WUBRG]/g, "").split(""));
  const key = set.size === 0 ? "c" : set.size === 1 ? [...set][0] : "multi";
  const { bg, light } = IDENTITY_BG[key] ?? IDENTITY_BG.c;

  if (light) {
    const text = "#211d12";
    return {
      bg,
      text,
      dotEmpty: "rgba(33,29,18,.16)",
      vars: {
        ["--bg" as string]: bg,
        "--bg2": bg,
        "--bg3": "rgba(33,29,18,.07)",
        "--surface": "#ffffff",
        "--surface2": "rgba(33,29,18,.05)",
        "--text": text,
        "--t1": text,
        "--text-muted": "rgba(33,29,18,.7)",
        "--t2": "rgba(33,29,18,.7)",
        "--text-dim": "rgba(33,29,18,.46)",
        "--t3": "rgba(33,29,18,.46)",
        "--accent": "#2742d6",
        "--accent-hover": "#1d35b8",
        "--gold": "#2742d6",
        "--gold-bright": "#1d35b8",
        "--accent-ink": "#ffffff",
        "--line": "rgba(33,29,18,.16)",
        "--border": "rgba(33,29,18,.16)",
      } as React.CSSProperties,
    };
  }

  return {
    bg,
    text: "#ffffff",
    dotEmpty: "rgba(255,255,255,.18)",
    vars: {
      ["--bg" as string]: bg,
      "--bg2": bg,
      "--bg3": "rgba(255,255,255,.14)",
      "--surface": "rgba(255,255,255,.08)",
      "--surface2": "rgba(255,255,255,.06)",
      "--text": "#ffffff",
      "--t1": "#ffffff",
      "--text-muted": "rgba(255,255,255,.74)",
      "--t2": "rgba(255,255,255,.74)",
      "--text-dim": "rgba(255,255,255,.52)",
      "--t3": "rgba(255,255,255,.52)",
      "--accent": "#ffd23f",
      "--accent-hover": "#ffdf6b",
      "--gold": "#ffd23f",
      "--gold-bright": "#ffdf6b",
      "--accent-ink": "#2a2205",
      "--line": "rgba(255,255,255,.18)",
      "--border": "rgba(255,255,255,.18)",
    } as React.CSSProperties,
  };
}

/* Card-type colours for the deck dot-grid — one hue per category, distinct on
   both light and dark identity backgrounds. */
const TYPE_DOT_COLORS: Record<string, string> = {
  Creatures: "#52a675",
  Instants: "#4a90c9",
  Sorceries: "#a86fc4",
  Artifacts: "#9aa6b2",
  Enchantments: "#e0b341",
  Planeswalkers: "#d9743f",
  Lands: "#b08d57",
  Other: "#c2655a",
};

/* Dot-grid deck-size meter — one dot per card coloured by its type, then empty
   slots up to the format's target so you see the deck's composition at a glance. */
function DotGrid({
  types,
  count,
  target,
  empty,
  onHoverType,
}: {
  types: { name: string; n: number }[];
  count: number;
  target: number;
  empty: string;
  /** Fires with a type name on hover of a filled dot, null on leave. */
  onHoverType?: (name: string | null) => void;
}) {
  // Expand the type breakdown (already in TYPE_ORDER) into one entry per card,
  // capped at the deck size so colours never outrun the filled dots.
  const colored: { color: string; name: string }[] = [];
  for (const t of types) {
    const color = TYPE_DOT_COLORS[t.name] ?? TYPE_DOT_COLORS.Other;
    for (let k = 0; k < t.n && colored.length < count; k++) colored.push({ color, name: t.name });
  }
  const dots = Math.max(target, count);
  const [hover, setHover] = useState<string | null>(null);
  const enter = (name?: string) => {
    if (!name || !onHoverType) return;
    setHover(name);
    onHoverType(name);
  };
  const leave = () => {
    if (!onHoverType) return;
    setHover(null);
    onHoverType(null);
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 5, maxWidth: 150 }}>
      {Array.from({ length: dots }).map((_, i) => {
        const c = colored[i];
        return (
          <span
            key={i}
            title={c?.name}
            onMouseEnter={() => enter(c?.name)}
            onMouseLeave={leave}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: c ? c.color : empty,
              cursor: onHoverType && c ? "pointer" : "default",
              opacity: hover === null || hover === c?.name ? 1 : 0.3,
              transition: "opacity .12s",
            }}
          />
        );
      })}
    </div>
  );
}

/* Pool tile — full card scan, with hover actions. Tapping opens review. */
function PoolImageCard({
  card,
  warning,
  onOpen,
  onMove,
  onRemove,
}: {
  card: PoolCard;
  warning?: string;
  onOpen: () => void;
  onMove: () => void;
  onRemove: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      style={{
        position: "relative",
        borderRadius: "4.8%/3.5%",
        overflow: "hidden",
        cursor: "pointer",
        aspectRatio: "5 / 7",
        background: "rgba(0,0,0,.25)",
        boxShadow: hover ? "0 14px 30px -10px rgba(0,0,0,.6)" : "0 4px 12px -4px rgba(0,0,0,.45)",
        transform: hover ? "translateY(-3px)" : "none",
        transition: "transform .16s ease, box-shadow .16s ease",
      }}
    >
      {card.imageUri ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.imageUri} alt={card.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      ) : (
        <CardArt name={card.name} src={card.imageUri || undefined} radius={0} style={{ position: "absolute", inset: 0 }} />
      )}
      {card.quantity > 1 && (
        <span style={{ position: "absolute", bottom: 8, left: 8, background: "rgba(0,0,0,.72)", color: "#fff", fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999 }}>
          ×{card.quantity}
        </span>
      )}
      {warning && (
        <span title={warning} style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,.72)", color: "#ffd23f", fontSize: 13, width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          ⚠
        </span>
      )}
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6, opacity: hover ? 1 : 0, transition: "opacity .15s" }}>
        <button onClick={(e) => { e.stopPropagation(); onMove(); }} title="Move to deck" aria-label="Move to deck" style={poolIconBtn}>
          ⤴
        </button>
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove" aria-label="Remove" style={poolIconBtn}>
          ✕
        </button>
      </div>
    </div>
  );
}

const poolIconBtn: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 7,
  border: "none",
  cursor: "pointer",
  background: "rgba(10,8,6,.7)",
  color: "#fff",
  fontSize: 13,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backdropFilter: "blur(4px)",
};

/* Deck-rail row — white pill: thumbnail + name + type + mana pips. */
function DeckRailRow({
  card,
  warning,
  onOpen,
  onMove,
  onRemove,
}: {
  card: PoolCard;
  warning?: string;
  onOpen: () => void;
  onMove: () => void;
  onRemove: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      style={{
        display: "grid",
        gridTemplateColumns: "30px 1fr auto",
        alignItems: "center",
        gap: 10,
        padding: "7px 11px 7px 8px",
        borderRadius: 10,
        cursor: "pointer",
        background: "#ffffff",
        boxShadow: hover ? "0 6px 16px -6px rgba(0,0,0,.4)" : "0 1px 2px rgba(0,0,0,.18)",
        transition: "box-shadow .14s ease",
      }}
    >
      <div style={{ position: "relative", width: 30, height: 30, borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
        <CardArt name={card.name} src={card.imageUri || undefined} radius={0} style={{ position: "absolute", inset: 0 }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {card.quantity > 1 && <span style={{ fontSize: 12, fontWeight: 700, color: "#5c5c64" }}>{card.quantity}×</span>}
          <span style={{ fontSize: 14, fontWeight: 600, color: "#15151a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.name}</span>
          {warning && <span title={warning} style={{ color: "#c2402a", fontSize: 12 }}>⚠</span>}
        </div>
        <div style={{ fontSize: 11.5, color: "#8a8a92", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.typeLine}</div>
      </div>
      {hover ? (
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={(e) => { e.stopPropagation(); onMove(); }} title="Move to pool" aria-label="Move to pool" style={railIconBtn}>↓</button>
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove" aria-label="Remove" style={railIconBtn}>✕</button>
        </div>
      ) : (
        <ManaCost cost={card.manaCost} size={15} />
      )}
    </div>
  );
}

const railIconBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  background: "#f1f1ec",
  color: "#5c5c64",
  fontSize: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
