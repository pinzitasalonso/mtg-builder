"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import CollectionView from "@/components/CollectionView";
import { CardArt, ColorPips, deckTarget, relativeTime } from "@/components/mtg";
import { fetchCollection } from "@/lib/collection-client";
import { getIdentityTheme, LIGHT_VARS } from "@/lib/identity-theme";

/* The home/landing view wears the same immersive theme as the deck page, using
   the neutral (colourless) palette. */
const homeTheme = getIdentityTheme(null);

/* Big uppercase display title — the deck page's signature heading style. */
const displayTitle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: ".01em",
  lineHeight: 1.02,
  color: "var(--text)",
};

interface Deck {
  id: number;
  name: string;
  format: string;
  commander: string | null;
  createdAt: string;
  colors?: string[];
  _count: { cards: number };
}

type Me = { id: number; email: string } | null;

/* Flips true right after mount, driving CSS entrance transitions. */
function useRevealed() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

function Reveal({
  delay = 0,
  dy = 8,
  style,
  children,
}: {
  delay?: number;
  dy?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const on = useRevealed();
  return (
    <div
      style={{
        ...style,
        opacity: on ? 1 : 0,
        transform: on ? "none" : `translateY(${dy}px)`,
        transition: `opacity .5s ease ${delay}s, transform .5s cubic-bezier(.2,.8,.2,1) ${delay}s`,
      }}
    >
      {children}
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  // undefined = still resolving the session; null = signed out.
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [publicDecks, setPublicDecks] = useState<Deck[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showCollection, setShowCollection] = useState(false);
  // Collection summary for the home block: count + a few names for thumbnails.
  const [collection, setCollection] = useState<{ unique: number; total: number; sample: string[] }>({ unique: 0, total: 0, sample: [] });
  const [form, setForm] = useState({ name: "", format: "commander", commander: "" });
  const [creating, setCreating] = useState(false);

  async function loadCollection() {
    const c = await fetchCollection();
    // Randomize which cards headline the home block so it feels fresh each visit.
    const names = c.cards.map((x) => x.name);
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }
    setCollection({ unique: c.unique, total: c.total, sample: names.slice(0, 7) });
  }

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
    if (user) loadCollection();
    else setCollection({ unique: 0, total: 0, sample: [] });
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
    <main style={{ flex: 1, display: "flex", flexDirection: "column", ...homeTheme.vars, background: homeTheme.bg, color: homeTheme.text }}>
      {/* top nav */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 22px",
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "var(--bg)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <Logo size={18} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {me ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span
                title={me.email}
                style={{
                  fontSize: 13.5,
                  color: "var(--t3)",
                  maxWidth: 180,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {me.email}
              </span>
              <button onClick={() => setShowCollection(true)} title="Manage your owned-card collection" className="mn-ghost" style={{ padding: "8px 16px", fontSize: 13.5 }}>
                Collection
              </button>
              <button onClick={signOut} title="Sign out" className="mn-ghost" style={{ padding: "8px 16px", fontSize: 13.5 }}>
                Sign out
              </button>
            </div>
          ) : (
            me === null && (
              <Link href="/login" className="mn-ghost" style={{ padding: "9px 18px", fontSize: 14, textDecoration: "none", display: "inline-block" }}>
                Sign in
              </Link>
            )
          )}
          <button onClick={() => setShowModal(true)} className="mn-btn" style={{ padding: "10px 20px", fontSize: 14 }}>
            + New Deck
          </button>
        </div>
      </header>

      {me ? (
        <>
          {/* signed in: your decks */}
          <div style={{ maxWidth: 1080, width: "100%", margin: "0 auto", padding: "44px 22px 0" }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: "clamp(34px, 6vw, 46px)", ...displayTitle }}>
                  Your decks
                </h1>
                <p style={{ margin: "12px 0 0", maxWidth: 480, fontSize: 16, lineHeight: 1.6, color: "var(--t2)" }}>
                  Describe what you seek and let the Oracle surface the cards.
                </p>
              </div>
              <div style={{ display: "flex", gap: 28, paddingBottom: 4 }}>
                <CStat n={decks.length} label="Decks" />
                <CStat n={totalCards} label="Cards" />
                <CStat n={formatCount} label="Formats" accent />
              </div>
            </div>
            <DeckTable decks={decks} onOpen={(d) => router.push(`/deck/${d.id}`)} onDelete={deleteDeck} onNew={() => setShowModal(true)} showNew={loaded} />

            <CollectionBlock
              unique={collection.unique}
              total={collection.total}
              sample={collection.sample}
              onOpen={() => setShowCollection(true)}
            />
          </div>
        </>
      ) : (
        /* signed out: landing */
        <div style={{ maxWidth: 1080, width: "100%", margin: "0 auto", padding: "48px 22px 0", display: "flex", alignItems: "center", gap: 36, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 480px", minWidth: 0 }}>
            <Reveal delay={0.05}>
              <h1 style={{ margin: 0, fontSize: "clamp(38px, 6.5vw, 54px)", ...displayTitle, textWrap: "balance" }}>
                Brew Magic decks with an Oracle at your side.
              </h1>
            </Reveal>
            <Reveal delay={0.14}>
              <p style={{ margin: "22px 0 0", maxWidth: 520, fontSize: 17, lineHeight: 1.6, color: "var(--t2)", textWrap: "pretty" }}>
                Describe the deck you seek in plain words. The Oracle gathers real cards from the
                community&apos;s wisdom — you swipe, judge, and shuffle up.
              </p>
            </Reveal>
            <Reveal delay={0.2} style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 32, flexWrap: "wrap" }}>
              <button onClick={() => setShowModal(true)} className="mn-btn" style={{ padding: "15px 28px", fontSize: 15.5 }}>
                Start brewing — no account needed
              </button>
              <Link href="/login" className="mn-ghost" style={{ padding: "14px 24px", fontSize: 14.5, textDecoration: "none", display: "inline-block" }}>
                Sign in for private decks
              </Link>
            </Reveal>
            <Reveal delay={0.26} style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 20 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  flex: "none",
                  background: "#0d8a5f",
                  boxShadow: "0 0 6px #0d8a5f99",
                  animation: "mn-blink 2.2s infinite",
                }}
              />
              <span style={{ fontSize: 13.5, color: "var(--t3)" }}>
                Guest decks are public — anyone can view them, anyone can tinker with them.
              </span>
            </Reveal>
          </div>
          <CardFan />
        </div>
      )}

      {!me && (
        /* features */
        <div style={{ maxWidth: 1080, width: "100%", margin: "0 auto", padding: "30px 22px 0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 32, marginTop: 38 }}>
            <Feature n="01" title="Ask the Oracle" delay={0.3}>
              “Cheap blue card draw.” “Token doublers.” Plain words in — real candidates out, drawn
              from EDHREC, Reddit and Scryfall.
            </Feature>
            <Feature n="02" title="Swipe your pool" delay={0.38}>
              Review candidates like opening packs: keep what sings, skip what doesn&apos;t, promote
              the keepers into the deck.
            </Feature>
            <Feature n="03" title="Judge &amp; combos" delay={0.46}>
              An AI judge scores the brew, Commander Spellbook flags infinite combos, and sample
              hands tell you if it actually works.
            </Feature>
          </div>
        </div>
      )}

      {/* public brews index */}
      <div style={{ maxWidth: 1080, width: "100%", margin: "0 auto", padding: me ? "56px 22px 80px" : "78px 22px 80px", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, paddingBottom: 22, borderBottom: "1px solid var(--t1)" }}>
          <h2 style={{ margin: 0, fontSize: "clamp(28px, 4.5vw, 38px)", ...displayTitle }}>Public brews</h2>
          <span className="mn-label">open decks anyone can edit</span>
        </div>
        <DeckTable decks={publicDecks} noHeadRule onOpen={(d) => router.push(`/deck/${d.id}`)} onDelete={deleteDeck} onNew={() => setShowModal(true)} showNew={loaded && !me} />
      </div>

      {showCollection && (
        <CollectionView onClose={() => setShowCollection(false)} onChanged={loadCollection} />
      )}

      {showModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(21,21,26,.32)",
            backdropFilter: "blur(4px)",
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
              ...LIGHT_VARS,
              background: "var(--bg)",
              color: "var(--t1)",
              borderRadius: 20,
              boxShadow: "0 30px 70px -20px rgba(21,21,26,.4)",
              padding: "26px 28px 28px",
              width: "100%",
              maxWidth: 440,
              animation: "sp-pop .18s ease",
            }}
          >
            <h2 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 700, letterSpacing: "-.02em" }}>Begin a new deck</h2>
            <p style={{ margin: "0 0 18px", fontSize: 14.5, color: "var(--t2)", lineHeight: 1.5 }}>
              {me
                ? "Name your brew and choose a format."
                : "You're brewing as a guest — this deck will be public, and anyone can edit it."}
            </p>
            <form onSubmit={createDeck} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input placeholder="Deck name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus style={modalInput} />
              <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })} style={modalInput}>
                <option value="commander">Commander</option>
                <option value="standard">Standard</option>
                <option value="modern">Modern</option>
                <option value="pioneer">Pioneer</option>
                <option value="legacy">Legacy</option>
                <option value="vintage">Vintage</option>
                <option value="pauper">Pauper</option>
                <option value="draft">Draft</option>
              </select>
              <input placeholder="Commander (optional)" value={form.commander} onChange={(e) => setForm({ ...form, commander: e.target.value })} style={modalInput} />
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
                <button type="button" onClick={() => setShowModal(false)} className="mn-ghost" style={{ padding: "10px 20px", fontSize: 14 }}>
                  Cancel
                </button>
                <button type="submit" disabled={creating} className="mn-btn" style={{ padding: "10px 24px", fontSize: 14 }}>
                  {creating ? "Scribing…" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

/* Fanned hand of real cards — the hero visual. Cards deal in via transition. */
function CardFan() {
  const on = useRevealed();
  const [hovered, setHovered] = useState<number | null>(null);
  const cards = [
    { name: "Sol Ring", colors: ["C"] },
    { name: "Counterspell", colors: ["U"] },
    { name: "Lightning Bolt", colors: ["R"] },
  ];
  return (
    <div style={{ position: "relative", height: 400, flex: "none", width: 450, maxWidth: "100%", margin: "0 auto" }} aria-hidden="true">
      {cards.map((c, i) => {
        const off = i - 1;
        const lift = hovered === i ? -14 : 0;
        return (
          <div
            key={c.name}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 232,
              opacity: on ? 1 : 0,
              transform: on
                ? `translate(-50%, -50%) translateX(${off * 88}px) translateY(${Math.abs(off) * 18 + lift}px) rotate(${off * 9}deg)`
                : `translate(-50%, -50%) translateY(60px) rotate(0deg) scale(.96)`,
              transformOrigin: "50% 120%",
              zIndex: hovered === i ? 3 : i === 1 ? 2 : 1,
              transition: `transform .55s cubic-bezier(.2,.8,.2,1) ${on ? (hovered != null ? "0s" : `${0.15 + i * 0.1}s`) : "0s"}, opacity .45s ease ${0.15 + i * 0.1}s`,
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid var(--line)",
              boxShadow: i === 1 ? "0 24px 50px -20px rgba(21,21,26,.45)" : "0 18px 40px -20px rgba(21,21,26,.35)",
              background: "var(--bg2)",
            }}
          >
            <CardArt name={c.name} colors={c.colors} version="normal" radius={0} style={{ aspectRatio: "488/680" }} />
          </div>
        );
      })}
    </div>
  );
}

