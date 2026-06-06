"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Deck {
  id: number;
  name: string;
  format: string;
  commander: string | null;
  createdAt: string;
  _count: { cards: number };
}

export default function HomePage() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", format: "commander", commander: "" });
  const [creating, setCreating] = useState(false);

  async function loadDecks() {
    const res = await fetch("/api/decks");
    setDecks(await res.json());
  }

  useEffect(() => { loadDecks(); }, []);

  async function createDeck(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setCreating(true);
    await fetch("/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        format: form.format,
        commander: form.commander.trim() || undefined,
      }),
    });
    setForm({ name: "", format: "commander", commander: "" });
    setShowModal(false);
    setCreating(false);
    loadDecks();
  }

  async function deleteDeck(id: number, e: React.MouseEvent) {
    e.preventDefault();
    if (!confirm("Delete this deck?")) return;
    await fetch(`/api/decks/${id}`, { method: "DELETE" });
    loadDecks();
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)", margin: 0 }}>
          MTG Deck Builder
        </h1>
        <button
          onClick={() => setShowModal(true)}
          style={{
            background: "var(--accent)",
            color: "#111",
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          + New Deck
        </button>
      </div>

      {decks.length === 0 ? (
        <p style={{ color: "var(--text-muted)", textAlign: "center", marginTop: 60 }}>
          No decks yet. Create one to get started.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {decks.map((deck) => (
            <Link
              key={deck.id}
              href={`/deck/${deck.id}`}
              style={{ textDecoration: "none" }}
            >
              <div
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: "16px 18px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text)" }}>
                    {deck.name}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
                    {deck.format}
                    {deck.commander ? ` · ${deck.commander}` : ""}
                    {" · "}
                    {deck._count.cards} card{deck._count.cards !== 1 ? "s" : ""}
                  </div>
                </div>
                <button
                  onClick={(e) => deleteDeck(deck.id, e)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 20,
                    padding: "4px 8px",
                    borderRadius: 6,
                    lineHeight: 1,
                  }}
                  title="Delete deck"
                >
                  ×
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
          onClick={(e) => e.target === e.currentTarget && setShowModal(false)}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: 24,
              width: "100%",
              maxWidth: 400,
            }}
          >
            <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700 }}>New Deck</h2>
            <form onSubmit={createDeck} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <input
                placeholder="Deck name *"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                style={inputStyle}
              />
              <select
                value={form.format}
                onChange={(e) => setForm({ ...form, format: e.target.value })}
                style={inputStyle}
              >
                <option value="commander">Commander</option>
                <option value="standard">Standard</option>
                <option value="modern">Modern</option>
                <option value="legacy">Legacy</option>
                <option value="vintage">Vintage</option>
                <option value="pauper">Pauper</option>
                <option value="draft">Draft</option>
              </select>
              <input
                placeholder="Commander (optional)"
                value={form.commander}
                onChange={(e) => setForm({ ...form, commander: e.target.value })}
                style={inputStyle}
              />
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                <button type="button" onClick={() => setShowModal(false)} style={cancelBtnStyle}>
                  Cancel
                </button>
                <button type="submit" disabled={creating} style={submitBtnStyle}>
                  {creating ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "10px 12px",
  color: "var(--text)",
  fontSize: 14,
  width: "100%",
  outline: "none",
};

const cancelBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-muted)",
  padding: "9px 18px",
  cursor: "pointer",
  fontSize: 14,
};

const submitBtnStyle: React.CSSProperties = {
  background: "var(--accent)",
  border: "none",
  borderRadius: 8,
  color: "#111",
  padding: "9px 18px",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 14,
};
