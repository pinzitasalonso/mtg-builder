"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";

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

export default function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const deckId = Number(id);

  const [deck, setDeck] = useState<Deck | null>(null);
  const [pool, setPool] = useState<PoolCard[]>([]);
  const [searchResults, setSearchResults] = useState<SearchCard[]>([]);
  const [query, setQuery] = useState("");
  const [generatedQuery, setGeneratedQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [preview, setPreview] = useState<SearchCard | null>(null);

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
        body: JSON.stringify({ prompt: query }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.details?.details ?? data.error ?? "Search failed");
      } else {
        setSearchResults(data.cards);
        setGeneratedQuery(data.query);
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
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "16px", display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Link href="/" style={{ color: "var(--text-muted)", textDecoration: "none", fontSize: 20, lineHeight: 1 }}>
          ←
        </Link>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{deck?.name ?? "…"}</h1>
          {deck && (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {deck.format}{deck.commander ? ` · ${deck.commander}` : ""}
            </div>
          )}
        </div>
      </div>

      {/* Search section */}
      <form onSubmit={search} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          placeholder="Describe cards to add… e.g. blue wizards"
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
            fontSize: 15,
            outline: "none",
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

      {/* Search results horizontal scroll */}
      {searchResults.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              gap: 12,
              overflowX: "auto",
              paddingBottom: 8,
              paddingTop: 4,
            }}
          >
            {searchResults.map((card) => {
              const already = inPool(card.id);
              return (
                <div
                  key={card.id}
                  style={{ flexShrink: 0, position: "relative", width: 130 }}
                >
                  <div
                    style={{ cursor: "pointer", borderRadius: 8, overflow: "hidden", border: "2px solid " + (already ? "var(--accent)" : "transparent") }}
                    onClick={() => setPreview(card)}
                  >
                    {card.imageUri ? (
                      <Image
                        src={card.imageUri}
                        alt={card.name}
                        width={130}
                        height={181}
                        style={{ display: "block", width: "100%", height: "auto" }}
                        unoptimized
                      />
                    ) : (
                      <div style={{ width: 130, height: 181, background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--text-muted)", padding: 8, textAlign: "center" }}>
                        {card.name}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => addCard(card)}
                    disabled={already}
                    style={{
                      position: "absolute",
                      bottom: 6,
                      right: 6,
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      border: "none",
                      background: already ? "var(--accent)" : "#1a1d21cc",
                      color: already ? "#111" : "var(--text)",
                      cursor: already ? "default" : "pointer",
                      fontWeight: 700,
                      fontSize: 16,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      backdropFilter: "blur(4px)",
                    }}
                  >
                    {already ? "✓" : "+"}
                  </button>
                </div>
              );
            })}
          </div>
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
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 12,
            }}
          >
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
