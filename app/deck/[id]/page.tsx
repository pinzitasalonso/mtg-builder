"use client";

import { use, useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Logo from "@/components/Logo";
import CommanderInput from "@/components/CommanderInput";
import SwipeModal from "@/components/SwipeModal";
import ToolSheet, { Tool } from "@/components/deck/ToolSheet";
import JudgeModal from "@/components/deck/JudgeModal";
import HandSimModal from "@/components/deck/HandSimModal";
import DeckChat from "@/components/deck/DeckChat";
import OrderModal from "@/components/deck/OrderModal";
import { ModalShell, Field, ErrorNote, paperInput, ghostBtn, goldBtn, toolBtn } from "@/components/deck/ui";
import { OutCard, resolveNamed } from "@/lib/scryfall";
import { PoolEntry, Board, poolByName, resolveAndAdd, moveCard, deleteCard } from "@/lib/pool-client";
import { applyPending, flushQueue, pendingFor } from "@/lib/offline-queue";
import { cardWarnings } from "@/lib/legality";
import { getIdentityTheme } from "@/lib/identity-theme";
import { fetchCollection } from "@/lib/collection-client";
import { track } from "@/lib/track";
import {
  CardArt,
  ManaCost,
  ColorPips,
  ClassicCard,
  ManaCurve,
  deckStats,
  categoryOf,
  colorsOf,
  landProducedColors,
  manaValue,
  deckTarget,
  TYPE_ORDER,
  COLOR_NAME,
  MANA,
} from "@/components/mtg";

// Category accent colours for the composition matrix (matches the design).
const CAT_COLOR: Record<string, string> = {
  Creatures: "#f5c425",
  Instants: "#7fb8ff",
  Sorceries: "#b5d6ff",
  Artifacts: "#d7dbe2",
  Enchantments: "#e3b3ff",
  Planeswalkers: "#ffcf8a",
  Lands: "#d9bd8a",
  Other: "#cfd3da",
};

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
  // The URL segment is the deck's unguessable public id; it's what every
  // /api/decks/<id>/… call resolves against.
  const deckId = id;
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

  // header tools dropdown + play-guide popover
  const [toolsOpen, setToolsOpen] = useState(false);
  // Fixed viewport coords for the tools menu, measured from the button so it
  // opens right under it and never runs off-screen on mobile.
  const [toolsPos, setToolsPos] = useState<{ top: number; left: number } | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  // Count of offline review decisions waiting to sync (drives the banner).
  const [pendingSync, setPendingSync] = useState(0);
  const [copied, setCopied] = useState<"" | "link" | "list">("");
  // deck-panel sort: by type (grouped), by cost (mv), or A–Z
  const [deckSort, setDeckSort] = useState<"type" | "cost" | "name">("type");
  // The AI chat widens the pool, but only once you engage with it (focus the
  // input or start a conversation) — not just because AI is the default mode.
  const [aiEngaged, setAiEngaged] = useState(false);

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

  // sample-hand simulator
  const [handSimOpen, setHandSimOpen] = useState(false);

  // "Order on CardTrader" — runs in <OrderModal> while open
  const [orderOpen, setOrderOpen] = useState(false);

  // commander's color identity (resolved from Scryfall) for legality checks
  const [cmdrIdentity, setCmdrIdentity] = useState<string | null>(null);

  // The signed-in user's owned-card collection (lowercased names). Drives the
  // "owned" badges on pool/deck cards and grounds the AI in what they have.
  const [ownedNames, setOwnedNames] = useState<string[]>([]);
  const ownedSet = new Set(ownedNames.map((n) => n.toLowerCase()));

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
    let res: Response;
    try {
      res = await fetch(`/api/decks/${deckId}/cards`);
    } catch {
      return; // offline with no cached response — keep current state
    }
    if (!res.ok) return;
    const data = await res.json();
    const mapped: PoolCard[] = data.map((c: { id: number; scryfallId: string; name: string; imageUri: string; manaCost: string | null; typeLine: string | null; oracleText: string | null; quantity?: number; board?: string; role?: string | null; colorIdentity?: string | null; legalities?: string | null }) => {
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
    });
    // Overlay any not-yet-synced offline review decisions for this deck.
    setPool(applyPending(deckId, mapped));
    setPendingSync(pendingFor(deckId).length);
  }, [deckId]);

  useEffect(() => {
    track("visit");
    track("deck_viewed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replay any offline review decisions when the connection returns.
  useEffect(() => {
    const sync = async () => {
      await flushQueue();
      await loadPool();
    };
    window.addEventListener("online", sync);
    if (typeof navigator !== "undefined" && navigator.onLine && pendingFor(deckId).length) sync();
    return () => window.removeEventListener("online", sync);
  }, [deckId, loadPool]);

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
    fetchCollection().then((c) => setOwnedNames(c.cards.map((card) => card.name)));
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
      track("card_search");
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
          // Hide cards already in the deck — by id and by name — so the swipe
          // never offers a duplicate.
          const poolIds = new Set(pool.map((c) => c.id));
          const poolNames = new Set(pool.map((c) => c.name.toLowerCase()));
          const all = data.cards as SearchCard[];
          const filtered = all.filter((c) => !poolIds.has(c.id) && !poolNames.has(c.name.toLowerCase()));
          const hidden = all.length - filtered.length;
          setSearchResults(filtered);
          setGeneratedQuery(data.query);
          setTruncated(Boolean(data.truncated));
          setSources(Array.isArray(data.sources) ? data.sources : []);
          if (filtered.length > 0) setSwipeOpen(true);
          else if (hidden > 0) setSearchError(`Every match is already in your deck.`);
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

  // Switching modes clears the inputs and any errors/results — the three modes
  // speak different languages (AI prose, Scryfall syntax, exact names), so
  // carrying text across them mostly produces errors (e.g. a prompt run as
  // Scryfall syntax 404s).
  function switchMode(mode: SearchMode) {
    if (mode === searchMode) return;
    setSearchMode(mode);
    setQuery("");
    setNameInput("");
    setSearchError("");
    setNameError("");
    setSearchResults([]);
    setGeneratedQuery("");
    setSources([]);
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
    const r = await resolveAndAdd(deckId, name, 1, poolByName(pool), { skipIfExists: true });
    if (r === "added") {
      setNameInput("");
      await loadPool();
    } else if (r === "exists") {
      setNameError(`"${name}" is already in your deck.`);
    } else {
      setNameError(r === "notfound" ? "Card not found — check the spelling." : "Couldn't add that card.");
    }
    setNameAdding(false);
  }

  async function removeCard(dbId: number) {
    await deleteCard(deckId, dbId);
    loadPool();
  }

  function openSettings() {
    if (!deck) return;
    setEdit({ name: deck.name, format: deck.format, commander: deck.commander || "" });
    setSettingsOpen(true);
  }

  function flash(which: "link" | "list") {
    setCopied(which);
    setTimeout(() => setCopied(""), 1600);
  }
  function copyLink() {
    navigator.clipboard?.writeText(window.location.href).then(() => flash("link")).catch(() => {});
  }
  function copyDecklist() {
    const lines: string[] = [];
    if (deck?.commander) lines.push(`1 ${deck.commander}`);
    for (const c of deckCards) if (c.name !== deck?.commander) lines.push(`${c.quantity} ${c.name}`);
    navigator.clipboard?.writeText(lines.join("\n")).then(() => flash("list")).catch(() => {});
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
      // Pick up the (possibly new) auto-included commander card.
      loadPool();
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

  // The auto-included commander (commander decks) can't be removed or reviewed out.
  const isCommander = (c: PoolCard) =>
    (deck?.format ?? "").toLowerCase() === "commander" &&
    !!deck?.commander &&
    c.name.trim().toLowerCase() === deck.commander.trim().toLowerCase();

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
    // The commander can't be discarded, so it's never part of the review.
    const ordered = groupedFor(deckCards).flatMap((g) => g.cards).filter((c) => !isCommander(c));
    if (ordered.length === 0) return;
    const idx = startCard ? ordered.findIndex((c) => c.dbId === startCard.dbId) : 0;
    setDeckReviewStart(idx < 0 ? 0 : idx);
    setDeckReviewCards(ordered);
  }

  // Filtered deck review — launched by clicking a mana-curve bar or a type dot.
  // Orders matching cards the same way the rail does so swiping and reading feel consistent.
  function startDeckReviewOf(subset: PoolCard[]) {
    if (subset.length === 0) return;
    setSettingsOpen(false);
    const orderedAll = groupedFor(deckCards).flatMap((g) => g.cards);
    const ids = new Set(subset.map((c) => c.dbId));
    const ordered = orderedAll.filter((c) => ids.has(c.dbId) && !isCommander(c));
    if (ordered.length === 0) return;
    setDeckReviewStart(0);
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
        {/* top nav — logo + tools / share / buy list / edit deck */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            rowGap: 8,
            padding: "14px clamp(16px,4vw,52px)",
            position: "sticky",
            top: 0,
            zIndex: 30,
            background: "rgba(14,11,24,.72)",
            backdropFilter: "blur(14px)",
            borderBottom: "1px solid var(--w-line)",
            gap: 12,
          }}
        >
          <Link href="/" aria-label="Spellpool home" style={{ textDecoration: "none" }}>
            <Logo size={18} />
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}>
            <div>
              <button
                className="id-ghost"
                style={{ padding: "9px 15px" }}
                onClick={(e) => {
                  if (toolsOpen) { setToolsOpen(false); return; }
                  const r = e.currentTarget.getBoundingClientRect();
                  const width = 210;
                  const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
                  setToolsPos({ top: r.bottom + 8, left });
                  setToolsOpen(true);
                }}
              >
                Tools ▾
              </button>
              {toolsOpen && (
                <>
                  <div onClick={() => setToolsOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                  <div
                    className="id-card"
                    style={{ position: "fixed", top: toolsPos?.top ?? 0, left: toolsPos?.left ?? 0, zIndex: 41, width: 210, maxWidth: "calc(100vw - 16px)", padding: 6, display: "flex", flexDirection: "column", gap: 2 }}
                  >
                    {[
                      { label: "✨ AI judge", on: () => setJudgeOpen(true), disabled: pool.length === 0 },
                      { label: "🎲 Sample hand", on: () => setHandSimOpen(true), disabled: deckCards.length === 0 },
                      { label: "📝 Play guide", on: () => setNotesOpen((v) => !v) },
                      { label: "🌲 Add lands & staples", on: () => setTool("lands") },
                      { label: "⬆ Export / import", on: () => setTool("export") },
                    ].map((it) => (
                      <button
                        key={it.label}
                        onClick={() => { if (!it.disabled) { it.on(); setToolsOpen(false); } }}
                        disabled={it.disabled}
                        style={{ textAlign: "left", padding: "9px 11px", borderRadius: 9, border: "none", background: "transparent", color: "var(--ink)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 600, cursor: it.disabled ? "default" : "pointer", opacity: it.disabled ? 0.45 : 1 }}
                      >
                        {it.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button className="id-ghost" style={{ padding: "9px 15px" }} onClick={copyLink}>
              {copied === "link" ? "Copied!" : "Share"}
            </button>
            <button className="id-ghost" style={{ padding: "9px 15px" }} onClick={() => setOrderOpen(true)} disabled={deckCards.length === 0}>
              Buy list
            </button>
            <button className="id-btn" style={{ padding: "10px 18px" }} onClick={openSettings}>
              Edit deck
            </button>
          </div>
        </header>

        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "12px clamp(16px,4vw,52px) 80px" }}>
          {/* breadcrumb */}
          <Link href="/" style={{ display: "inline-block", color: "var(--w-3)", fontSize: 13, textDecoration: "none", marginBottom: 6 }}>
            ← All decks
          </Link>

          {pendingSync > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                margin: "8px 0 0",
                padding: "8px 14px",
                borderRadius: 999,
                background: "var(--w-fill)",
                border: "1px solid var(--w-line-2)",
                fontSize: 13,
                color: "var(--w-1)",
                width: "fit-content",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gold)", flex: "none" }} />
              {pendingSync} review change{pendingSync === 1 ? "" : "s"} will sync when you&apos;re back online
            </div>
          )}

          {/* HERO — copy + commander card with progress badge */}
          <div className="id-hero-grid" style={{ alignItems: "center", padding: "clamp(14px,3vw,32px) 0 clamp(22px,3vw,40px)" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 16 }}>
                {identityPips.length > 0 && <ColorPips colors={identityPips} size={22} />}
                <span className="id-mono" style={{ fontSize: 12.5, color: "var(--w-2)", textTransform: "capitalize" }}>
                  {deck?.format}{identityPips.length ? ` · ${identityPips.map((c) => COLOR_NAME[c]).join(" / ")}` : ""}
                </span>
              </div>
              <h1 className="id-display" style={{ margin: "0 0 12px", fontSize: "clamp(40px, 7vw, 84px)", color: "var(--w-1)" }}>
                {deck?.name || "…"}
              </h1>
              {deck?.commander && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24, fontSize: 14, color: "var(--w-2)" }}>
                  Helmed by <b style={{ color: "var(--w-1)" }}>{deck.commander}</b>
                </div>
              )}
              <div style={{ display: "flex", gap: 13, flexWrap: "wrap" }}>
                <button className="id-btn" style={{ padding: "14px 24px", fontSize: 15.5 }} onClick={() => setHandSimOpen(true)} disabled={deckCards.length === 0}>
                  ▶ Playtest hand
                </button>
                <button className="id-ghost" style={{ padding: "13px 20px" }} onClick={copyDecklist} disabled={deckCards.length === 0}>
                  {copied === "list" ? "Copied!" : "Copy decklist"}
                </button>
              </div>
            </div>

            {/* commander showcase + progress badge */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ position: "relative", width: "min(280px, 78vw)" }}>
                <div style={{ aspectRatio: "5 / 7", borderRadius: 16, overflow: "hidden", boxShadow: "0 30px 60px -24px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.1)" }}>
                  {(deck?.commander || deck?.name) && (
                    <CardArt
                      key={deck?.commander || deck?.name}
                      name={deck?.commander || deck?.name || ""}
                      colors={identityPips.length ? identityPips : ["C"]}
                      version="normal"
                      radius={16}
                      style={{ width: "100%", height: "100%" }}
                    />
                  )}
                </div>
                <div className="id-card" style={{ position: "absolute", bottom: -18, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 11, padding: "10px 16px", whiteSpace: "nowrap" }}>
                  <span className="id-display" style={{ fontSize: 26, color: "var(--ink)" }}>
                    {deckCount}<span style={{ color: "#b3aebd", fontSize: 18 }}>/{target}</span>
                  </span>
                  <div style={{ width: 64, height: 6, borderRadius: 4, background: "#ece9f1", overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(1, deckCount / Math.max(1, target)) * 100}%`, height: "100%", background: "var(--gold)", borderRadius: 4 }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* STAT STRIP — mana curve · composition · color identity */}
          {statsOnDeck && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "28px 0", padding: "24px 0", margin: "0 0 8px", borderTop: "1px solid var(--w-line)", borderBottom: "1px solid var(--w-line)" }}>
              <div style={{ padding: "0 clamp(0px,2vw,28px) 0 0", flex: 1, minWidth: 220 }}>
                <div className="id-label" style={{ color: "var(--w-3)", marginBottom: 14 }}>Mana curve</div>
                <ManaCurve
                  curve={stats.curve}
                  accent="var(--gold)"
                  onHoverBar={(i) => setDeckFilter(i === null ? null : { kind: "mv", value: i })}
                  onClickBar={(i) => startDeckReviewOf(deckCards.filter((c) => categoryOf(c.typeLine) !== "Lands" && Math.min(manaValue(c.manaCost), 7) === i))}
                />
              </div>
              <div style={{ width: 1, background: "var(--w-line)", alignSelf: "stretch" }} />
              <div style={{ padding: "0 clamp(18px,2.4vw,32px)", flex: 1, minWidth: 220 }}>
                <div className="id-label" style={{ color: "var(--w-3)", marginBottom: 14 }}>Composition · {deckCards.length} cards</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                  {deckStats(deckCards).types.flatMap((t) =>
                    Array.from({ length: t.n }).map((_, i) => (
                      <span key={t.name + i} style={{ width: 9, height: 9, borderRadius: 2.5, background: CAT_COLOR[t.name] || "#ccc" }} />
                    ))
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 14px" }}>
                  {deckStats(deckCards).types.map((t) => (
                    <span key={t.name} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--w-2)" }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2.5, background: CAT_COLOR[t.name] || "#ccc" }} />
                      {t.name} <b style={{ color: "var(--w-1)", fontFamily: "var(--font-mono)" }}>{t.n}</b>
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ width: 1, background: "var(--w-line)", alignSelf: "stretch" }} />
              <div style={{ padding: "0 0 0 clamp(18px,2.4vw,32px)", flex: 1, minWidth: 200 }}>
                <div className="id-label" style={{ color: "var(--w-3)", marginBottom: 10 }}>Color identity</div>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
                  {identityPips.length > 0 && <ColorPips colors={identityPips} size={20} />}
                  <span className="id-display" style={{ fontSize: 16, color: "var(--w-1)", lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: 1 }}>
                    {identityPips.length ? identityPips.map((c) => COLOR_NAME[c]).join(" · ") : "Colorless"}
                  </span>
                </div>
                {(() => {
                  // Colour requirements (spell pips) vs the lands that can
                  // produce each colour, from what each land actually adds.
                  // Cards are not either/or: a spell//land MDFC counts on both
                  // sides.
                  const spell: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
                  const land: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
                  const identity = identityPips.filter((c) => "WUBRG".includes(c));
                  for (const c of deckCards) {
                    const qty = c.quantity > 0 ? c.quantity : 1;
                    if (categoryOf(c.typeLine) === "Lands") {
                      for (const col of landProducedColors(c.typeLine, c.oracleText, c.colorIdentity, identity))
                        if (land[col] != null) land[col] += qty;
                    }
                    for (const col of colorsOf(c.manaCost)) if (spell[col] != null) spell[col] += qty;
                  }
                  const order = (["W", "U", "B", "R", "G"] as const).filter((c) => spell[c] > 0 || land[c] > 0);
                  if (order.length === 0) return null;
                  const max = Math.max(1, ...order.flatMap((c) => [spell[c], land[c]]));
                  return (
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
                  );
                })()}
                <p style={{ fontSize: 12.5, color: "var(--w-2)", margin: 0, lineHeight: 1.45 }}>
                  Avg. mana value <b style={{ color: "var(--w-1)", fontFamily: "var(--font-mono)" }}>{stats.avgMv.toFixed(1)}</b> · land sources reflect what each land can produce; fetches and any-colour lands count toward your identity.
                </p>
              </div>
            </div>
          )}

          {/* play guide — revealed from the Tools menu */}
          {notesOpen && (
            <div className="id-panel" style={{ padding: 16, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span className="id-label" style={{ color: "var(--w-2)" }}>Play guide</span>
                <span className="id-label" style={{ fontSize: 10, color: noteStatus === "saving" ? "var(--w-3)" : "var(--gold)" }}>
                  {noteStatus === "saving" ? "Saving…" : noteStatus === "saved" ? "Saved" : ""}
                </span>
              </div>
              <textarea
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                onBlur={() => { if (noteTimer.current) clearTimeout(noteTimer.current); saveNotes(notes); }}
                placeholder="How does this deck play? Mulligans, key lines, win routes…"
                rows={4}
                style={{ width: "100%", border: "none", outline: "none", resize: "vertical", background: "transparent", fontFamily: "var(--font-body)", fontSize: 14.5, lineHeight: 1.55, color: "var(--text)", minHeight: 76, padding: 0 }}
              />
            </div>
          )}

          {/* mobile pool/deck switcher — sticky segmented control, hidden ≥1024px */}
          <div className="deck-mobile-tabs">
            <button
              type="button"
              aria-pressed={mobileView === "pool"}
              className={mobileView === "pool" ? "is-active" : ""}
              onClick={() => setMobileView("pool")}
            >
              Pool <span>{poolCards.reduce((s, c) => s + c.quantity, 0)}</span>
            </button>
            <button
              type="button"
              aria-pressed={mobileView === "deck"}
              className={mobileView === "deck" ? "is-active" : ""}
              onClick={() => setMobileView("deck")}
            >
              Deck <span>{deckCount}</span>
            </button>
          </div>

          <div className="id-workspace" data-mobile-view={mobileView} data-ai={searchMode === "ai" && aiEngaged ? "true" : undefined}>
            {/* ── POOL ── */}
            <aside className="id-panel id-pool id-poolcol" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                  <span className="id-display" style={{ fontSize: 24, color: "var(--w-1)" }}>Pool</span>
                  <span className="id-mono" style={{ fontSize: 12, color: "var(--w-3)" }}>{poolCards.reduce((s, c) => s + c.quantity, 0)} candidates</span>
                </div>
                <div className="id-seg">
                  {(["ai", "scryfall", "name"] as const).map((mode) => (
                    <button key={mode} type="button" data-on={searchMode === mode} onClick={() => switchMode(mode)}>
                      {mode === "ai" ? "✦ Ask AI" : mode === "scryfall" ? "Search" : "Name"}
                    </button>
                  ))}
                </div>
              </div>
              {/* search body */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

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
                            background: { w: "#efe6c2", u: "#3a82d8", b: "#6f5f7e", r: "#e0573f", g: "#4e9e6a" }[c.code],
                            color: c.code === "w" ? "#7a6a32" : "#ffffff",
                            fontWeight: 700,
                            fontSize: 14,
                            boxShadow: "inset 0 0 0 1px rgba(0,0,0,.1)",
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

            {/* AI chat · name add · scryfall search */}
            {searchMode === "ai" ? (
              <DeckChat
                deckId={deckId}
                pool={pool}
                commander={deck?.commander}
                ownedNames={ownedNames}
                onPoolChanged={loadPool}
                onEngaged={setAiEngaged}
              />
            ) : searchMode === "name" ? (
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
              <form onSubmit={onSubmitSearch} style={{ display: "flex", gap: 10 }}>
                <input
                  className="cc-paper"
                  placeholder="Scryfall syntax:  t:wizard id:u…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={searching}
                  style={paperInput}
                />
                <button type="submit" disabled={searching || !query.trim()} style={goldSearchBtn(searching)}>
                  {searching ? "Seeking…" : "Search"}
                </button>
              </form>
            )}

            {searchMode === "scryfall" && searchError && (
              <div style={{ marginTop: 12 }}><ErrorNote>{searchError}</ErrorNote></div>
            )}
            {searchMode === "scryfall" && !swipeOpen && searchResults.length > 0 && (
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

          {poolCards.length > 0 && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -2 }}>
              <button onClick={() => startReview()} className="id-ghost" style={{ padding: "7px 14px", fontSize: 12.5 }}>
                ✓ Review pool
              </button>
            </div>
          )}

          {/* candidate list — own scroll on desktop, flows with the page on mobile */}
          <div className="id-cardscroll" style={{ display: "flex", flexDirection: "column", gap: 8, paddingRight: 2 }}>
            {poolCards.length === 0 ? (
              <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--w-3)", borderRadius: 14, border: "1px dashed var(--w-line)", fontSize: 13.5 }}>
                {pool.length === 0
                  ? "Ask for cards above to fill the pool."
                  : "Pool is empty — every card has been promoted to the deck."}
              </div>
            ) : (
              poolCards.map((card) => (
                <IdCardLine
                  key={card.dbId}
                  card={card}
                  owned={ownedSet.has(card.name.toLowerCase())}
                  warning={warningOf(card)}
                  onOpen={() => startReview(card)}
                  trailing={
                    <button className="id-add" title="Add to deck" onClick={(e) => { e.stopPropagation(); moveTo(card.dbId, "deck"); }}>+</button>
                  }
                />
              ))
            )}
          </div>
        </aside>

        {/* ── THE DECK ── */}
        <section className="id-panel id-deckcol" style={{ padding: "18px clamp(14px,2vw,24px)" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span className="id-display" style={{ fontSize: "clamp(26px,3vw,38px)", color: "var(--w-1)" }}>The deck</span>
              <span className="id-mono" style={{ fontSize: 13, color: "var(--w-1)", fontWeight: 600 }}>
                {deckCount}<span style={{ color: "var(--w-3)" }}>/{target}</span>
                <span style={{ color: "var(--w-3)", marginLeft: 8 }}>· {Math.max(0, target - deckCount)} to go</span>
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="id-seg">
                {([["type", "By type"], ["cost", "By cost"], ["name", "A–Z"]] as const).map(([k, label]) => (
                  <button key={k} type="button" data-on={deckSort === k} onClick={() => setDeckSort(k)}>{label}</button>
                ))}
              </div>
              <button onClick={() => startDeckReview()} disabled={deckCards.length === 0} className="id-ghost" style={{ padding: "7px 14px", fontSize: 12.5 }}>
                ✓ Review
              </button>
            </div>
          </div>
          {warningCount > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--gold)", marginBottom: 12 }}>
              ⚠ {warningCount} card{warningCount === 1 ? "" : "s"} with legality warnings — hover the ⚠ on a card.
            </div>
          )}

          {deckCards.length === 0 ? (
            <div style={{ padding: "54px 20px", textAlign: "center", color: "var(--w-3)" }}>
              <div className="id-display" style={{ fontSize: 26, color: "var(--w-2)", marginBottom: 8 }}>Empty deck</div>
              <div style={{ fontSize: 13.5 }}>Add cards from the pool with + to start building toward {target}.</div>
            </div>
          ) : deckSort === "type" ? (
            <div>
              {(() => {
                const commander = deckCards.find(isCommander);
                const rest = deckCards.filter((c) => !isCommander(c));
                return (
                  <>
                    {commander && (
                      <div style={{ marginBottom: 24 }}>
                        <DeckSectionHead cat="Commander" n={1} />
                        <div style={deckTileGrid}>
                          <DeckCardTile card={commander} owned={ownedSet.has(commander.name.toLowerCase())} warning={warningOf(commander)} removable={false} onRemove={() => {}} />
                        </div>
                      </div>
                    )}
                    {groupedFor(rest)
                      .map((g) => ({ t: g.t, cards: g.cards.filter(matchesDeckFilter) }))
                      .filter((g) => g.cards.length)
                      .map((g) => (
                        <div key={g.t} style={{ marginBottom: 24 }}>
                          <DeckSectionHead cat={g.t} n={g.cards.reduce((s, c) => s + c.quantity, 0)} />
                          <div style={deckTileGrid}>
                            {g.cards.map((c) => (
                              <DeckCardTile key={c.dbId} card={c} owned={ownedSet.has(c.name.toLowerCase())} warning={warningOf(c)} removable onOpen={() => startDeckReview(c)} onRemove={() => removeCard(c.dbId)} />
                            ))}
                          </div>
                        </div>
                      ))}
                  </>
                );
              })()}
            </div>
          ) : (
            <div style={deckTileGrid}>
              {[...deckCards]
                .sort((a, b) => deckSort === "cost" ? (manaValue(a.manaCost) - manaValue(b.manaCost)) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name))
                .map((c) => (
                  <DeckCardTile key={c.dbId} card={c} owned={ownedSet.has(c.name.toLowerCase())} warning={warningOf(c)} removable={!isCommander(c)} onOpen={() => startDeckReview(c)} onRemove={() => removeCard(c.dbId)} />
                ))}
            </div>
          )}
        </section>
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
              <CommanderInput className="cc-paper" placeholder="(optional)" value={edit.commander} onChange={(v) => setEdit({ ...edit, commander: v })} style={paperInput} />
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
            if (pc) moveCard(deckId, pc.dbId, "deck").then(() => setPendingSync(pendingFor(deckId).length));
          }}
          onPass={(card) => {
            const pc = reviewCards.find((c) => c.id === card.id);
            if (pc) deleteCard(deckId, pc.dbId).then(() => setPendingSync(pendingFor(deckId).length));
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
            if (dc) deleteCard(deckId, dc.dbId).then(() => setPendingSync(pendingFor(deckId).length));
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
    padding: "0 22px",
    borderRadius: 12,
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
  onClickType,
}: {
  types: { name: string; n: number }[];
  count: number;
  target: number;
  empty: string;
  /** Fires with a type name on hover of a filled dot, null on leave. */
  onHoverType?: (name: string | null) => void;
  /** Fires with a type name when a filled dot is clicked. */
  onClickType?: (name: string) => void;
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
            onClick={() => c && onClickType?.(c.name)}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: c ? c.color : empty,
              cursor: c ? "pointer" : "default",
              opacity: hover === null || hover === c?.name ? 1 : 0.3,
              transition: "opacity .12s",
            }}
          />
        );
      })}
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

const deckTileGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))",
  gap: 12,
};

/* Full card-image tile for the decklist: the card art with quantity / owned /
   warning badges, a hover remove (unless it's the commander), and click-to-review. */
function DeckCardTile({
  card,
  owned,
  warning,
  removable,
  onOpen,
  onRemove,
}: {
  card: PoolCard;
  owned?: boolean;
  warning?: string;
  removable: boolean;
  onOpen?: () => void;
  onRemove: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      title={card.name}
      style={{
        position: "relative",
        borderRadius: "4.8%/3.5%",
        overflow: "hidden",
        cursor: onOpen ? "pointer" : "default",
        aspectRatio: "5 / 7",
        background: "rgba(0,0,0,.25)",
        boxShadow: hover ? "0 14px 30px -10px rgba(0,0,0,.6)" : "0 4px 12px -4px rgba(0,0,0,.45)",
        transform: hover ? "translateY(-3px)" : "none",
        transition: "transform .16s ease, box-shadow .16s ease",
      }}
    >
      {/* stored scan first; a stale/404 URL falls back to a fresh name-based
          fetch, then the gradient placeholder — never a broken-image icon. */}
      <CardArt
        name={card.name}
        src={card.imageUri || undefined}
        prefer="src"
        version="normal"
        loading="lazy"
        radius={0}
        style={{ position: "absolute", inset: 0 }}
      />
      {owned && (
        <span title="In your collection" style={{ position: "absolute", top: 7, left: 7, background: "rgba(13,138,95,.92)", color: "#fff", fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, boxShadow: "0 1px 4px rgba(0,0,0,.35)" }}>
          ✓
        </span>
      )}
      {card.quantity > 1 && (
        <span style={{ position: "absolute", bottom: 7, left: 7, background: "rgba(0,0,0,.72)", color: "#fff", fontSize: 11.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999 }}>
          ×{card.quantity}
        </span>
      )}
      {warning && (
        <span title={warning} style={{ position: "absolute", bottom: 7, right: 7, background: "rgba(0,0,0,.72)", color: "#ffd23f", fontSize: 12, width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          ⚠
        </span>
      )}
      {removable && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove from deck"
          aria-label="Remove from deck"
          style={{ ...poolIconBtn, position: "absolute", top: 7, right: 7, opacity: hover ? 1 : 0, transition: "opacity .15s", color: "#ff9b8a" }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/* Deck-rail row — white pill: thumbnail + name + type + mana pips. */
/* White card row used in both panels: art thumb + name/type + mana + a trailing
   action slot. Matches the Color Identity design's id-card rows. */
function IdCardLine({
  card,
  owned,
  warning,
  onOpen,
  trailing,
}: {
  card: PoolCard;
  owned?: boolean;
  warning?: string;
  onOpen?: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      className="id-card id-deckrow"
      onClick={onOpen}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: 8, cursor: onOpen ? "pointer" : "default" }}
    >
      <div style={{ position: "relative", width: 44, height: 44, borderRadius: 8, overflow: "hidden", flex: "none" }}>
        <CardArt name={card.name} src={card.imageUri || undefined} colors={colorsOf(card.manaCost)} radius={0} style={{ position: "absolute", inset: 0 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {card.quantity > 1 && <span style={{ fontSize: 12, fontWeight: 700, color: "#857f90", flex: "none" }}>{card.quantity}×</span>}
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.name}</span>
          {owned && <span title="In your collection" style={{ color: "#0d8a5f", fontSize: 12, fontWeight: 700, flex: "none" }}>✓</span>}
          {warning && <span title={warning} style={{ color: "#c2402a", fontSize: 12, flex: "none" }}>⚠</span>}
        </div>
        <div style={{ fontSize: 11.5, color: "#857f90", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.typeLine}</div>
      </div>
      <ManaCost cost={card.manaCost} size={14} />
      {trailing}
    </div>
  );
}

/* Section header inside the deck panel: a category dot + label + count + rule. */
function DeckSectionHead({ cat, n }: { cat: string; n: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "0 0 11px" }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: CAT_COLOR[cat] || "#ccc", flex: "none" }} />
      <span className="id-label" style={{ color: "var(--w-1)", fontSize: 12.5 }}>{cat}</span>
      <span className="id-mono" style={{ fontSize: 12, color: "var(--w-3)" }}>{n}</span>
      <span style={{ flex: 1, height: 1, background: "var(--w-line)" }} />
    </div>
  );
}

function DeckRailRow({
  card,
  warning,
  owned,
  onOpen,
  onMove,
  onRemove,
}: {
  card: PoolCard;
  warning?: string;
  owned?: boolean;
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
          {owned && <span title="In your collection" style={{ color: "#0d8a5f", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>✓</span>}
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
