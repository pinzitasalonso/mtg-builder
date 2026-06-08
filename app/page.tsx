"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { CardArt, relativeTime } from "@/components/mtg";

interface Deck {
  id: number;
  name: string;
  format: string;
  commander: string | null;
  createdAt: string;
  _count: { cards: number };
}

export default function HomePage() {
  const router = useRouter();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", format: "commander", commander: "" });
  const [creating, setCreating] = useState(false);

  async function loadDecks() {
    const res = await fetch("/api/decks");
    setDecks(await res.json());
    setLoaded(true);
  }

  useEffect(() => {
    loadDecks();
  }, []);

  async function createDeck(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setCreating(true);
    const res = await fetch("/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        format: form.format,
        commander: form.commander.trim() || undefined,
      }),
    });
    const created = await res.json().catch(() => null);
    setForm({ name: "", format: "commander", commander: "" });
    setShowModal(false);
    setCreating(false);
    if (created?.id) router.push(`/deck/${created.id}`);
    else loadDecks();
  }

  async function deleteDeck(id: number) {
    if (!confirm("Delete this deck?")) return;
    await fetch(`/api/decks/${id}`, { method: "DELETE" });
    loadDecks();
  }

  const totalCards = decks.reduce((s, d) => s + (d._count?.cards || 0), 0);
  const formatCount = new Set(decks.map((d) => d.format)).size;

  return (
    <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      {/* top nav */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 20px",
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "color-mix(in srgb, var(--bg) 82%, transparent)",
          backdropFilter: "blur(14px)",
        }}
      >
        <Logo />
        <button
          onClick={() => setShowModal(true)}
          style={{
            padding: "11px 18px",
            borderRadius: 11,
            border: "none",
            cursor: "pointer",
            background: "var(--accent)",
            color: "var(--accent-ink)",
            fontWeight: 700,
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            gap: 7,
            boxShadow: "0 8px 22px -8px rgba(230,181,71,.5)",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: 17, lineHeight: 1 }}>+</span> New Deck
        </button>
      </header>

      {/* hero */}
      <div style={{ maxWidth: 1120, width: "100%", margin: "0 auto", padding: "20px 20px 0" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
          <div>
            <h1
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: "clamp(28px, 6vw, 38px)",
                fontWeight: 800,
                color: "var(--text)",
                letterSpacing: "-.025em",
                lineHeight: 1.05,
              }}
            >
              Your decks
            </h1>
            <p style={{ margin: "10px 0 0", fontSize: 15, color: "var(--text-muted)", maxWidth: 460, lineHeight: 1.5 }}>
              Build and brew Magic: The Gathering decks — describe what you want and let AI surface the cards.
            </p>
          </div>
          <div style={{ display: "flex", gap: 22, paddingBottom: 4 }}>
            <Stat n={decks.length} label="Decks" />
            <Stat n={totalCards} label="Cards" />
            <Stat n={formatCount} label="Formats" accent />
          </div>
        </div>
      </div>

      {/* deck grid */}
      <div style={{ maxWidth: 1120, width: "100%", margin: "0 auto", padding: "28px 20px 60px", flex: 1 }}>
        {loaded && decks.length === 0 ? (
          <div className="deck-grid">
            <NewDeckCard onClick={() => setShowModal(true)} />
          </div>
        ) : (
          <div className="deck-grid">
            {decks.map((d) => (
              <DeckCard
                key={d.id}
                deck={d}
                onOpen={() => router.push(`/deck/${d.id}`)}
                onDelete={() => deleteDeck(d.id)}
              />
            ))}
            {loaded && <NewDeckCard onClick={() => setShowModal(true)} />}
          </div>
        )}
      </div>

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
            animation: "sp-fade .15s ease",
          }}
          onClick={(e) => e.target === e.currentTarget && setShowModal(false)}
        >
          <div
            style={{
              background: "var(--surface)",
              boxShadow: "inset 0 0 0 1px var(--line)",
              borderRadius: 16,
              padding: 24,
              width: "100%",
              maxWidth: 400,
              animation: "sp-pop .18s ease",
            }}
          >
            <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 800, fontFamily: "var(--font-display)" }}>New Deck</h2>
            <form onSubmit={createDeck} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <input
                placeholder="Deck name *"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                autoFocus
                style={inputStyle}
              />
              <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })} style={inputStyle}>
                <option value="commander">Commander</option>
                <option value="standard">Standard</option>
                <option value="modern">Modern</option>
                <option value="pioneer">Pioneer</option>
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

