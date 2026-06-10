"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { CardArt, RarityGem, FrameText, relativeTime } from "@/components/mtg";

interface Deck {
  id: number;
  name: string;
  format: string;
  commander: string | null;
  createdAt: string;
  _count: { cards: number };
}

type Me = { id: number; email: string } | null;

export default function HomePage() {
  const router = useRouter();
  // undefined = still resolving the session; null = signed out.
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [publicDecks, setPublicDecks] = useState<Deck[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", format: "commander", commander: "" });
  const [creating, setCreating] = useState(false);

  async function loadAll() {
    const meBody = await fetch("/api/auth/me")
      .then((r) => r.json())
      .catch(() => ({ user: null }));
    const user: Me = meBody?.user ?? null;
    setMe(user);
    const [own, pub] = await Promise.all([
      user ? fetch("/api/decks").then((r) => (r.ok ? r.json() : [])) : Promise.resolve([]),
      fetch("/api/decks?public=1").then((r) => (r.ok ? r.json() : [])),
    ]);
    setDecks(own);
    setPublicDecks(pub);
    setLoaded(true);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMe(null);
    setDecks([]);
    loadAll();
  }

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
    else loadAll();
  }

  async function deleteDeck(id: number) {
    if (!confirm("Delete this deck?")) return;
    await fetch(`/api/decks/${id}`, { method: "DELETE" });
    loadAll();
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
          padding: "20px 22px",
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "color-mix(in srgb, var(--app-bg) 84%, transparent)",
          backdropFilter: "blur(12px)",
          boxShadow: "0 1px 0 rgba(200,155,65,.12)",
        }}
      >
        <Logo />
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          {me ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span
                title={me.email}
                style={{
                  fontSize: 13.5,
                  color: "var(--text-dim)",
                  maxWidth: 180,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {me.email}
              </span>
              <button onClick={signOut} title="Sign out" style={outlineBtn}>
                Sign out
              </button>
            </div>
          ) : (
            me === null && (
              <Link href="/login" style={{ ...outlineBtn, textDecoration: "none", display: "inline-block" }}>
                Sign in
              </Link>
            )
          )}
          <button
            onClick={() => setShowModal(true)}
            style={{
              padding: "10px 18px",
              borderRadius: 9,
              border: "none",
              cursor: "pointer",
              background: "var(--gold)",
              color: "var(--accent-ink)",
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 16,
              display: "flex",
              alignItems: "center",
              gap: 7,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ fontSize: 19, lineHeight: 1 }}>+</span> New Deck
          </button>
        </div>
      </header>

      {me ? (
        <>
          {/* signed in: your decks */}
          <div style={{ maxWidth: 1160, width: "100%", margin: "0 auto", padding: "30px 22px 0" }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
              <div>
                <div className="label-sc" style={{ fontSize: 13, color: "var(--gold)", letterSpacing: ".22em", marginBottom: 8 }}>
                  The Spellbook
                </div>
                <h1 style={h1Style}>Your decks</h1>
                <p style={ledeStyle}>
                  Build and brew Magic: The Gathering decks — describe what you seek and let the Oracle surface the cards.
                </p>
              </div>
              <div style={{ display: "flex", gap: 26, paddingBottom: 4 }}>
                <CStat n={decks.length} label="Decks" />
                <CStat n={totalCards} label="Cards" />
                <CStat n={formatCount} label="Formats" gold />
              </div>
            </div>
          </div>

          <div style={{ maxWidth: 1160, width: "100%", margin: "0 auto", padding: "30px 22px 10px" }}>
            <div className="deck-grid">
              {decks.map((d) => (
                <ClassicDeckCard key={d.id} deck={d} onOpen={() => router.push(`/deck/${d.id}`)} onDelete={() => deleteDeck(d.id)} />
              ))}
              {loaded && <ClassicNewDeck onClick={() => setShowModal(true)} />}
            </div>
          </div>
        </>
      ) : (
        /* signed out: landing */
        <div style={{ maxWidth: 1160, width: "100%", margin: "0 auto", padding: "44px 22px 0" }}>
          <div style={{ maxWidth: 660, margin: "0 auto", textAlign: "center" }}>
            <div className="label-sc" style={{ fontSize: 13, color: "var(--gold)", letterSpacing: ".22em", marginBottom: 10 }}>
              The Spellbook, open to all
            </div>
            <h1 style={{ ...h1Style, fontSize: "clamp(36px, 8vw, 54px)", lineHeight: 1.04 }}>
              Brew Magic decks with an Oracle at your side
            </h1>
            <p style={{ ...ledeStyle, maxWidth: 560, margin: "14px auto 0", fontSize: 18 }}>
              Describe the deck you seek in plain words. The Oracle gathers real cards from the
              community&apos;s wisdom — you swipe, judge, and shuffle up.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 26, flexWrap: "wrap" }}>
              <button
                onClick={() => setShowModal(true)}
                style={{
                  padding: "13px 26px",
                  borderRadius: 10,
                  border: "none",
                  cursor: "pointer",
                  background: "var(--gold)",
                  color: "var(--accent-ink)",
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: 18,
                }}
              >
                Start brewing — no account needed
              </button>
              <Link
                href="/login"
                style={{ ...outlineBtn, padding: "13px 22px", fontSize: 16, textDecoration: "none", display: "inline-block" }}
              >
                Sign in for private decks
              </Link>
            </div>
            <p style={{ margin: "14px 0 0", fontSize: 13.5, fontStyle: "italic", color: "var(--text-dim)" }}>
              Guest decks are public — anyone can view them, anyone can tinker with them.
            </p>
          </div>

          {/* feature trio */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
              gap: 16,
              margin: "42px auto 0",
              maxWidth: 920,
            }}
          >
            <FeatureCard icon="✦" title="Ask the Oracle">
              “Cheap blue card draw.” “Token doublers.” Plain words in — real candidates out, drawn
              from EDHREC, Reddit and Scryfall.
            </FeatureCard>
            <FeatureCard icon="🃏" title="Swipe your pool">
              Review candidates like opening packs: keep what sings, skip what doesn&apos;t, promote
              the keepers into the deck.
            </FeatureCard>
            <FeatureCard icon="✨" title="Judge &amp; combos">
              An AI judge scores the brew, Commander Spellbook flags infinite combos, and sample
              hands tell you if it actually works.
            </FeatureCard>
          </div>
        </div>
      )}

      {/* public brews */}
      <div style={{ maxWidth: 1160, width: "100%", margin: "0 auto", padding: "34px 22px 60px", flex: 1 }}>
        {(publicDecks.length > 0 || !me) && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 18 }}>
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, color: "var(--text)" }}>
              Public brews
            </h2>
            <span style={{ fontSize: 13.5, fontStyle: "italic", color: "var(--text-dim)" }}>
              open decks anyone can edit
            </span>
          </div>
        )}
        <div className="deck-grid">
          {publicDecks.map((d) => (
            <ClassicDeckCard key={d.id} deck={d} onOpen={() => router.push(`/deck/${d.id}`)} onDelete={() => deleteDeck(d.id)} />
          ))}
          {loaded && !me && <ClassicNewDeck onClick={() => setShowModal(true)} />}
        </div>
        {loaded && me && publicDecks.length === 0 && null}
      </div>

      {showModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(8,6,4,0.74)",
            backdropFilter: "blur(6px)",
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
            className="cc-black"
            style={{ padding: 9, width: "100%", maxWidth: 420, animation: "sp-pop .18s ease" }}
          >
            <div className="cc-brown" style={{ padding: "16px 18px 18px" }}>
              <h2 style={{ margin: "0 0 4px", fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, color: "var(--frame-ink)", textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>
                Begin a new deck
              </h2>
              <p style={{ margin: "0 0 16px", fontStyle: "italic", fontSize: 14, color: "rgba(236,225,198,.7)" }}>
                {me
                  ? "Name your brew and choose a format."
                  : "You're brewing as a guest — this deck will be public, and anyone can edit it."}
              </p>
              <form onSubmit={createDeck} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input className="cc-paper" placeholder="Deck name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus style={modalInput} />
                <select className="cc-paper" value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })} style={modalInput}>
                  <option value="commander">Commander</option>
                  <option value="standard">Standard</option>
                  <option value="modern">Modern</option>
                  <option value="pioneer">Pioneer</option>
                  <option value="legacy">Legacy</option>
                  <option value="vintage">Vintage</option>
                  <option value="pauper">Pauper</option>
                  <option value="draft">Draft</option>
                </select>
                <input className="cc-paper" placeholder="Commander (optional)" value={form.commander} onChange={(e) => setForm({ ...form, commander: e.target.value })} style={modalInput} />
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                  <button type="button" onClick={() => setShowModal(false)} style={ghostBtn}>
                    Cancel
                  </button>
                  <button type="submit" disabled={creating} style={goldBtn}>
                    {creating ? "Scribing…" : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const h1Style: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-display)",
  fontSize: "clamp(34px, 7vw, 46px)",
  fontWeight: 700,
  color: "var(--text)",
  letterSpacing: "-.01em",
  lineHeight: 1,
};

