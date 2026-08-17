"use client";

import { use, useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Logo from "@/components/Logo";
import CommanderInput from "@/components/CommanderInput";
import SwipeModal from "@/components/SwipeModal";
import ToolSheet, { Tool } from "@/components/deck/ToolSheet";
import HandSimModal from "@/components/deck/HandSimModal";
import GameCodeModal from "@/components/deck/GameCodeModal";
import DeckChat, { useDeckChat } from "@/components/deck/DeckChat";
import DeckPrimer from "@/components/deck/DeckPrimer";
import DeckStatsPane from "@/components/deck/DeckStatsPane";
import OrderModal from "@/components/deck/OrderModal";
import { ModalShell, Field, ErrorNote, paperInput, ghostBtn, goldBtn, toolBtn, dangerBtn } from "@/components/deck/ui";
import { OutCard, resolveNamed } from "@/lib/scryfall";
import { PoolEntry, Board, poolByName, resolveAndAdd, moveCard, deleteCard, setQuantity } from "@/lib/pool-client";
import { singletonCapped } from "@/lib/format";
import { applyPending, flushQueue, pendingFor } from "@/lib/offline-queue";
import { cardWarnings } from "@/lib/legality";
import { getIdentityTheme } from "@/lib/identity-theme";
import { fetchCollection } from "@/lib/collection-client";
import { track } from "@/lib/track";
import {
  CardArt,
  commanderArtName,
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
  Creatures: "#fdf26f",
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
  /** The play primer — written or AI-drafted in the iOS app, read here. */
  primer: string | null;
  shared?: boolean;
  isPublic?: boolean;
  canEdit?: boolean;
  /** Game-night record — play-code results and the owner's tracker. */
  gamesPlayed?: number;
  gamesWon?: number;
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

type SearchMode = "scryfall" | "name";

/** The deck page's three panes, in the order the switcher shows them.
    Deck leads: it is what the page opens on and what you came to look at. */
type Pane = "deck" | "pool" | "stats";
const PANES: Pane[] = ["deck", "pool", "stats"];

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
  const [searchMode, setSearchMode] = useState<SearchMode>("name");
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState("");
  const [nameAdding, setNameAdding] = useState(false);

  // header tools dropdown + play-guide popover
  const [toolsOpen, setToolsOpen] = useState(false);
  // Fixed viewport coords for the tools menu, measured from the button so it
  // opens right under it and never runs off-screen on mobile.
  const [toolsPos, setToolsPos] = useState<{ top: number; left: number } | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [primerOpen, setPrimerOpen] = useState(false);
  // Count of offline review decisions waiting to sync (drives the banner).
  const [pendingSync, setPendingSync] = useState(0);
  const [copied, setCopied] = useState<"" | "link" | "list">("");
  // deck-panel sort: by type (grouped), by cost (mv), or A–Z
  const [deckSort, setDeckSort] = useState<"type" | "cost" | "name">("type");

  // settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [edit, setEdit] = useState({ name: "", format: "commander", commander: "" });
  // Two-step delete inside settings: the first click arms the confirm.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  /// Which pane the deck page shows — Pool, Deck or Stats, the same three the
  /// iOS deck page has, and one at a time at every width.
  ///
  /// This started as a mobile-only Pool/Deck toggle that CSS-hid one column of
  /// a two-column desktop workspace. That made Pool and Deck a fake pair up
  /// there: "Deck" showed the pool as well, so the button did nothing and the
  /// Pool button had to be hidden to cover for it. They are real panes now.
  /// The cost is that a desktop brewer no longer sees the search and the
  /// decklist at once, which is the trade iOS already makes.
  ///
  /// Opens on the deck, like iOS — you open a deck to look at the deck.
  const [pane, setPane] = useState<Pane>("deck");

  /// The assistant lives in a sheet now, the way the iOS deck page opens it.
  /// It used to be a panel wedged between the hero and the panes, which cost
  /// every pane a screenful of height whether or not you were talking to it.
  const [chatOpen, setChatOpen] = useState(false);

  /// "Add cards" jumps to the pool and puts the cursor in its search box.
  /// Bumped rather than called directly: the pool pane mounts on the same
  /// state change, so the focus has to wait for the commit that creates it.
  const poolSearchRef = useRef<HTMLInputElement>(null);
  const [focusSearchTick, setFocusSearchTick] = useState(0);
  const goAddCards = useCallback(() => {
    setPane("pool");
    setFocusSearchTick((t) => t + 1);
  }, []);
  useEffect(() => {
    if (focusSearchTick > 0) poolSearchRef.current?.focus();
  }, [focusSearchTick]);

  // Hovering a mana-curve bar or a type dot filters the decklist below to that
  // selection. null = no filter (show the whole deck).
  const [deckFilter, setDeckFilter] = useState<
    { kind: "mv"; value: number } | { kind: "type"; value: string } | null
  >(null);

  // sample-hand simulator
  const [handSimOpen, setHandSimOpen] = useState(false);
  const [gameCodeOpen, setGameCodeOpen] = useState(false);

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
            mode: "scryfall",
            currentDeck: {
              commander: deck?.commander ?? null,
              cards: pool.map((c) => ({ name: c.name, manaCost: c.manaCost, typeLine: c.typeLine, quantity: c.quantity })),
            },
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setSearchError(data.details?.details ?? data.error ?? "Search failed");
        } else {
          // In singleton decks, hide cards already in the deck — by id and by
          // name — so the swipe never offers a duplicate. Other formats allow
          // playsets, so every match stays offerable (swiping right adds
          // another copy).
          const all = data.cards as SearchCard[];
          let filtered = all;
          let hidden = 0;
          if ((deck?.format ?? "").toLowerCase() === "commander") {
            const poolIds = new Set(pool.map((c) => c.id));
            const poolNames = new Set(pool.map((c) => c.name.toLowerCase()));
            filtered = all.filter((c) => !poolIds.has(c.id) && !poolNames.has(c.name.toLowerCase()));
            hidden = all.length - filtered.length;
          }
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
    [pool, deck?.format]
  );

  function onSubmitSearch(e: React.FormEvent) {
    e.preventDefault();
    runSearch(query);
  }

  // Switching modes clears the inputs and any errors/results — the two modes
  // speak different languages (Scryfall syntax vs. exact names), so carrying
  // text across them mostly produces errors (e.g. a name run as Scryfall
  // syntax 404s).
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
      // Singleton decks ignore a re-add; elsewhere the server increments the
      // existing row's quantity (another copy for the playset).
      if (singletonCapped(deck?.format ?? "commander", card.typeLine) && pool.some((c) => c.id === card.id)) return;
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
    [pool, deckId, loadPool, deck?.format]
  );

  async function addByName(e: React.FormEvent) {
    e.preventDefault();
    const name = nameInput.trim();
    if (!name) return;
    setNameAdding(true);
    setNameError("");
    // Refuse a duplicate only where the format caps copies: commander and
    // non-basic. Re-adding elsewhere (or a basic in commander) puts another
    // copy on the existing row.
    const known = poolByName(pool);
    const existing = known.get(name.toLowerCase());
    const skip = existing
      ? singletonCapped(deck?.format ?? "", existing.typeLine)
      : (deck?.format ?? "").toLowerCase() === "commander";
    const r = await resolveAndAdd(deckId, name, 1, known, { skipIfExists: skip });
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

  // Set the exact copy count of a deck row (the tiles' − / + stepper, shown in
  // formats that allow playsets). The last copy is removed via the ✕, not here.
  async function setCopies(c: PoolCard, next: number) {
    if (next < 1 || next === c.quantity) return;
    if (await setQuantity(deckId, c.dbId, next)) loadPool();
  }

  async function removeCard(dbId: number) {
    await deleteCard(deckId, dbId);
    loadPool();
  }

  function openSettings() {
    if (!deck) return;
    setEdit({ name: deck.name, format: deck.format, commander: deck.commander || "" });
    setConfirmDelete(false);
    setSettingsOpen(true);
  }

  function flash(which: "link" | "list") {
    setCopied(which);
    setTimeout(() => setCopied(""), 1600);
  }
  function copyLink() {
    navigator.clipboard?.writeText(window.location.href).then(() => flash("link")).catch(() => {});
  }

  // Toggle read-only public sharing for an owned deck. Turning it on makes the
  // current URL resolve for anyone (view-only); off makes it private again.
  const [sharing, setSharing] = useState(false);
  async function setShared(next: boolean) {
    if (!deck) return;
    setSharing(true);
    const res = await fetch(`/api/decks/${deckId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shared: next }),
    });
    if (res.ok) setDeck((d) => (d ? { ...d, shared: next } : d));
    setSharing(false);
  }

  // Header "Share": ensure an owned deck is view-shareable, then copy its link.
  // Ownerless public decks and already-shared decks just copy.
  async function shareDeck() {
    if (canEdit && deck && !deck.isPublic && !deck.shared) await setShared(true);
    copyLink();
  }

  // Fork the deck into an editable copy of one's own (the read-only viewer's
  // main action) and open it.
  const [forking, setForking] = useState(false);
  async function duplicateThisDeck() {
    setForking(true);
    const res = await fetch(`/api/decks/${deckId}/duplicate`, { method: "POST" });
    if (res.ok) {
      const copy = await res.json();
      if (copy?.publicId) { router.push(`/deck/${copy.publicId}`); return; }
    }
    setForking(false);
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

  // Delete the whole deck (a two-step confirm guards the destructive click),
  // then return to the deck list.
  async function deleteDeck() {
    if (!deck) return;
    setDeleting(true);
    const res = await fetch(`/api/decks/${deckId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/");
    } else {
      setDeleting(false);
      setConfirmDelete(false);
    }
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

  // Read-only viewing: someone opened a shared link to a deck they don't own.
  // The API says so via canEdit; treat an unloaded deck as editable so the
  // owner never sees a flash of the view-only layout.
  const canEdit = deck?.canEdit !== false;
  // Tapping a deck card: owners triage it in review; viewers just preview it.
  const openCard = (c: PoolCard) => (canEdit ? startDeckReview(c) : setPreview(c));

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
  // Counted over the DECK board, not the whole pool. The banner this feeds
  // sits on the deck pane and says "hover the warning on a card" — counting
  // pool candidates too sent you looking for cards that aren't on that pane.
  // A card you are only considering is not a legality problem yet.
  const deckWarningCount = deckCards.reduce((n, c) => n + (warningOf(c) ? 1 : 0), 0);


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

  // One AI conversation for the whole page — rendered in the pool search panel
  // and again on the mobile deck tab, both views sharing this state.
  const chat = useDeckChat({
    deckId,
    pool,
    commander: deck?.commander,
    ownedNames,
    onPoolChanged: loadPool,
  });

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
            {/* Shown to a non-owner too. Copy decklist and Buy list were a hero
                button and a top-bar button, both ungated; folding them in here
                behind `canEdit` would have quietly taken them away from anyone
                reading a shared deck. */}
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
                    {/* Grouped, because this menu now carries everything that
                        used to compete with Ask AI for the hero: the list
                        actions came off the hero and out of the top bar, and an
                        ungrouped list of eight reads as a junk drawer. */}
                    {([
                      { group: "The list" },
                      // Holds the menu open so the copy is confirmed. As a
                      // hero button this said "Copied!"; closing on click
                      // would have made copying silent.
                      { label: copied === "list" ? "✓ Copied!" : "📋 Copy decklist", on: copyDecklist, disabled: deckCards.length === 0, keepOpen: true },
                      { label: "🛒 Buy list", on: () => setOrderOpen(true), disabled: deckCards.length === 0 },
                      ...(canEdit ? [
                        { label: "🌲 Add lands & staples", on: () => setTool("lands") },
                        { label: "⬆ Export / import", on: () => setTool("export") },
                        { group: "At the table" },
                        { label: "🎟 Game code", on: () => setGameCodeOpen(true) },
                        { group: "Write-ups" },
                        { label: "📖 Primer", on: () => { setPrimerOpen(true); setPane("stats"); } },
                        { label: "📝 Quick notes", on: () => { setNotesOpen(true); setPane("stats"); } },
                      ] : []),
                    ] as { group?: string; label?: string; on?: () => void; disabled?: boolean; keepOpen?: boolean }[]).map((it) =>
                      it.group ? (
                        <div key={it.group} className="id-label" style={{ color: "var(--w-3)", fontSize: 10, padding: "9px 11px 4px" }}>
                          {it.group}
                        </div>
                      ) : (
                        <button
                          key={it.label}
                          onClick={() => { if (!it.disabled) { it.on!(); if (!it.keepOpen) setToolsOpen(false); } }}
                          disabled={it.disabled}
                          style={{ textAlign: "left", padding: "9px 11px", borderRadius: 9, border: "none", background: "transparent", color: "var(--w-1)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 600, cursor: it.disabled ? "default" : "pointer", opacity: it.disabled ? 0.45 : 1 }}
                        >
                          {it.label}
                        </button>
                      )
                    )}
                  </div>
                </>
              )}
            </div>
            {/* Playtest was the hero's headline action. It is a thing you do
                WITH a finished deck, not a thing you do to build one, so it
                sits up here with Share and Tools — and the hero goes to the two
                actions that actually build the deck. */}
            <button className="id-ghost" style={{ padding: "9px 15px" }} onClick={() => setHandSimOpen(true)} disabled={deckCards.length === 0}>
              🎲 Playtest
            </button>
            <button className="id-ghost" style={{ padding: "9px 15px" }} onClick={shareDeck} disabled={sharing}>
              {copied === "link" ? "Copied!" : sharing ? "Sharing…" : "Share"}
            </button>
            {canEdit ? (
              <button className="id-btn" style={{ padding: "10px 18px" }} onClick={openSettings}>
                Edit deck
              </button>
            ) : (
              <button className="id-btn" style={{ padding: "10px 18px" }} onClick={duplicateThisDeck} disabled={forking}>
                {forking ? "Duplicating…" : "⧉ Duplicate"}
              </button>
            )}
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
                {(deck?.gamesPlayed ?? 0) > 0 && (
                  <span className="id-mono" title="Game-night record — wins–losses" style={{ fontSize: 12.5, color: "var(--gold)", padding: "3px 10px", borderRadius: 999, background: "var(--w-fill)", border: "1px solid var(--w-line)" }}>
                    {deck!.gamesWon ?? 0}–{(deck!.gamesPlayed ?? 0) - (deck!.gamesWon ?? 0)} record
                  </span>
                )}
              </div>
              <h1 className="id-display" style={{ margin: "0 0 12px", fontSize: "clamp(40px, 7vw, 84px)", color: "var(--w-1)" }}>
                {deck?.name || "…"}
              </h1>
              {deck?.commander && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24, fontSize: 14, color: "var(--w-2)" }}>
                  Helmed by <b style={{ color: "var(--w-1)" }}>{deck.commander}</b>
                </div>
              )}
              {/* The two actions that BUILD the deck, the pair the iOS deck
                  page leads with. Playtest and Copy decklist used to sit here;
                  neither builds anything, and both outranked the assistant by
                  being the only buttons on the page. They are in the header
                  now. Owner-only: a viewer can build nothing. */}
              {canEdit && (
                <div className="deck-actions">
                  <button className="deck-action deck-action-add" onClick={goAddCards} title="Add cards to the pool">
                    <span className="deck-action-icon" aria-hidden>+</span>
                    <span className="deck-action-text">
                      <b>Add cards</b>
                      <i>Search, or paste a list.</i>
                    </span>
                  </button>
                  <button className="deck-action deck-action-ai" onClick={() => setChatOpen(true)}>
                    <span className="deck-action-icon" aria-hidden>✦</span>
                    <span className="deck-action-text">
                      <b>Ask the AI about this deck</b>
                      <i>Lines, cuts and combos.</i>
                    </span>
                    <span className="deck-action-chev" aria-hidden>›</span>
                  </button>
                </div>
              )}
            </div>

            {/* commander showcase + progress badge */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ position: "relative", width: "min(280px, 78vw)" }}>
                <div style={{ aspectRatio: "5 / 7", borderRadius: 16, overflow: "hidden", boxShadow: "0 30px 60px -24px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.1)" }}>
                  {(deck?.commander || deck?.name) && (
                    <CardArt
                      key={deck?.commander || deck?.name}
                      name={commanderArtName(deck?.commander)}
                      label={deck?.name}
                      colors={identityPips.length ? identityPips : ["C"]}
                      version="normal"
                      radius={16}
                      style={{ width: "100%", height: "100%" }}
                    />
                  )}
                </div>
                <div className="id-card" style={{ position: "absolute", bottom: -18, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 11, padding: "10px 16px", whiteSpace: "nowrap" }}>
                  <span className="id-display" style={{ fontSize: 26, color: "var(--w-1)" }}>
                    {deckCount}<span style={{ color: "var(--w-3)", fontSize: 18 }}>/{target}</span>
                  </span>
                  <div style={{ width: 64, height: 6, borderRadius: 4, background: "rgba(255,255,255,.14)", overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(1, deckCount / Math.max(1, target)) * 100}%`, height: "100%", background: "var(--gold)", borderRadius: 4 }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* The stats used to sit HERE, above everything, at every width. Half a
              screen of numbers before the cards you opened the deck to see.
              They are a pane of their own now — see the switcher below. */}


          {/* A read-only banner for viewers of a shared deck. */}
          {!canEdit && (
            <div className="id-panel" style={{ padding: "11px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 9, fontSize: 13.5, color: "var(--w-2)" }}>
              <span aria-hidden style={{ fontSize: 15 }}>👁</span>
              You’re viewing a shared deck — read-only. Hit <b style={{ color: "var(--w-1)" }}>Duplicate</b> to make your own editable copy.
            </div>
          )}

          {/* The assistant used to sit HERE as a permanent panel. It is a sheet
              off the hero's Ask AI tile now — same single conversation, which
              still persists for as long as the page is mounted. */}

          {/* Pane switcher — Pool / Deck / Stats, the iOS deck page's three tabs,
              and one pane at a time at every width.

              It sits directly above the panes because it governs what follows
              it. It used to sit BELOW the stats, so choosing Stats put the
              content above the control that chose it.

              A non-owner gets it too. They have no pool, so they get two
              buttons — but they do have stats, and this is the only route. */}
          <div className="deck-panes">
          <div className="deck-panes-row" role="tablist" aria-label="Deck view">
            {PANES.filter((p) => p !== "pool" || canEdit).map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={pane === p}
                className={pane === p ? "is-active" : ""}
                onClick={() => setPane(p)}
              >
                {p === "pool" ? "Pool" : p === "deck" ? "Deck" : "Stats"}
                {p === "pool" && <span>{poolCards.reduce((s, c) => s + c.quantity, 0)}</span>}
                {p === "deck" && <span>{deckCount}</span>}
              </button>
            ))}
          </div>
          </div>

          {/* ── STATS PANE ── */}
          {pane === "stats" && (
            <DeckStatsPane
              deckId={deckId}
              deckCards={deckCards}
              // Both boards. 8x8 and the bracket read the deck board out of
              // this themselves, and a Game Changer you are only CONSIDERING
              // must not count — see lib/deck-insight.
              insightCards={pool.map((c) => ({
                name: c.name,
                typeLine: c.typeLine ?? null,
                role: c.role ?? null,
                quantity: c.quantity,
                board: c.board,
              }))}
              identity={identityPips}
              avgManaValue={stats.avgMv}
              canEdit={canEdit}
              primer={deck?.primer ?? ""}
              primerOpen={primerOpen}
              onPrimerSaved={(text) => setDeck((d) => (d ? { ...d, primer: text || null } : d))}
              notes={notes}
              notesOpen={notesOpen}
              noteStatus={noteStatus}
              onNotesChange={onNotesChange}
              onNotesBlur={() => { if (noteTimer.current) clearTimeout(noteTimer.current); saveNotes(notes); }}
              onHoverCurveBar={(i) => setDeckFilter(i === null ? null : { kind: "mv", value: i })}
              onClickCurveBar={canEdit ? (i) => { setPane("deck"); startDeckReviewOf(deckCards.filter((c) => categoryOf(c.typeLine) !== "Lands" && Math.min(manaValue(c.manaCost), 7) === i)); } : undefined}
            />
          )}

          {/* ── POOL PANE ── (owner only) */}
          {pane === "pool" && canEdit && (
            <aside className="id-panel id-pool" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                  <span className="id-display" style={{ fontSize: 24, color: "var(--w-1)" }}>Pool</span>
                  <span className="id-mono" style={{ fontSize: 12, color: "var(--w-3)" }}>{poolCards.reduce((s, c) => s + c.quantity, 0)} candidates</span>
                </div>
                <div className="id-seg">
                  {(["name", "scryfall"] as const).map((mode) => (
                    <button key={mode} type="button" data-on={searchMode === mode} onClick={() => switchMode(mode)}>
                      {mode === "scryfall" ? "Search" : "Name"}
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

            {/* name add · scryfall search (the AI lives in the panel above) */}
            {searchMode === "name" ? (
              <form onSubmit={addByName} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    ref={poolSearchRef}
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

          {/* Candidate list. A grid rather than one long column: the pool has the
              page's full width now that it is a pane of its own, and a single
              column of card lines stretched to 1180px is width spent on nothing. */}
          <div className="id-cardscroll" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))", gap: 8, paddingRight: 2 }}>
            {poolCards.length === 0 ? (
              <div style={{ gridColumn: "1 / -1", padding: "40px 16px", textAlign: "center", color: "var(--w-3)", borderRadius: 14, border: "1px dashed var(--w-line)", fontSize: 13.5 }}>
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
        )}

        {/* ── DECK PANE ── */}
        {pane === "deck" && (
        <section className="id-panel" style={{ padding: "18px clamp(14px,2vw,24px)" }}>
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
              {canEdit && (
                <button onClick={() => startDeckReview()} disabled={deckCards.length === 0} className="id-ghost" style={{ padding: "7px 14px", fontSize: 12.5 }}>
                  ✓ Review
                </button>
              )}
            </div>
          </div>
          {deckWarningCount > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--gold)", marginBottom: 12 }}>
              ⚠ {deckWarningCount} card{deckWarningCount === 1 ? "" : "s"} with legality warnings — hover the ⚠ on a card.
            </div>
          )}

          {deckCards.length === 0 ? (
            <div style={{ padding: "54px 20px", textAlign: "center", color: "var(--w-3)" }}>
              <div className="id-display" style={{ fontSize: 26, color: "var(--w-2)", marginBottom: 8 }}>Empty deck</div>
              <div style={{ fontSize: 13.5 }}>
                {canEdit ? <>Search the <button type="button" onClick={() => setPane("pool")} style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "var(--gold)", cursor: "pointer", textDecoration: "underline" }}>pool</button> and add cards with + to start building toward {target}.</> : "This deck has no cards yet."}
              </div>
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
                          <DeckCardTile card={commander} owned={ownedSet.has(commander.name.toLowerCase())} warning={warningOf(commander)} removable={false} onOpen={!canEdit ? () => setPreview(commander) : undefined} onRemove={() => {}} />
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
                              <DeckCardTile key={c.dbId} card={c} owned={ownedSet.has(c.name.toLowerCase())} warning={warningOf(c)} removable={canEdit} onOpen={() => openCard(c)} onRemove={() => removeCard(c.dbId)} onQty={!canEdit || singletonCapped(deck?.format ?? "commander", c.typeLine) ? undefined : (n) => setCopies(c, n)} />
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
                  <DeckCardTile key={c.dbId} card={c} owned={ownedSet.has(c.name.toLowerCase())} warning={warningOf(c)} removable={canEdit && !isCommander(c)} onOpen={() => openCard(c)} onRemove={() => removeCard(c.dbId)} onQty={!canEdit || isCommander(c) || singletonCapped(deck?.format ?? "commander", c.typeLine) ? undefined : (n) => setCopies(c, n)} />
                ))}
            </div>
          )}
        </section>
        )}
        </div>
      </div>

      {/* The assistant, off the hero tile. Wide, because its answers carry card
          links you hover to preview. */}
      {chatOpen && canEdit && (
        <ModalShell onDismiss={() => setChatOpen(false)} maxWidth={780} zIndex={68}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 14 }}>
            <span className="id-display" style={{ fontSize: 22, color: "var(--w-1)" }}>✦ Ask the AI</span>
            <span className="id-mono" style={{ fontSize: 12, color: "var(--w-3)" }}>build · judge · refine</span>
            <button
              onClick={() => setChatOpen(false)}
              aria-label="Close"
              style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--w-3)", fontSize: 22, lineHeight: 1, cursor: "pointer", padding: 0 }}
            >
              ×
            </button>
          </div>
          <DeckChat chat={chat} />
        </ModalShell>
      )}

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
            {edit.format === "commander" && (
              <Field label="Commander">
                <CommanderInput className="cc-paper" placeholder="(optional)" value={edit.commander} onChange={(v) => setEdit({ ...edit, commander: v })} style={paperInput} />
              </Field>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
              <button type="button" onClick={() => setSettingsOpen(false)} style={ghostBtn}>
                Cancel
              </button>
              <button type="submit" disabled={saving} style={goldBtn}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>

          {/* Sharing — a read-only public link. Not shown for ownerless public
              decks, which are already open to everyone. */}
          {!deck?.isPublic && (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
              <div className="label-sc" style={{ fontSize: 11.5, color: "var(--t3)", letterSpacing: ".1em", marginBottom: 10 }}>
                Sharing
              </div>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(deck?.shared)}
                  disabled={sharing}
                  onChange={(e) => setShared(e.target.checked)}
                  style={{ marginTop: 3, width: 16, height: 16, flex: "none", accentColor: "var(--gold)" }}
                />
                <span style={{ fontSize: 13.5, color: "var(--frame-ink)", lineHeight: 1.45 }}>
                  <b>Anyone with the link can view</b> — a read-only copy of this deck. They can’t edit it.
                </span>
              </label>
              {deck?.shared && (
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <input readOnly value={typeof window !== "undefined" ? window.location.href : ""} style={{ ...paperInput, flex: 1, fontSize: 12.5 }} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" onClick={copyLink} style={toolBtn}>
                    {copied === "link" ? "Copied!" : "Copy"}
                  </button>
                </div>
              )}
            </div>
          )}

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

          {/* Danger zone — delete the deck (two-step confirm). */}
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
            <div className="label-sc" style={{ fontSize: 11.5, color: "var(--danger)", letterSpacing: ".1em", marginBottom: 10 }}>
              Danger zone
            </div>
            {confirmDelete ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={{ margin: 0, fontSize: 13.5, color: "var(--frame-ink)", lineHeight: 1.45 }}>
                  Delete <b>{deck?.name}</b> and all its cards? This can’t be undone.
                </p>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting} style={ghostBtn}>
                    Keep deck
                  </button>
                  <button type="button" onClick={deleteDeck} disabled={deleting} style={dangerBtn}>
                    {deleting ? "Deleting…" : "Delete permanently"}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} style={{ ...toolBtn, color: "var(--danger)", width: "100%" }}>
                🗑 Delete this deck
              </button>
            )}
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

      {/* game code — seat this deck at a friend's table */}
      {gameCodeOpen && (
        <GameCodeModal
          deckId={deckId}
          commanderImageUri={deckCards.find((c) => c.name === deck?.commander)?.imageUri ?? null}
          onClose={() => setGameCodeOpen(false)}
        />
      )}

      {/* CardTrader order */}
      {orderOpen && <OrderModal cards={deckCards} onClose={() => setOrderOpen(false)} />}

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
              {!canEdit ? null : !inPool(preview.id) ? (
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

const tileQtyBtn: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: "50%",
  border: "none",
  cursor: "pointer",
  background: "rgba(255,255,255,.14)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};

/* Card tiles. 118px was sized for the deck sharing a page with the pool
   column; the deck has the full width to itself now, so the art can be read
   rather than squinted at. */
const deckTileGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))",
  gap: 14,
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
  onQty,
}: {
  card: PoolCard;
  owned?: boolean;
  warning?: string;
  removable: boolean;
  onOpen?: () => void;
  onRemove: () => void;
  /** Set the copy count — provided only where the format allows playsets
      (non-commander decks, basics in commander); shows a − / + stepper. */
  onQty?: (next: number) => void;
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
      {onQty ? (
        <span
          onClick={(e) => e.stopPropagation()}
          style={{ position: "absolute", bottom: 7, left: 7, display: "flex", alignItems: "center", gap: 2, background: "rgba(0,0,0,.72)", borderRadius: 999, padding: "2px 3px" }}
        >
          <button
            onClick={() => onQty(card.quantity - 1)}
            disabled={card.quantity <= 1}
            title="One copy fewer"
            aria-label="One copy fewer"
            style={{ ...tileQtyBtn, opacity: card.quantity <= 1 ? 0.35 : 1, cursor: card.quantity <= 1 ? "default" : "pointer" }}
          >
            −
          </button>
          <span style={{ color: "#fff", fontSize: 11.5, fontWeight: 700, minWidth: 18, textAlign: "center" }}>×{card.quantity}</span>
          <button onClick={() => onQty(card.quantity + 1)} title="One copy more" aria-label="One copy more" style={tileQtyBtn}>
            +
          </button>
        </span>
      ) : (
        card.quantity > 1 && (
          <span style={{ position: "absolute", bottom: 7, left: 7, background: "rgba(0,0,0,.72)", color: "#fff", fontSize: 11.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999 }}>
            ×{card.quantity}
          </span>
        )
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
          {card.quantity > 1 && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--w-3)", flex: "none" }}>{card.quantity}×</span>}
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--w-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.name}</span>
          {owned && <span title="In your collection" style={{ color: "#4ecb8f", fontSize: 12, fontWeight: 700, flex: "none" }}>✓</span>}
          {warning && <span title={warning} style={{ color: "#ff9c86", fontSize: 12, flex: "none" }}>⚠</span>}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--w-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.typeLine}</div>
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
          {owned && <span title="In your collection" style={{ color: "#4ecb8f", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>✓</span>}
          {warning && <span title={warning} style={{ color: "#ff9c86", fontSize: 12 }}>⚠</span>}
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