function Feature({ n, title, delay, children }: { n: string; title: string; delay: number; children: React.ReactNode }) {
  return (
    <Reveal delay={delay} style={{ borderTop: "1px solid var(--t1)", paddingTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-.01em" }}>{title}</span>
        <span className="mn-label" style={{ color: "var(--accent)" }}>{n}</span>
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.6, color: "var(--t2)", textWrap: "pretty" }}>{children}</p>
    </Reveal>
  );
}

function CStat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-.02em", color: accent ? "var(--accent)" : "var(--t1)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
        {n}
      </div>
      <div className="mn-label" style={{ marginTop: 5 }}>{label}</div>
    </div>
  );
}

/* ---------- "Your collection" home block ---------- */
function CollectionBlock({
  unique,
  total,
  sample,
  onOpen,
}: {
  unique: number;
  total: number;
  sample: string[];
  onOpen: () => void;
}) {
  return (
    <div style={{ marginTop: 56 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, paddingBottom: 20, borderBottom: "1px solid var(--t1)" }}>
        <h2 style={{ margin: 0, fontSize: "clamp(24px, 4vw, 32px)", ...displayTitle }}>Your collection</h2>
        <span className="mn-label">{unique > 0 ? `${unique} unique · ${total} total` : "nothing yet"}</span>
        <button
          onClick={onOpen}
          className="mn-ghost"
          style={{ marginLeft: "auto", padding: "9px 18px", fontSize: 14 }}
        >
          {unique > 0 ? "Browse →" : "Import →"}
        </button>
      </div>
      {unique > 0 ? (
        <button
          onClick={onOpen}
          aria-label="Browse your collection"
          style={{ display: "flex", gap: 12, marginTop: 20, padding: 0, border: "none", background: "transparent", cursor: "pointer", width: "100%" }}
        >
          {sample.map((name) => (
            <div key={name} style={{ flex: "1 1 0", minWidth: 0, borderRadius: 10, overflow: "hidden", boxShadow: "0 6px 16px -8px rgba(0,0,0,.5)" }}>
              <CardArt name={name} colors={["C"]} version="normal" radius={10} style={{ aspectRatio: "5 / 7" }} />
            </div>
          ))}
        </button>
      ) : (
        <p style={{ marginTop: 18, fontSize: 15, color: "var(--t2)", lineHeight: 1.5 }}>
          Import the cards you own to track them across decks, see what you can build for free, and let the AI factor it in.{" "}
          <button onClick={onOpen} style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
            Import your collection
          </button>
          .
        </p>
      )}
    </div>
  );
}

