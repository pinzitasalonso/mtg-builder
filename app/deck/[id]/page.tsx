"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import SwipeModal from "@/components/SwipeModal";
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

interface SearchCard {
  id: string;
  name: string;
  imageUri: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
}

interface PoolCard extends SearchCard {
  dbId: number;
  quantity: number;
}

interface Deck {
  id: number;
  name: string;
  format: string;
  commander: string | null;
}

interface JudgeResult {
  summary: string;
  working: string[];
  cuts: string[];
  missing: string[];
}

// Preset quick-add lands & colorless staples for the bulk-land tool.
const PRESET_LANDS = [
  "Plains", "Island", "Swamp", "Mountain", "Forest",
  "Command Tower", "Sol Ring", "Arcane Signet", "Evolving Wilds",
];

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

  // tools (all reachable from the settings sheet)
  const [tool, setTool] = useState<null | "export" | "import" | "lands">(null);
  const [copied, setCopied] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [landSel, setLandSel] = useState<Record<string, number>>({});
  const [landBusy, setLandBusy] = useState(false);
  const [landSummary, setLandSummary] = useState<string | null>(null);

  // review-with-swipe mode (snapshot of the pool so live reloads don't disturb it)
  const [reviewCards, setReviewCards] = useState<PoolCard[] | null>(null);

  // AI pool judge
  const [judgeOpen, setJudgeOpen] = useState(false);
  const [judgeLoading, setJudgeLoading] = useState(false);
  const [judgeError, setJudgeError] = useState("");
  const [judge, setJudge] = useState<JudgeResult | null>(null);
  const [judgeAdds, setJudgeAdds] = useState<Record<string, "adding" | "added" | "error">>({});

  const loadPool = useCallback(async () => {
    const res = await fetch(`/api/decks/${deckId}/cards`);
    const data = await res.json();
    setPool(
      data.map((c: { id: number; scryfallId: string; name: string; imageUri: string; manaCost: string | null; typeLine: string | null; oracleText: string | null; quantity?: number }) => ({
        dbId: c.id,
        id: c.scryfallId,
        name: c.name,
        imageUri: c.imageUri,
        manaCost: c.manaCost,
        typeLine: c.typeLine,
        oracleText: c.oracleText,
        quantity: c.quantity ?? 1,
      }))
    );
  }, [deckId]);

  useEffect(() => {
    fetch(`/api/decks`)
      .then((r) => r.json())
      .then((decks: Deck[]) => {
        const d = decks.find((d) => d.id === deckId);
        if (d) setDeck(d);
      });
    loadPool();
  }, [deckId, loadPool]);

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
    try {
      const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
      const data = await res.json();
      if (!res.ok) {
        setNameError(data.details ?? data.error ?? "Card not found");
      } else {
        const imageUri = data.image_uris?.normal ?? data.card_faces?.[0]?.image_uris?.normal ?? "";
        await addCard({
          id: data.id,
          name: data.name,
          imageUri,
          manaCost: data.mana_cost ?? null,
          typeLine: data.type_line ?? null,
          oracleText: data.oracle_text ?? null,
        });
        setNameInput("");
      }
    } catch {
      setNameError("Network error");
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

  // Add `qty` copies of a card by name. If a card of that name is already in the
  // pool we increment THAT row (matched by name, since Scryfall's fuzzy lookup may
  // resolve to a different printing/id than the pooled copy); otherwise we resolve
  // it on Scryfall and create it. `known` is mutated so repeats within a batch
  // merge. Shared by import, bulk lands and AI suggestions.
  function poolByName(): Map<string, { id: string; name: string; imageUri: string; manaCost: string | null; typeLine: string | null; oracleText: string | null }> {
    const m = new Map<string, { id: string; name: string; imageUri: string; manaCost: string | null; typeLine: string | null; oracleText: string | null }>();
    for (const c of pool) m.set(c.name.toLowerCase(), { id: c.id, name: c.name, imageUri: c.imageUri, manaCost: c.manaCost, typeLine: c.typeLine, oracleText: c.oracleText });
    return m;
  }
  async function postCard(
    card: { id: string; name: string; imageUri: string; manaCost: string | null; typeLine: string | null; oracleText: string | null },
    qty: number
  ): Promise<boolean> {
    const post = await fetch(`/api/decks/${deckId}/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scryfallId: card.id,
        name: card.name,
        imageUri: card.imageUri,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        quantity: qty,
      }),
    });
    return post.ok;
  }
  async function resolveAndAdd(
    name: string,
    qty: number,
    known: ReturnType<typeof poolByName>
  ): Promise<"added" | "notfound" | "error"> {
    try {
      const existing = known.get(name.toLowerCase());
      if (existing) {
        return (await postCard(existing, qty)) ? "added" : "error";
      }
      const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
      if (!res.ok) return "notfound";
      const data = await res.json();
      if (!data?.id) return "notfound";
      const imageUri = data.image_uris?.normal ?? data.card_faces?.[0]?.image_uris?.normal ?? "";
      if (!imageUri) return "error";
      const card = {
        id: data.id,
        name: data.name,
        imageUri,
        manaCost: data.mana_cost ?? null,
        typeLine: data.type_line ?? null,
        oracleText: data.oracle_text ?? null,
      };
      if (!(await postCard(card, qty))) return "error";
      known.set(String(data.name).toLowerCase(), card);
      return "added";
    } catch {
      return "error";
    }
  }

  // ── Tool 1: export — standard "{qty} {name}" decklist.
  const exportText = pool.map((c) => `${c.quantity} ${c.name}`).join("\n");
  async function copyExport() {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked — the textarea is already on screen to copy manually
    }
  }

  // ── Tool 1: import — parse "{qty} {name}" lines, resolve each on Scryfall and
  // add the copies (merging quantities for repeated names).
  async function runImport() {
    const entries: { name: string; qty: number }[] = [];
    const byName = new Map<string, number>();
    for (const raw of importText.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^\s*(\d+)\s*[xX]?\s+(.*)$/);
      const qty = m ? Math.max(1, parseInt(m[1], 10)) : 1;
      const name = (m ? m[2] : line).replace(/\s*\([^)]*\).*$/, "").trim();
      if (!name) continue;
      const k = name.toLowerCase();
      if (byName.has(k)) {
        entries[byName.get(k)!].qty += qty;
      } else {
        byName.set(k, entries.length);
        entries.push({ name, qty });
      }
    }
    if (entries.length === 0) {
      setImportSummary("Nothing to import — paste a decklist first.");
      return;
    }
    setImporting(true);
    setImportSummary(null);
    const known = poolByName();
    let added = 0;
    const notFound: string[] = [];
    for (const { name, qty } of entries) {
      const r = await resolveAndAdd(name, qty, known);
      if (r === "added") added += qty;
      else if (r === "notfound") notFound.push(name);
    }
    await loadPool();
    const parts = [`Added ${added} card${added === 1 ? "" : "s"}`];
    if (notFound.length) parts.push(`${notFound.length} not found: ${notFound.join(", ")}`);
    setImportSummary(parts.join(", ") + ".");
    setImportText("");
    setImporting(false);
  }

  // ── Tool 2: bulk lands — add the chosen quantity of each preset land/staple.
  const landTotal = PRESET_LANDS.reduce((s, l) => s + (landSel[l] ?? 0), 0);
  async function addLands() {
    if (landTotal === 0) return;
    setLandBusy(true);
    setLandSummary(null);
    const known = poolByName();
    let added = 0;
    for (const name of PRESET_LANDS) {
      const qty = landSel[name] ?? 0;
      if (qty <= 0) continue;
      const r = await resolveAndAdd(name, qty, known);
      if (r === "added") added += qty;
    }
    await loadPool();
    setLandSel({});
    setLandSummary(`Added ${added} card${added === 1 ? "" : "s"} to the pool.`);
    setLandBusy(false);
  }

  // ── Tool 3: review — snapshot the pool and open the swipe modal in review mode.
  function startReview() {
    if (pool.length === 0) return;
    setSettingsOpen(false);
    setReviewCards([...pool]);
  }

  // ── Tool 4: AI judge — send the pool to Claude for analysis.
  async function runJudge() {
    setSettingsOpen(false);
    setJudgeOpen(true);
    setJudge(null);
    setJudgeError("");
    setJudgeAdds({});
    if (pool.length === 0) {
      setJudgeError("Add some cards to the pool first.");
      return;
    }
    setJudgeLoading(true);
    try {
      const res = await fetch(`/api/judge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: pool.map((c) => ({ name: c.name, manaCost: c.manaCost, typeLine: c.typeLine, quantity: c.quantity })),
          format: deck?.format,
          commander: deck?.commander,
        }),
      });
      const data = await res.json();
      if (!res.ok) setJudgeError(data.details ?? data.error ?? "AI judge failed");
      else setJudge(data as JudgeResult);
    } catch {
      setJudgeError("Network error");
    }
    setJudgeLoading(false);
  }

  // Tap a suggested "missing" card to add it straight to the pool.
  async function addSuggested(name: string) {
    if (judgeAdds[name] === "adding" || judgeAdds[name] === "added") return;
    setJudgeAdds((m) => ({ ...m, [name]: "adding" }));
    const r = await resolveAndAdd(name, 1, poolByName());
    setJudgeAdds((m) => ({ ...m, [name]: r === "added" ? "added" : "error" }));
    if (r === "added") loadPool();
  }

  const inPool = (cardId: string) => pool.some((c) => c.id === cardId);

  const stats = deckStats(pool);
  const poolColors = ["W", "U", "B", "R", "G"].filter((c) => stats.colors[c] > 0);
  const target = deckTarget(deck?.format);
  const grouped = TYPE_ORDER.map((t) => ({
    t,
    cards: pool.map((c) => c).filter((c) => categoryOf(c.typeLine) === t),
  })).filter((g) => g.cards.length);

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

          {/* pool */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
                The Pool <span style={{ color: "var(--text-dim)", fontWeight: 500, fontStyle: "italic", fontSize: 19 }}>· {stats.count} cards</span>
              </h2>
              {pool.length > 0 && (
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
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              {pool.length === 0 ? (
                <div className="cc-paper" style={{ padding: "50px 20px", textAlign: "center", fontStyle: "italic", color: "var(--ink-soft)" }}>
                  No cards yet — search above to begin filling the pool.
                </div>
              ) : view === "grid" ? (
                <div className="card-grid">
                  {pool.map((card) => (
                    <ClassicCard key={card.dbId} card={card} variant="tile" quantity={card.quantity} onRemove={() => removeCard(card.dbId)} onClick={() => setPreview(card)} />
                  ))}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {grouped.map((g) => (
                    <div key={g.t}>
                      <div className="label-sc" style={{ fontSize: 13, color: "var(--gold)", padding: "0 4px 7px", letterSpacing: ".12em" }}>
                        {g.t}{" "}
                        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-body)", textTransform: "none", letterSpacing: 0 }}>· {g.cards.reduce((s, c) => s + c.quantity, 0)}</span>
                      </div>
                      <div style={{ background: "var(--app-bg2)", borderRadius: 7, padding: 5, boxShadow: "inset 0 0 0 1px rgba(200,155,65,.16)" }}>
                        {g.cards.map((c) => (
                          <ClassicRow key={c.dbId} card={c} quantity={c.quantity} onRemove={() => removeCard(c.dbId)} onClick={() => setPreview(c)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* quick actions — always one tap from the deck */}
            <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              <button onClick={runJudge} style={{ ...actionBtn, flex: "1 1 160px", background: "var(--gold)", color: "#211705", boxShadow: "none" }}>
                ✨ Judge pool
              </button>
              <button onClick={() => { setTool("lands"); setLandSummary(null); }} style={{ ...actionBtn, flex: "1 1 130px" }}>
                🌲 Add lands
              </button>
              <button onClick={startReview} disabled={pool.length === 0} style={{ ...actionBtn, flex: "1 1 130px", opacity: pool.length === 0 ? 0.5 : 1 }}>
                ↩ Review pool
              </button>
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
              <CountRing count={stats.count} target={target} accent="var(--gold)" />
              <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 14 }}>
                <span style={{ color: "var(--text-dim)", fontStyle: "italic" }}>{deck?.format ?? "—"} deck</span>
                <span style={{ color: "var(--text)", fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600 }}>
                  {target - stats.count > 0 ? `${target - stats.count} to go` : "Deck complete"}
                </span>
              </div>
            </div>
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
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(8,6,4,0.74)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 70, animation: "sp-fade .15s ease" }}
          onClick={(e) => e.target === e.currentTarget && setSettingsOpen(false)}
        >
          <div className="cc-black" style={{ padding: 9, width: "100%", maxWidth: 420, animation: "sp-pop .18s ease" }}>
            <div className="cc-brown" style={{ padding: "16px 18px 18px" }}>
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
                  <button type="button" onClick={() => { setTool("export"); setCopied(false); }} style={toolBtn}>
                    ⤓ Export list
                  </button>
                  <button type="button" onClick={() => { setTool("import"); setImportSummary(null); }} style={toolBtn}>
                    ⤒ Import list
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* export / import / lands tool sheet */}
      {tool && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(8,6,4,0.74)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 72, animation: "sp-fade .15s ease" }}
          onClick={(e) => e.target === e.currentTarget && setTool(null)}
        >
          <div className="cc-black" style={{ padding: 9, width: "100%", maxWidth: 460, animation: "sp-pop .18s ease" }}>
            <div className="cc-brown" style={{ padding: "16px 18px 18px" }}>
              <h2 style={{ margin: "0 0 14px", fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--frame-ink)", textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>
                {tool === "export" ? "Export decklist" : tool === "import" ? "Import decklist" : "Add lands & staples"}
              </h2>

              {tool === "export" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontStyle: "italic", color: "rgba(236,225,198,.8)" }}>
                    {pool.length} cards · standard {`{qty} {name}`} format.
                  </p>
                  <textarea readOnly value={exportText} onFocus={(e) => e.currentTarget.select()} className="cc-paper" style={{ ...paperInput, minHeight: 220, fontFamily: "var(--font-mono, monospace)", fontSize: 13.5, resize: "vertical" }} />
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button onClick={() => setTool(null)} style={ghostBtn}>Close</button>
                    <button onClick={copyExport} disabled={pool.length === 0} style={goldBtn}>{copied ? "Copied ✓" : "Copy to clipboard"}</button>
                  </div>
                </div>
              )}

              {tool === "import" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontStyle: "italic", color: "rgba(236,225,198,.8)" }}>
                    Paste a decklist — one card per line (e.g. <code>1 Lightning Bolt</code>). Cards not already in the pool are added.
                  </p>
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    disabled={importing}
                    placeholder={"1 Sol Ring\n1 Lightning Bolt\n1 Counterspell"}
                    className="cc-paper"
                    style={{ ...paperInput, minHeight: 200, fontFamily: "var(--font-mono, monospace)", fontSize: 13.5, resize: "vertical" }}
                  />
                  {importSummary && (
                    <div style={{ fontSize: 13.5, color: "var(--frame-ink)", background: "rgba(0,0,0,.18)", borderRadius: 8, padding: "10px 14px" }}>
                      {importSummary}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button onClick={() => setTool(null)} style={ghostBtn}>Close</button>
                    <button onClick={runImport} disabled={importing || !importText.trim()} style={goldBtn}>
                      {importing ? "Importing…" : "Import"}
                    </button>
                  </div>
                </div>
              )}

              {tool === "lands" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontStyle: "italic", color: "rgba(236,225,198,.8)" }}>
                    Set a quantity for each, then add your whole mana base in one tap.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {PRESET_LANDS.map((l) => {
                      const n = landSel[l] ?? 0;
                      return (
                        <div key={l} style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 10, padding: "5px 6px", borderRadius: 8, background: n > 0 ? "rgba(200,155,65,.12)" : "transparent" }}>
                          <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600, color: "var(--frame-ink)" }}>{l}</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={n === 0 ? "" : n}
                            placeholder="0"
                            onChange={(e) => {
                              const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                              setLandSel((s) => ({ ...s, [l]: v }));
                            }}
                            className="cc-paper"
                            style={{
                              width: 64,
                              padding: "8px 10px",
                              border: "none",
                              outline: "none",
                              borderRadius: 7,
                              fontFamily: "var(--font-display)",
                              fontSize: 16,
                              fontWeight: 700,
                              textAlign: "center",
                              color: "var(--ink)",
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  {landSummary && (
                    <div style={{ fontSize: 13.5, color: "var(--frame-ink)", background: "rgba(0,0,0,.18)", borderRadius: 8, padding: "10px 14px" }}>
                      {landSummary}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
                    <button onClick={() => setTool(null)} style={ghostBtn}>Close</button>
                    <button onClick={addLands} disabled={landBusy || landTotal === 0} style={goldBtn}>
                      {landBusy ? "Adding…" : landTotal > 0 ? `Add ${landTotal} land${landTotal === 1 ? "" : "s"}` : "Add to pool"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* review-pool swipe modal */}
      {reviewCards && reviewCards.length > 0 && (
        <SwipeModal
          variant="review"
          cards={reviewCards}
          query="Reviewing your pool"
          onAdd={() => {}}
          onRemove={(card) => {
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

      {/* AI pool judge */}
      {judgeOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(8,6,4,0.78)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 72, animation: "sp-fade .15s ease" }}
          onClick={(e) => e.target === e.currentTarget && setJudgeOpen(false)}
        >
          <div className="cc-black" style={{ padding: 9, width: "100%", maxWidth: 520, maxHeight: "88vh", display: "flex", animation: "sp-pop .18s ease" }}>
            <div className="cc-brown" style={{ padding: "16px 18px 18px", overflowY: "auto", width: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--frame-ink)", textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>
                  AI Pool Judge ✨
                </h2>
                <button onClick={() => setJudgeOpen(false)} style={{ ...ghostBtn, padding: "6px 12px" }}>Close</button>
              </div>

              {judgeLoading && (
                <p style={{ margin: 0, fontStyle: "italic", color: "rgba(236,225,198,.85)", fontSize: 15 }}>
                  Consulting the oracle… analyzing {pool.length} cards.
                </p>
              )}
              {judgeError && !judgeLoading && (
                <div style={{ color: "#f4dccd", fontSize: 14, fontStyle: "italic", padding: "10px 14px", background: "rgba(207,125,94,.18)", borderRadius: 8 }}>
                  {judgeError}
                </div>
              )}

              {judge && !judgeLoading && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {judge.summary && (
                    <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "var(--frame-ink)" }}>{judge.summary}</p>
                  )}
                  {judge.working.length > 0 && (
                    <JudgeSection title="Working well" color="#9bbf6e">
                      {judge.working.map((w, i) => <JudgeLi key={i}>{w}</JudgeLi>)}
                    </JudgeSection>
                  )}
                  {judge.cuts.length > 0 && (
                    <JudgeSection title="Weakest — consider cutting" color="#cf7d5e">
                      {judge.cuts.map((w, i) => <JudgeLi key={i}>{w}</JudgeLi>)}
                    </JudgeSection>
                  )}
                  {judge.missing.length > 0 && (
                    <JudgeSection title="Key cards missing — tap to add" color="var(--gold)">
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                        {judge.missing.map((name) => {
                          const st = judgeAdds[name];
                          return (
                            <button
                              key={name}
                              type="button"
                              onClick={() => addSuggested(name)}
                              disabled={st === "adding" || st === "added"}
                              style={{
                                padding: "7px 13px",
                                borderRadius: 16,
                                border: "none",
                                cursor: st === "added" || st === "adding" ? "default" : "pointer",
                                fontFamily: "var(--font-body)",
                                fontSize: 14,
                                background: st === "added" ? "rgba(155,191,110,.25)" : "rgba(0,0,0,.22)",
                                color: "var(--frame-ink)",
                                boxShadow: "inset 0 0 0 1px rgba(236,225,198,.25)",
                              }}
                            >
                              {name}{" "}
                              <span style={{ opacity: 0.85 }}>
                                {st === "adding" ? "…" : st === "added" ? "✓" : st === "error" ? "✕" : "+"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </JudgeSection>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
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

function JudgeSection({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label-sc" style={{ fontSize: 12, color, letterSpacing: ".1em", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>{children}</div>
    </div>
  );
}

function JudgeLi({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 14, lineHeight: 1.45, color: "var(--frame-ink)" }}>
      <span style={{ color: "rgba(236,225,198,.5)", flexShrink: 0 }}>•</span>
      <span>{children}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span className="label-sc" style={{ fontSize: 11.5, color: "rgba(236,225,198,.75)", letterSpacing: ".1em" }}>{label}</span>
      {children}
    </label>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "#f4dccd", fontSize: 13.5, fontStyle: "italic", padding: "10px 14px", background: "rgba(207,125,94,.16)", borderRadius: 8, boxShadow: "inset 0 0 0 1px rgba(207,125,94,.4)" }}>
      {children}
    </div>
  );
}

const paperInput: React.CSSProperties = {
  flex: 1,
  padding: "12px 15px",
  border: "none",
  outline: "none",
  fontFamily: "var(--font-body)",
  fontSize: 16,
  color: "var(--ink)",
  borderRadius: 6,
  width: "100%",
  minWidth: 0,
};

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

const actionBtn: React.CSSProperties = {
  background: "var(--app-bg2)",
  border: "none",
  boxShadow: "inset 0 0 0 1px rgba(200,155,65,.3)",
  borderRadius: 9,
  color: "var(--text)",
  padding: "13px 16px",
  cursor: "pointer",
  fontFamily: "var(--font-display)",
  fontSize: 16,
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const toolBtn: React.CSSProperties = {
  background: "rgba(0,0,0,.22)",
  border: "none",
  boxShadow: "inset 0 0 0 1px rgba(236,225,198,.22)",
  borderRadius: 8,
  color: "var(--frame-ink)",
  padding: "11px 12px",
  cursor: "pointer",
  fontFamily: "var(--font-display)",
  fontSize: 15,
  fontWeight: 600,
  textAlign: "center",
};

const ghostBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  boxShadow: "inset 0 0 0 1px rgba(236,225,198,.3)",
  borderRadius: 7,
  color: "var(--frame-ink)",
  padding: "9px 18px",
  cursor: "pointer",
  fontFamily: "var(--font-display)",
  fontSize: 15,
  fontWeight: 600,
};

const goldBtn: React.CSSProperties = {
  background: "var(--gold)",
  border: "none",
  borderRadius: 7,
  color: "var(--accent-ink)",
  padding: "9px 20px",
  cursor: "pointer",
  fontFamily: "var(--font-display)",
  fontWeight: 700,
  fontSize: 15,
};
