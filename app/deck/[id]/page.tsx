"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import SwipeDeck from "@/components/SwipeDeck";

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

/* #1: MTG mana pip colors */
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

type SearchMode = "ai" | "scryfall";

const FILTER_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 8,
};

/* The query text is the single source of truth. Chips toggle Scryfall tokens
   directly in and out of the input, and their selected state is derived from
   whatever is currently typed there. */

/* A single color-identity token, e.g. id:uw */
const ID_RE = /^id:([wubrg]+)$/i;

/* Split a query string into whitespace-separated tokens */
function queryTokens(query: string): string[] {
  return query.split(/\s+/).filter(Boolean);
}

/* Toggle a standalone token (e.g. t:wizard) in/out of the query */
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

/* Toggle one color letter inside the (single) id: identity token */
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
        padding: "0 13px",
        height: 38,
        borderRadius: 19,
        border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
        background: active ? "var(--accent)" : "var(--surface2)",
        color: active ? "#111" : "var(--text-muted)",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        whiteSpace: "nowrap",
        transition: "background 0.12s, color 0.12s, border-color 0.12s",
      }}
    >
      {children}
    </button>
  );
}

/* A labeled, horizontally scrollable row of chips */
function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={FILTER_LABEL}>{label}</div>
      <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 2 }}>
        {children}
      </div>
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
  const [filtersOpen, setFiltersOpen] = useState(true);
  /* #2: AI vs Scryfall mode toggle, default AI */
  const [searchMode, setSearchMode] = useState<SearchMode>("ai");

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

  /* Strip every known filter token, leaving any free-text the user typed */
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

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError("");
    setSearchResults([]);
    setGeneratedQuery("");
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /* #3: send the input text as-is; chips already wrote their syntax into it */
        body: JSON.stringify({ prompt: query, mode: searchMode }),
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
  }

  async function addCard(card: SearchCard) {
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
  }

  async function removeCard(dbId: number) {
    await fetch(`/api/decks/${deckId}/cards/${dbId}`, { method: "DELETE" });
    loadPool();
  }

  const inPool = (id: string) => pool.some((c) => c.id === id);

  return (
    <main className="container" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* #7: Header with styled back chevron and deck settings button */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        {/* #7: styled ‹ back chevron */}
        <Link
          href="/"
          aria-label="Back to decks"
          style={{
            color: "var(--text-muted)",
            textDecoration: "none",
            fontSize: 26,
            lineHeight: 1,
            fontWeight: 300,
            display: "flex",
            alignItems: "center",
            padding: "8px",
            margin: "-8px",
            borderRadius: 8,
          }}
        >
          ‹
        </Link>
        <div style={{ flex: 1 }}>
          {/* #4: heading inherits white (var(--text)) — no explicit color override needed */}
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{deck?.name ?? "…"}</h1>
          {deck && (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {deck.format}{deck.commander ? ` · ${deck.commander}` : ""}
            </div>
          )}
        </div>
        {/* #7: deck settings button replaces ⋯ */}
        <button
          title="Deck settings"
          aria-label="Deck settings"
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 16,
            padding: "6px 10px",
            display: "flex",
            alignItems: "center",
            lineHeight: 1,
          }}
        >
          ⚙︎
        </button>
      </div>

      {/* #2: AI vs Scryfall mode toggle pill */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div
          style={{
            display: "inline-flex",
            background: "var(--surface2)",
            borderRadius: 20,
            padding: 3,
            gap: 2,
          }}
        >
          {(["ai", "scryfall"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setSearchMode(mode)}
              style={{
                padding: "6px 14px",
                borderRadius: 17,
                border: "none",
                background: searchMode === mode ? "var(--accent)" : "transparent",
                color: searchMode === mode ? "#111" : "var(--text-muted)",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                transition: "background 0.15s",
              }}
            >
              {mode === "ai" ? "✨ AI" : "⚡ Scryfall"}
            </button>
          ))}
        </div>
      </div>

      {/* #1 + #2: Filters live above the search input and only appear in Scryfall
          mode — in AI mode you just describe what you want in plain language. */}
      {searchMode === "scryfall" && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            marginBottom: 10,
            overflow: "hidden",
          }}
        >
          {/* Panel header */}
          <div
            onClick={() => setFiltersOpen((o) => !o)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 14px",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700 }}>Filters</span>
            {activeFilterCount > 0 && (
              <span
                style={{
                  background: "var(--accent)",
                  color: "#111",
                  fontSize: 11,
                  fontWeight: 800,
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 5px",
                }}
              >
                {activeFilterCount}
              </span>
            )}
            <span style={{ flex: 1 }} />
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearAllFilters();
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                  padding: "4px 6px",
                }}
              >
                Clear all
              </button>
            )}
            <span
              style={{
                transform: filtersOpen ? "rotate(180deg)" : "none",
                transition: "transform 0.15s",
                color: "var(--text-muted)",
                fontSize: 11,
              }}
            >
              ▾
            </span>
          </div>

          {filtersOpen && (
            <div
              style={{
                padding: "2px 14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              {/* Colors — tapping toggles a letter inside the id: identity token */}
              <div>
                <div style={FILTER_LABEL}>Colors</div>
                <div style={{ display: "flex", gap: 0, alignItems: "center" }}>
                  {COLORS.map((color) => {
                    const selected = colorActive(query, color.code);
                    return (
                      <button
                        key={color.code}
                        type="button"
                        onClick={() => setQuery((q) => toggleColor(q, color.code))}
                        title={`Color identity: ${color.label}`}
                        aria-label={`Filter by ${color.label}`}
                        aria-pressed={selected}
                        style={{
                          width: 44,
                          height: 44,
                          padding: 0,
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <div
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: "50%",
                            background: selected ? color.hex : "#2a2d33",
                            color: selected ? color.textHex : "#8b9099",
                            fontWeight: 800,
                            fontSize: 13,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            border: selected
                              ? color.code === "w"
                                ? "2px solid #ccc"
                                : "2px solid transparent"
                              : "2px solid #3e4148",
                            transition: "background 0.12s, color 0.12s",
                          }}
                        >
                          {color.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Card type */}
              <FilterRow label="Card type">
                {TYPES.map((type) => {
                  const token = `t:${type.toLowerCase()}`;
                  return (
                    <Chip
                      key={type}
                      active={hasToken(query, token)}
                      onClick={() => setQuery((q) => toggleToken(q, token))}
                    >
                      {type}
                    </Chip>
                  );
                })}
              </FilterRow>

              {/* Mana value */}
              <FilterRow label="Mana value">
                {MANA_VALUES.map((v) => {
                  const token = v >= 7 ? "mv>=7" : `mv=${v}`;
                  return (
                    <Chip
                      key={v}
                      active={hasToken(query, token)}
                      onClick={() => setQuery((q) => toggleToken(q, token))}
                      title={v >= 7 ? "Mana value 7 or more" : `Mana value ${v}`}
                    >
                      {v >= 7 ? "7+" : v}
                    </Chip>
                  );
                })}
              </FilterRow>

              {/* Rarity */}
              <FilterRow label="Rarity">
                {RARITIES.map((r) => {
                  const token = `r:${r.code}`;
                  return (
                    <Chip
                      key={r.code}
                      active={hasToken(query, token)}
                      onClick={() => setQuery((q) => toggleToken(q, token))}
                    >
                      {r.label}
                    </Chip>
                  );
                })}
              </FilterRow>

              {/* Format legality */}
              <FilterRow label="Format legality">
                {FORMATS.map((f) => {
                  const token = `f:${f.code}`;
                  return (
                    <Chip
                      key={f.code}
                      active={hasToken(query, token)}
                      onClick={() => setQuery((q) => toggleToken(q, token))}
                    >
                      {f.label}
                    </Chip>
                  );
                })}
              </FilterRow>
            </div>
          )}
        </div>
      )}

      {/* #2: Search input sits below the filters */}
      <form onSubmit={search} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          /* #2: placeholder changes by mode */
          placeholder={
            searchMode === "ai"
              ? "Describe cards to find…"
              : "Type Scryfall syntax: t:wizard id:u…"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={searching}
          style={{
            flex: 1,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 14px",
            color: "var(--text)",
            fontSize: 16,
            outline: "none",
            minWidth: 0,
          }}
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          style={{
            background: "var(--accent)",
            border: "none",
            borderRadius: 10,
            color: "#111",
            fontWeight: 700,
            padding: "12px 18px",
            cursor: searching ? "wait" : "pointer",
            fontSize: 14,
            whiteSpace: "nowrap",
            opacity: searching ? 0.7 : 1,
          }}
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {generatedQuery && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          Scryfall query:{" "}
          <code style={{ color: "var(--accent)", background: "var(--surface2)", padding: "2px 6px", borderRadius: 4 }}>
            {generatedQuery}
          </code>
        </div>
      )}

      {searchError && (
        <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10, padding: "10px 14px", background: "#2a1414", borderRadius: 8, border: "1px solid #5a2020" }}>
          {searchError}
        </div>
      )}

      {/* Search results — swipe to triage */}
      {searchResults.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 14,
              gap: 8,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text-muted)" }}>
              Results ({searchResults.length})
            </h2>
            {truncated && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                showing the first {searchResults.length}
              </span>
            )}
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

      {/* Pool */}
      <div>
        <h2 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700, color: "var(--text-muted)" }}>
          Pool ({pool.length} card{pool.length !== 1 ? "s" : ""})
        </h2>
        {pool.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: 14, margin: 0 }}>
            No cards in pool yet. Search and add some above.
          </p>
        ) : (
          <div className="card-grid">
            {pool.map((card) => (
              <div key={card.dbId} style={{ position: "relative" }}>
                <div
                  style={{ cursor: "pointer", borderRadius: 8, overflow: "hidden" }}
                  onClick={() => setPreview(card)}
                >
                  {card.imageUri ? (
                    <Image
                      src={card.imageUri}
                      alt={card.name}
                      width={140}
                      height={195}
                      style={{ display: "block", width: "100%", height: "auto" }}
                      unoptimized
                    />
                  ) : (
                    <div style={{ width: "100%", aspectRatio: "5/7", background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--text-muted)", padding: 8, textAlign: "center" }}>
                      {card.name}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => removeCard(card.dbId)}
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: "none",
                    background: "rgba(0,0,0,0.6)",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                    backdropFilter: "blur(4px)",
                  }}
                  title="Remove from pool"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Card preview modal */}
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
          }}
          onClick={() => setPreview(null)}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: 20,
              maxWidth: 360,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 14,
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
              <div style={{ fontWeight: 700, fontSize: 16 }}>{preview.name}</div>
              {preview.manaCost && <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{preview.manaCost}</div>}
              {preview.typeLine && <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{preview.typeLine}</div>}
              {preview.oracleText && (
                <div style={{ fontSize: 13, marginTop: 8, color: "var(--text)", lineHeight: 1.5 }}>
                  {preview.oracleText}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setPreview(null)}
                style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-muted)", padding: "9px 0", cursor: "pointer" }}
              >
                Close
              </button>
              {!inPool(preview.id) ? (
                <button
                  onClick={() => { addCard(preview); setPreview(null); }}
                  style={{ flex: 1, background: "var(--accent)", border: "none", borderRadius: 8, color: "#111", fontWeight: 700, padding: "9px 0", cursor: "pointer" }}
                >
                  Add to Pool
                </button>
              ) : (
                <button
                  onClick={() => {
                    const pc = pool.find((c) => c.id === preview.id);
                    if (pc) { removeCard(pc.dbId); setPreview(null); }
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