/* ---------- Swiss index table of decks ---------- */
function DeckTable({
  decks,
  onOpen,
  onDelete,
  onNew,
  showNew,
  noHeadRule,
}: {
  decks: Deck[];
  onOpen: (d: Deck) => void;
  onDelete: (id: number) => void;
  onNew: () => void;
  showNew: boolean;
  noHeadRule?: boolean;
}) {
  return (
    <div style={{ marginTop: noHeadRule ? 0 : 16 }}>
      <div className="mn-row" style={{ padding: "14px 10px 10px", borderBottom: "1px solid var(--line)" }}>
        <span className="mn-label">Nº</span>
        <span className="mn-label"></span>
        <span className="mn-label">Deck</span>
        <span className="mn-label mn-col-format">Format</span>
        <span className="mn-label mn-col-colors">Colors</span>
        <span className="mn-label">Progress</span>
        <span className="mn-label mn-col-updated">Updated</span>
        <span className="mn-label"></span>
      </div>
      {decks.map((d, i) => (
        <DeckRow key={d.id} deck={d} index={i} onOpen={() => onOpen(d)} onDelete={() => onDelete(d.id)} />
      ))}
      {showNew && (
        <button onClick={onNew} className="mn-ghost" style={{ marginTop: 26, padding: "12px 24px", fontSize: 14.5, borderStyle: "dashed" }}>
          + Start a new deck
        </button>
      )}
    </div>
  );
}