const ledeStyle: React.CSSProperties = {
  margin: "12px 0 0",
  fontSize: 17,
  fontStyle: "italic",
  color: "var(--text-muted)",
  maxWidth: 480,
  lineHeight: 1.45,
};

const outlineBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "none",
  cursor: "pointer",
  background: "transparent",
  boxShadow: "inset 0 0 0 1px rgba(200,155,65,.35)",
  color: "var(--text-muted)",
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  fontSize: 13.5,
  whiteSpace: "nowrap",
};

function FeatureCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="cc-black" style={{ padding: 7 }}>
      <div className="cc-brown" style={{ padding: 7, height: "100%" }}>
        <div className="cc-paper" style={{ padding: "16px 16px 18px", height: "100%" }}>
          <div style={{ fontSize: 24, lineHeight: 1, marginBottom: 8 }}>{icon}</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--ink)", marginBottom: 6 }}>
            {title}
          </div>
          <div style={{ fontStyle: "italic", fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.45 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

function CStat({ n, label, gold }: { n: number; label: string; gold?: boolean }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 700, color: gold ? "var(--gold)" : "var(--text)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
        {n}
      </div>
      <div className="label-sc" style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 4, letterSpacing: ".14em" }}>
        {label}
      </div>
    </div>
  );
}

function ClassicDeckCard({ deck, onOpen, onDelete }: { deck: Deck; onOpen: () => void; onDelete: () => void }) {
  const [hover, setHover] = useState(false);
  const count = deck._count?.cards || 0;
  return (
    <div
      className="cc-black"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        padding: 8,
        cursor: "pointer",
        transform: hover ? "translateY(-3px)" : "none",
        boxShadow: hover ? "0 0 0 1.5px var(--gold)" : "0 5px 13px -4px rgba(0,0,0,.6)",
        transition: "transform .15s ease, box-shadow .15s",
      }}
    >
      <div className="cc-brown" style={{ padding: "8px 9px", display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "1px 4px 2px" }}>
          <FrameText flex size={20}>
            {deck.name}
          </FrameText>
        </div>
        <div className="cc-art" style={{ aspectRatio: "1 / 0.68" }}>
          <CardArt name={deck.commander || undefined} version="art_crop" radius={0} style={{ position: "absolute", inset: 0 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px" }}>
          <FrameText flex size={13.5}>
            {deck.format} Deck
          </FrameText>
          <RarityGem rarity="rare" size={11} />
        </div>
        <div className="cc-paper" style={{ padding: "9px 12px 10px" }}>
          <div style={{ fontStyle: "italic", fontSize: 14.5, color: "var(--ink)", lineHeight: 1.32, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: 38 }}>
            {deck.commander ? `“${deck.commander}.”` : "An untitled brew, awaiting its first cards."}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, fontSize: 12.5, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
            <span style={{ fontWeight: 600 }}>{count} card{count !== 1 ? "s" : ""}</span>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--ink-soft)" }} />
            <span>Updated {relativeTime(deck.createdAt)}</span>
          </div>
        </div>
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
          top: 5,
          right: 5,
          width: 24,
          height: 24,
          borderRadius: 6,
          border: "none",
          cursor: "pointer",
          background: "rgba(10,8,6,.82)",
          color: "#e8d8b4",
          fontSize: 12,
          opacity: hover ? 1 : 0,
          transition: "opacity .15s",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "inset 0 0 0 1px rgba(200,155,65,.4)",
        }}
      >
        ✕
      </button>
    </div>
  );
}

