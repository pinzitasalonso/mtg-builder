"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import SwipeDeck from "@/components/SwipeDeck";
import { LogoMark } from "@/components/Logo";
import {
  CardArt,
  ManaCost,
  ColorPips,
  StatCard,
  ManaCurve,
  ColorBar,
  TypeBreakdown,
  CountRing,
  deckStats,
  categoryOf,
  colorsOf,
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
}

interface Deck {
  id: number;
  name: string;
  format: string;
  commander: string | null;
}

const COLORS = [
  { code: "w", label: "W", hex: "#f9faf4", textHex: "#1a1a1a" },
  { code: "u", label: "U", hex: "#0e68ab", textHex: "#ffffff" },
  { code: "b", label: "B", hex: "#1a1718", textHex: "#ffffff" },
  { code: "r", label: "R", hex: "#d3202a", textHex: "#ffffff" },
  { code: "g", label: "G", hex: "#00733e", textHex: "#ffffff" },
];

const TYPES = [
  "Creature", "Instant", "Sorcery", "Enchantment",
  "Artifact", "Planeswalker", "Saga", "Land", "Battle",
  "Legendary", "Equipment", "Aura",
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

const AI_SUGGESTIONS = ["blue clones", "cheap card draw", "board wipes", "ramp"];

type SearchMode = "ai" | "scryfall" | "name";

const FILTER_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-dim)",
  marginBottom: 9,
};

/* The query text is the single source of truth. Chips toggle Scryfall tokens
   directly in and out of the input, and their selected state is derived from
   whatever is currently typed there. */
const ID_RE = /^id:([wubrg]+)$/i;

function queryTokens(query: string): string[] {
  return query.split(/\s+/).filter(Boolean);
}

function toggleToken(query: string, token: string): string {
  const tokens = queryTokens(query);
  const i = tokens.indexOf(token);
  if (i >= 0) tokens.splice(i, 1);
  else tokens.push(token);
  return tokens.join(" ");
}

function hasToken(query: string, token: string): boolean {
  return queryTokens(query).includes(token);
}

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

/* Reusable pill toggle */
function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={{
        flexShrink: 0,
        padding: "7px 13px",
        borderRadius: 20,
        border: "none",
        background: active ? "var(--accent)" : "rgba(255,255,255,.05)",
        color: active ? "var(--accent-ink)" : "var(--text-muted)",
        boxShadow: active ? "none" : "inset 0 0 0 1px var(--line)",
        cursor: "pointer",
        fontSize: 12.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
        transition: "background 0.12s, color 0.12s",
      }}
    >
      {children}
    </button>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={FILTER_LABEL}>{label}</div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

/* ---------- pool card: grid tile ---------- */
function CardTile({ card, onRemove, onClick }: { card: PoolCard; onRemove: () => void; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const cardColors = colorsOf(card.manaCost);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        position: "relative",
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
        background: "var(--surface)",
        boxShadow: hover
          ? "0 12px 30px -10px rgba(0,0,0,.7), inset 0 0 0 1px var(--accent)"
          : "0 2px 8px rgba(0,0,0,.35), inset 0 0 0 1px var(--line)",
        transform: hover ? "translateY(-3px)" : "none",
        transition: "transform .18s ease, box-shadow .18s ease",
      }}
    >
      <div style={{ position: "relative", aspectRatio: "1 / 1.02" }}>
        <CardArt
          name={card.name}
          src={card.imageUri || undefined}
          colors={cardColors}
          version="art_crop"
          radius={0}
          style={{ position: "absolute", inset: 0 }}
        />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,9,11,.05) 40%, rgba(8,9,11,.78) 100%)" }} />
        <div style={{ position: "absolute", top: 8, right: 8 }}>
          <ManaCost cost={card.manaCost} size={17} />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            width: 24,
            height: 24,
            borderRadius: 7,
            border: "none",
            cursor: "pointer",
            background: "rgba(8,9,11,.62)",
            color: "#fff",
            opacity: hover ? 1 : 0,
            transition: "opacity .15s",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            lineHeight: 1,
          }}
          aria-label="Remove"
        >
          ✕
        </button>
      </div>
      <div style={{ padding: "9px 11px 11px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {card.name}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {card.typeLine}
        </div>
      </div>
    </div>
  );
}