function MnProgress({ count, target, delay = 0 }: { count: number; target: number; delay?: number }) {
  const on = useRevealed();
  const pct = Math.min(100, Math.round((count / Math.max(1, target)) * 100));
  return (
    <div style={{ height: 4, borderRadius: 99, background: "var(--bar-track)" }}>
      <div
        style={{
          height: "100%",
          width: on ? `${pct}%` : "0%",
          borderRadius: 99,
          background: "var(--accent)",
          transition: `width .9s cubic-bezier(.2,.8,.2,1) ${delay}s`,
        }}
      />
    </div>
  );
}

function DeckRow({ deck, index, onOpen, onDelete }: { deck: Deck; index: number; onOpen: () => void; onDelete: () => void }) {
  const [hover, setHover] = useState(false);
  const count = deck._count?.cards || 0;
  const target = deckTarget(deck.format);
  return (
    <Reveal delay={0.08 + Math.min(index, 8) * 0.06}>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpen();
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="mn-row"
        style={{
          padding: "16px 10px",
          borderBottom: "1px solid var(--line)",
          cursor: "pointer",
          background: hover ? "var(--bg3)" : "transparent",
          transition: "background .12s",
          position: "relative",
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--t3)" }}>{String(index + 1).padStart(2, "0")}</span>
        <CardArt
          name={deck.commander || deck.name}
          colors={deck.colors?.length ? deck.colors : ["C"]}
          version="art_crop"
          radius={6}
          style={{ width: 56, height: 40, filter: hover ? "none" : "saturate(.4)", transition: "filter .25s" }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 17, letterSpacing: "-.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {deck.name}
          </div>
          <div style={{ fontSize: 13.5, color: "var(--t3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {deck.commander || "An untitled brew, awaiting its first cards."}
          </div>
        </div>
        <span className="mn-col-format" style={{ fontSize: 14, color: "var(--t2)", textTransform: "capitalize" }}>{deck.format}</span>
        <span className="mn-col-colors">
          {deck.colors && deck.colors.length > 0 ? <ColorPips colors={deck.colors} size={16} /> : <span style={{ color: "var(--t3)" }}>—</span>}
        </span>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--t2)" }}>
              {count}
              <span style={{ color: "var(--t3)" }}>/{target}</span>
            </span>
            {count >= target && <span className="mn-label" style={{ fontSize: 10, color: "#0d8a5f" }}>Ready</span>}
          </div>
          <MnProgress count={count} target={target} delay={0.15 + Math.min(index, 8) * 0.08} />
        </div>
        <span className="mn-col-updated" style={{ fontSize: 13.5, color: "var(--t3)" }}>{relativeTime(deck.createdAt)}</span>
        <span
          style={{ fontSize: 17, color: hover ? "var(--accent)" : "var(--t3)", transform: hover ? "translateX(3px)" : "none", transition: "all .15s", textAlign: "right" }}
        >
          →
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete deck"
          aria-label="Delete deck"
          style={{
            position: "absolute",
            top: -9,
            right: 2,
            width: 22,
            height: 22,
            borderRadius: 8,
            border: "1px solid var(--line)",
            cursor: "pointer",
            background: "var(--bg3)",
            color: "var(--t3)",
            fontSize: 10,
            opacity: hover ? 1 : 0,
            transition: "opacity .15s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ✕
        </button>
      </div>
    </Reveal>
  );
}

const modalInput: React.CSSProperties = {
  padding: "13px 16px",
  border: "1px solid var(--line)",
  outline: "none",
  borderRadius: 12,
  fontFamily: "var(--font-body)",
  fontSize: 15,
  color: "var(--t1)",
  background: "var(--bg2)",
  width: "100%",
};