function Stat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 26,
          fontWeight: 800,
          color: accent ? "var(--accent)" : "var(--text)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        {n}
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: "var(--text-dim)",
          marginTop: 4,
          letterSpacing: ".04em",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function DeckCard({ deck, onOpen, onDelete }: { deck: Deck; onOpen: () => void; onDelete: () => void }) {
  const [hover, setHover] = useState(false);
  const count = deck._count?.cards || 0;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        textAlign: "left",
        cursor: "pointer",
        borderRadius: 16,
        overflow: "hidden",
        position: "relative",
        background: "var(--surface)",
        boxShadow: hover
          ? "0 22px 48px -18px rgba(0,0,0,.8), inset 0 0 0 1px rgba(230,181,71,.4)"
          : "0 6px 20px -8px rgba(0,0,0,.6), inset 0 0 0 1px var(--line)",
        transform: hover ? "translateY(-4px)" : "none",
        transition: "transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease",
      }}
    >
      <div style={{ position: "relative", height: 132 }}>
        <CardArt
          name={deck.commander || undefined}
          version="art_crop"
          radius={0}
          style={{ position: "absolute", inset: 0 }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(13,14,16,.15) 0%, rgba(13,14,16,.55) 55%, var(--surface) 100%)",
          }}
        />
        <div style={{ position: "absolute", top: 12, left: 13 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".04em",
              textTransform: "uppercase",
              color: "var(--text)",
              background: "rgba(8,9,11,.55)",
              backdropFilter: "blur(6px)",
              padding: "4px 9px",
              borderRadius: 20,
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,.12)",
            }}
          >
            {deck.format}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete deck"
          aria-label="Delete deck"
          style={{
            position: "absolute",
            top: 10,
            right: 11,
            width: 28,
            height: 28,
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            background: "rgba(8,9,11,.55)",
            color: "#fff",
            backdropFilter: "blur(6px)",
            opacity: hover ? 1 : 0,
            transition: "opacity .15s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            lineHeight: 1,
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,.12)",
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ padding: "12px 16px 16px", marginTop: -6, position: "relative" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 21, fontWeight: 700, color: "var(--text)", letterSpacing: "-.01em" }}>
          {deck.name}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 2 }}>
          {deck.commander || `${deck.format} deck`}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, fontSize: 12, color: "var(--text-dim)" }}>
          <span style={{ color: "var(--text-muted)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {count} card{count !== 1 ? "s" : ""}
          </span>
          <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--text-dim)" }} />
          <span>Updated {relativeTime(deck.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

function NewDeckCard({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: "pointer",
        border: "none",
        font: "inherit",
        borderRadius: 16,
        minHeight: 252,
        background: hover ? "rgba(230,181,71,.07)" : "transparent",
        boxShadow: `inset 0 0 0 1.5px ${hover ? "rgba(230,181,71,.5)" : "var(--line)"}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        transition: "background .2s, box-shadow .2s",
      }}
    >
      <span
        style={{
          width: 46,
          height: 46,
          borderRadius: 13,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: hover ? "var(--accent)" : "rgba(255,255,255,.05)",
          color: hover ? "var(--accent-ink)" : "var(--accent)",
          fontSize: 24,
          transition: "all .2s",
          boxShadow: hover ? "0 8px 20px -6px rgba(230,181,71,.6)" : "none",
        }}
      >
        +
      </span>
      <span style={{ fontSize: 14.5, fontWeight: 600, color: hover ? "var(--accent)" : "var(--text-muted)", transition: "color .2s" }}>
        New Deck
      </span>
      <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Start brewing from scratch or a prompt</span>
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "11px 13px",
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
  color: "var(--accent-ink)",
  padding: "9px 18px",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 14,
};