function ClassicNewDeck({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="cc-black"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ padding: 8, cursor: "pointer", transform: hover ? "translateY(-4px)" : "none", transition: "transform .22s", minHeight: 300 }}
    >
      <div className="cc-brown" style={{ height: "100%", padding: 8, display: "flex" }}>
        <div
          className="cc-paper"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 13,
            border: "2px dashed rgba(34,26,12,.28)",
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,.2)",
          }}
        >
          <span
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: hover ? "var(--gold)" : "transparent",
              color: hover ? "#1a1407" : "var(--ink)",
              boxShadow: `inset 0 0 0 2px ${hover ? "var(--gold)" : "rgba(34,26,12,.4)"}`,
              fontSize: 26,
              transition: "all .2s",
            }}
          >
            +
          </span>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 19, color: "var(--ink)" }}>Begin a new deck</span>
          <span style={{ fontStyle: "italic", fontSize: 13.5, color: "var(--ink-soft)", textAlign: "center", maxWidth: 180 }}>
            Scribe it from scratch or conjure with a prompt.
          </span>
        </div>
      </div>
    </div>
  );
}

const modalInput: React.CSSProperties = {
  padding: "11px 13px",
  border: "none",
  outline: "none",
  borderRadius: 5,
  fontFamily: "var(--font-body)",
  fontSize: 15,
  color: "var(--ink)",
  width: "100%",
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