/* ---------- pool card: compact list row ---------- */
function CardRow({ card, onRemove, onClick }: { card: PoolCard; onRemove: () => void; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "34px 1fr auto auto",
        alignItems: "center",
        gap: 12,
        padding: "7px 10px 7px 7px",
        borderRadius: 9,
        cursor: "pointer",
        background: hover ? "var(--surface2)" : "transparent",
        boxShadow: hover ? "inset 0 0 0 1px var(--line)" : "none",
        transition: "background .12s",
      }}
    >
      <CardArt name={card.name} src={card.imageUri || undefined} colors={colorsOf(card.manaCost)} radius={6} style={{ width: 34, height: 34 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {card.name}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {card.typeLine}
        </div>
      </div>
      <ManaCost cost={card.manaCost} size={16} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          border: "none",
          cursor: "pointer",
          background: hover ? "rgba(255,255,255,.06)" : "transparent",
          color: "var(--text-dim)",
          opacity: hover ? 1 : 0,
          transition: "opacity .12s",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
        }}
        aria-label="Remove"
      >
        ✕
      </button>
    </div>
  );
}

export default function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const deckId = Number(id);

  const [deck, setDeck] = useState<Deck | null>(null);
  const [pool, setPool] = useState<PoolCard[]>([]);
  const [searchResults, setSearchResults] = useState<SearchCard[]>([]);
  const [searchId, setSearchId] = useState(0);
  const [truncated, setTruncated] = useState(false);
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

  const loadPool = useCallback(async () => {
    const res = await fetch(`/api/decks/${deckId}/cards`);
    const data = await res.json();
    setPool(
      data.map((c: { id: number; scryfallId: string; name: string; imageUri: string; manaCost: string | null; typeLine: string | null; oracleText: string | null }) => ({
        dbId: c.id,
        id: c.scryfallId,
        name: c.name,
        imageUri: c.imageUri,
        manaCost: c.manaCost,
        typeLine: c.typeLine,
        oracleText: c.oracleText,
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
        .filter(
          (t) =>
            !ID_RE.test(t) &&
            !/^t:/i.test(t) &&
            !/^mv(=|>=)/i.test(t) &&
            !/^r:/i.test(t) &&
            !/^f:/i.test(t)
        )
        .join(" ")
    );
  }

  const activeFilterCount =
    COLORS.filter((c) => colorActive(query, c.code)).length +
    TYPES.filter((t) => hasToken(query, `t:${t.toLowerCase()}`)).length +
    MANA_VALUES.filter((v) => hasToken(query, v >= 7 ? "mv>=7" : `mv=${v}`)).length +
    RARITIES.filter((r) => hasToken(query, `r:${r.code}`)).length +
    FORMATS.filter((f) => hasToken(query, `f:${f.code}`)).length;

  /* Core search, callable from the form or from a suggestion chip. */
  const runSearch = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setSearching(true);
      setSearchError("");
      setSearchResults([]);
      setGeneratedQuery("");
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
          setSearchResults(data.cards);
          setGeneratedQuery(data.query);
          setTruncated(Boolean(data.truncated));
          setSearchId((n) => n + 1);
        }
      } catch {
        setSearchError("Network error");
      }
      setSearching(false);
    },
    [searchMode]
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

  const inPool = (cardId: string) => pool.some((c) => c.id === cardId);

  const stats = deckStats(pool);
  const poolColors = ["W", "U", "B", "R", "G"].filter((c) => stats.colors[c] > 0);
  const target = deckTarget(deck?.format);
  const grouped = TYPE_ORDER.map((t) => ({
    t,
    cards: pool.map((c, i) => ({ c, i })).filter(({ c }) => categoryOf(c.typeLine) === t),
  })).filter((g) => g.cards.length);

  const iconBtn: React.CSSProperties = {
    width: 38,
    height: 38,
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    background: "rgba(255,255,255,.05)",
    color: "var(--text-muted)",
    fontSize: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };

  return (
    <main style={{ flex: 1 }}>
      {/* top bar */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "color-mix(in srgb, var(--bg) 82%, transparent)",
          backdropFilter: "blur(14px)",
          boxShadow: "0 1px 0 var(--line)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <Link href="/" aria-label="Back to decks" style={{ ...iconBtn, color: "var(--text)", textDecoration: "none" }}>
            ‹
          </Link>
          <Link href="/" aria-label="Spellpool home" style={{ display: "flex", flexShrink: 0 }}>
            <LogoMark size={22} />
          </Link>
          <div style={{ width: 38, height: 38, borderRadius: 10, overflow: "hidden", flex: "none" }}>
            <CardArt name={deck?.commander || deck?.name} colors={poolColors} radius={10} style={{ width: 38, height: 38 }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 19,
                  fontWeight: 700,
                  color: "var(--text)",
                  letterSpacing: "-.01em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {deck?.name ?? "…"}
              </span>
              {poolColors.length > 0 && <ColorPips colors={poolColors} size={15} />}
            </div>
            {deck && (
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                {deck.format}
                {deck.commander ? ` · ${deck.commander}` : ""}
              </div>
            )}
          </div>
        </div>
        <button style={iconBtn} title="Deck settings" aria-label="Deck settings">
          ⚙︎
        </button>
      </header>

      <div className="deck-layout" style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 20px 80px" }}>
        {/* main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
          {/* search panel */}
          <div style={{ background: "var(--surface)", borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--line)", padding: 16 }}>
            {/* segmented control */}
            <div style={{ display: "inline-flex", padding: 3, background: "rgba(8,9,11,.5)", borderRadius: 11, gap: 2, marginBottom: 14 }}>
              {(["ai", "scryfall", "name"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setSearchMode(mode)}
                  style={{
                    padding: "7px 16px",
                    borderRadius: 8,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: searchMode === mode ? "var(--accent)" : "transparent",
                    color: searchMode === mode ? "var(--accent-ink)" : "var(--text-muted)",
                    transition: "all .14s",
                  }}
                >
                  <span>{mode === "ai" ? "✦" : mode === "scryfall" ? "⚡" : "Aa"}</span>
                  {mode === "ai" ? "AI" : mode === "scryfall" ? "Scryfall" : "Name"}
                </button>
              ))}
            </div>

            {/* scryfall filters */}
            {searchMode === "scryfall" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={FILTER_LABEL}>Colors</div>
                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 12, cursor: "pointer", padding: "0 0 9px" }}
                    >
                      Clear all ({activeFilterCount})
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: -6 }}>
                  {COLORS.map((color) => {
                    const selected = colorActive(query, color.code);
                    return (
                      <button
                        key={color.code}
                        type="button"
                        onClick={() => setQuery((q) => toggleColor(q, color.code))}
                        title={`Color identity: ${color.label}`}
                        aria-pressed={selected}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: "50%",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: selected ? color.hex : "#2a2d33",
                          color: selected ? color.textHex : "#8b9099",
                          fontWeight: 800,
                          fontSize: 13,
                          boxShadow: selected ? "inset 0 0 0 2px var(--accent)" : "inset 0 0 0 1px #3e4148",
                          transform: selected ? "scale(1.05)" : "scale(1)",
                          transition: "all .12s",
                        }}
                      >
                        {color.label}
                      </button>
                    );
                  })}
                </div>
                <FilterRow label="Card type">
                  {TYPES.map((type) => {
                    const token = `t:${type.toLowerCase()}`;
                    return (
                      <Chip key={type} active={hasToken(query, token)} onClick={() => setQuery((q) => toggleToken(q, token))}>
                        {type}
                      </Chip>
                    );
                  })}
                </FilterRow>
                <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
                  <FilterRow label="Mana value">
                    {MANA_VALUES.map((v) => {
                      const token = v >= 7 ? "mv>=7" : `mv=${v}`;
                      return (
                        <Chip key={v} active={hasToken(query, token)} onClick={() => setQuery((q) => toggleToken(q, token))} title={v >= 7 ? "Mana value 7 or more" : `Mana value ${v}`}>
                          {v >= 7 ? "7+" : v}
                        </Chip>
                      );
                    })}
                  </FilterRow>
                  <FilterRow label="Rarity">
                    {RARITIES.map((r) => {
                      const token = `r:${r.code}`;
                      return (
                        <Chip key={r.code} active={hasToken(query, token)} onClick={() => setQuery((q) => toggleToken(q, token))}>
                          {r.label}
                        </Chip>
                      );
                    })}
                  </FilterRow>
                </div>
                <FilterRow label="Format legality">
                  {FORMATS.map((f) => {
                    const token = `f:${f.code}`;
                    return (
                      <Chip key={f.code} active={hasToken(query, token)} onClick={() => setQuery((q) => toggleToken(q, token))}>
                        {f.label}
                      </Chip>
                    );
                  })}
                </FilterRow>
              </div>
            )}

            {/* name mode */}
            {searchMode === "name" ? (
              <form onSubmit={addByName} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    placeholder="Exact or fuzzy card name…"
                    value={nameInput}
                    onChange={(e) => {
                      setNameInput(e.target.value);
                      setNameError("");
                    }}
                    disabled={nameAdding}
                    style={searchInputStyle(nameError ? "var(--danger)" : undefined)}
                  />
                  <button type="submit" disabled={nameAdding || !nameInput.trim()} style={searchBtnStyle(nameAdding)}>
                    {nameAdding ? "Adding…" : "Add"}
                  </button>
                </div>
                {nameError && <ErrorNote>{nameError}</ErrorNote>}
              </form>
            ) : (
              <>
                <form onSubmit={onSubmitSearch} style={{ display: "flex", gap: 10 }}>
                  <input
                    placeholder={searchMode === "ai" ? "Describe cards to find…" : "Scryfall syntax: t:wizard id:u…"}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={searching}
                    style={searchInputStyle(undefined, searchMode === "scryfall")}
                  />
                  <button type="submit" disabled={searching || !query.trim()} style={searchBtnStyle(searching)}>
                    {searchMode === "ai" && <span style={{ marginRight: 6 }}>✦</span>}
                    {searching ? "Searching…" : "Search"}
                  </button>
                </form>
                {searchMode === "ai" && (
                  <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
                    {AI_SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => onSuggestion(s)}
                        disabled={searching}
                        style={{
                          fontSize: 12,
                          padding: "5px 11px",
                          borderRadius: 16,
                          border: "none",
                          cursor: searching ? "default" : "pointer",
                          background: "rgba(255,255,255,.04)",
                          color: "var(--text-dim)",
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

            {generatedQuery && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
                {searchMode === "ai" ? (
                  <>
                    <span style={{ color: "var(--accent)", fontWeight: 600 }}>What I looked for · </span>
                    {generatedQuery}
                  </>
                ) : (
                  <>
                    Scryfall query:{" "}
                    <code style={{ color: "var(--accent)", background: "var(--surface2)", padding: "2px 6px", borderRadius: 4, fontFamily: "var(--font-mono)" }}>
                      {generatedQuery}
                    </code>
                  </>
                )}
              </div>
            )}
            {searchError && <div style={{ marginTop: 12 }}><ErrorNote>{searchError}</ErrorNote></div>}
          </div>

          {/* search results — swipe to triage */}
          {searchResults.length > 0 && (
            <div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, gap: 8 }}>
                <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
                  Results <span style={{ color: "var(--text-dim)", fontWeight: 500 }}>· {searchResults.length}</span>
                </h2>
                {truncated && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>showing the first {searchResults.length}</span>}
              </div>
              <SwipeDeck
                key={searchId}
                cards={searchResults}
                inPool={inPool}
                onAdd={addCard}
                onDiscard={() => {}}
                onInfo={setPreview}
                onRestart={() => setSearchId((n) => n + 1)}
              />
            </div>
          )}

          {/* pool */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
                Pool <span style={{ color: "var(--text-dim)", fontWeight: 500 }}>· {pool.length} card{pool.length !== 1 ? "s" : ""}</span>
              </h2>
              {pool.length > 0 && (
                <div style={{ display: "inline-flex", padding: 3, background: "rgba(8,9,11,.5)", borderRadius: 9, gap: 2, boxShadow: "inset 0 0 0 1px var(--line)" }}>
                  {([["grid", "▦"], ["list", "≣"]] as const).map(([v, ic]) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      style={{
                        width: 34,
                        height: 30,
                        borderRadius: 7,
                        border: "none",
                        cursor: "pointer",
                        fontSize: 15,
                        background: view === v ? "rgba(255,255,255,.1)" : "transparent",
                        color: view === v ? "var(--text)" : "var(--text-dim)",
                      }}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {pool.length === 0 ? (
              <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--text-dim)", borderRadius: 14, boxShadow: "inset 0 0 0 1px var(--line)" }}>
                No cards yet — search above to start filling the pool.
              </div>
            ) : view === "grid" ? (
              <div className="card-grid">
                {pool.map((card) => (
                  <CardTile key={card.dbId} card={card} onRemove={() => removeCard(card.dbId)} onClick={() => setPreview(card)} />
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {grouped.map((g) => (
                  <div key={g.t}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px 6px", fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)" }}>
                      {g.t} <span style={{ color: "var(--text-dim)", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{g.cards.length}</span>
                    </div>
                    <div style={{ background: "var(--surface)", borderRadius: 12, boxShadow: "inset 0 0 0 1px var(--line)", padding: 5 }}>
                      {g.cards.map(({ c }) => (
                        <CardRow key={c.dbId} card={c} onRemove={() => removeCard(c.dbId)} onClick={() => setPreview(c)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* stats sidebar */}
        <aside className="deck-sidebar" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <StatCard
            label="Overview"
            right={
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                avg MV <b style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{stats.avgMv.toFixed(1)}</b>
              </span>
            }
          >
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <CountRing count={stats.count} target={target} accent="var(--accent)" />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
                <span style={{ color: "var(--text-dim)" }}>{deck?.format ?? "—"} deck</span>
                <span style={{ color: "var(--text-muted)" }}>
                  {target - stats.count > 0 ? `${target - stats.count} to go` : "Deck complete"}
                </span>
              </div>
            </div>
          </StatCard>
          <StatCard label="Mana curve">
            <ManaCurve curve={stats.curve} accent="var(--accent)" />
          </StatCard>
          <StatCard label="Colors">
            {stats.count > 0 ? <ColorBar colors={stats.colors} /> : <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>No cards yet.</span>}
          </StatCard>
          <StatCard label="Card types">
            {stats.types.length > 0 ? <TypeBreakdown types={stats.types} accent="var(--accent)" /> : <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>No cards yet.</span>}
          </StatCard>
        </aside>
      </div>

      {/* card preview modal */}
      {preview && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
            animation: "sp-fade .15s ease",
          }}
          onClick={() => setPreview(null)}
        >
          <div
            style={{
              background: "var(--surface)",
              boxShadow: "inset 0 0 0 1px var(--line)",
              borderRadius: 16,
              padding: 20,
              maxWidth: 360,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              animation: "sp-pop .18s ease",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {preview.imageUri && (
              <Image
                src={preview.imageUri}
                alt={preview.name}
                width={320}
                height={446}
                style={{ borderRadius: 8, width: "100%", height: "auto" }}
                unoptimized
              />
            )}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 16 }}>{preview.name}</span>
                <ManaCost cost={preview.manaCost} size={18} />
              </div>
              {preview.typeLine && <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{preview.typeLine}</div>}
              {preview.oracleText && <div style={{ fontSize: 13, marginTop: 8, color: "var(--text)", lineHeight: 1.5 }}>{preview.oracleText}</div>}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setPreview(null)} style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-muted)", padding: "9px 0", cursor: "pointer" }}>
                Close
              </button>
              {!inPool(preview.id) ? (
                <button
                  onClick={() => {
                    addCard(preview);
                    setPreview(null);
                  }}
                  style={{ flex: 1, background: "var(--accent)", border: "none", borderRadius: 8, color: "var(--accent-ink)", fontWeight: 700, padding: "9px 0", cursor: "pointer" }}
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
                  style={{ flex: 1, background: "var(--danger)", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, padding: "9px 0", cursor: "pointer" }}
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

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "var(--danger)", fontSize: 13, padding: "10px 14px", background: "rgba(224,121,90,.1)", borderRadius: 10, boxShadow: "inset 0 0 0 1px rgba(224,121,90,.3)" }}>
      {children}
    </div>
  );
}

function searchInputStyle(borderColor?: string, mono?: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "13px 15px",
    borderRadius: 11,
    border: "none",
    outline: "none",
    background: "rgba(8,9,11,.5)",
    color: "var(--text)",
    fontSize: 16,
    fontFamily: mono ? "var(--font-mono)" : "inherit",
    boxShadow: `inset 0 0 0 1px ${borderColor || "var(--line)"}`,
    minWidth: 0,
  };
}

function searchBtnStyle(busy: boolean): React.CSSProperties {
  return {
    padding: "0 22px",
    borderRadius: 11,
    border: "none",
    cursor: busy ? "wait" : "pointer",
    background: "var(--accent)",
    color: "var(--accent-ink)",
    fontWeight: 700,
    fontSize: 14,
    whiteSpace: "nowrap",
    opacity: busy ? 0.7 : 1,
    display: "flex",
    alignItems: "center",
  };
}
