"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import CollectionView from "@/components/CollectionView";
import { CardArt, ColorPips, deckTarget } from "@/components/mtg";
import { fetchCollection } from "@/lib/collection-client";
import { getIdentityTheme, getIdentityField, LIGHT_VARS } from "@/lib/identity-theme";

/* The home view wears the commander-blue identity field — the same immersive
   look the deck pages use, matching the Color Identity design. */
const homeTheme = getIdentityTheme("U");
const heroField = getIdentityField("U");

interface Deck {
  id: number;
  publicId: string;
  name: string;
  format: string;
  commander: string | null;
  createdAt: string;
  colors?: string[];
  _count: { cards: number };
}

type Me = { id: number; email: string } | null;

const FEATURES = [
  { n: "01", t: "Pour in a theme", d: "Tell Spellpool a commander, a combo, or just a vibe. It reads the whole Oracle text database — not just card names." },
  { n: "02", t: "Swipe the pool", d: "Get a living pool of suggestions ranked for your build. Keep what fits, toss what doesn't. The pool reshapes as you go." },
  { n: "03", t: "Brew to 100", d: "Watch your curve, color identity, and type balance update live. Export to your deck builder the moment it's legal." },
];

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
    if (created?.publicId) router.push(`/deck/${created.publicId}`);
    else loadAll();
  }

  async function deleteDeck(id: string) {
    if (!confirm("Delete this deck?")) return;
    await fetch(`/api/decks/${id}`, { method: "DELETE" });
    loadAll();
  }

  // "See a sample deck" → open the first public brew, else scroll to the brews.
  function seeSample() {
    if (publicDecks[0]) router.push(`/deck/${publicDecks[0].publicId}`);
    else document.getElementById("brews")?.scrollIntoView({ behavior: "smooth" });
  }

  const totalCards = decks.reduce((s, d) => s + (d._count?.cards || 0), 0);
  const formatCount = new Set(decks.map((d) => d.format)).size;

  return (
    <main style={{ flex: 1, display: "flex", flexDirection: "column", ...homeTheme.vars, background: heroField.bg, color: "#fff" }}>
      {/* HERO — on the commander-blue field */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          background: `radial-gradient(120% 80% at 78% -10%, ${heroField.bg}, ${heroField.deep} 78%)`,
        }}
      >
        {/* transparent top nav */}
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px clamp(20px, 4vw, 52px)",
            background: "transparent",
          }}
        >
          <Logo size={19} />
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            {me ? (
              <>
                <span title={me.email} style={{ fontSize: 13, color: "var(--w-3)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {me.email}
                </span>
                <button onClick={signOut} className="id-ghost" style={{ padding: "9px 16px" }}>Sign out</button>
              </>
            ) : (
              me === null && (
                <Link href="/login" className="id-ghost" style={{ padding: "9px 16px" }}>Sign in</Link>
              )
            )}
            <button onClick={() => setShowModal(true)} className="id-btn" style={{ padding: "10px 18px" }}>New deck</button>
          </div>
        </header>

        {!me && (
        <div
          className="id-hero-grid"
          style={{ padding: "clamp(28px,5vw,68px) clamp(20px,4vw,52px) clamp(70px,8vw,108px)", maxWidth: 1240, margin: "0 auto" }}
        >
          {/* copy */}
          <div>
            <Reveal delay={40}>
              <div className="id-label" style={{ color: "var(--gold)", marginBottom: 18, display: "inline-flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 22, height: 2, background: "var(--gold)" }} /> Powered by Claude + Scryfall
              </div>
            </Reveal>
            <Reveal delay={90}>
              <h1 className="id-display" style={{ fontSize: "clamp(52px, 8vw, 104px)", margin: "0 0 22px", color: "var(--w-1)" }}>
                Brew the<br />deck in<br />
                <span style={{ color: "var(--gold)" }}>your head.</span>
              </h1>
            </Reveal>
            <Reveal delay={150}>
              <p style={{ fontSize: "clamp(16px,1.5vw,19px)", lineHeight: 1.5, color: "var(--w-2)", maxWidth: 440, margin: "0 0 30px" }}>
                Describe what you want to play. Spellpool reads every card&apos;s rules text and hands you a pool to swipe — building to a legal 100 with the curve and color identity worked out for you.
              </p>
            </Reveal>
            <Reveal delay={210} style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
              <button className="id-btn" style={{ padding: "15px 26px", fontSize: 16 }} onClick={() => setShowModal(true)}>
                Start brewing →
              </button>
              <button className="id-ghost" style={{ padding: "14px 22px" }} onClick={seeSample}>
                See a sample deck
              </button>
            </Reveal>
          </div>

          {/* fanned cards */}
          <CardFan />
        </div>
        )}
      </div>

      {/* signed in: your decks + collection, on the blue field */}
      {me && (
        <div style={{ maxWidth: 1180, width: "100%", margin: "0 auto", padding: "clamp(36px,5vw,64px) clamp(20px,4vw,52px) 0" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, marginBottom: 30, flexWrap: "wrap" }}>
            <div>
              <div className="id-label" style={{ color: "var(--w-3)", marginBottom: 12 }}>Your decks</div>
              <h2 className="id-display" style={{ fontSize: "clamp(34px,4.5vw,52px)", margin: 0, color: "var(--w-1)" }}>Pick up where you left off.</h2>
            </div>
            <div style={{ display: "flex", gap: 28, paddingBottom: 4 }}>
              <CStat n={decks.length} label="Decks" />
              <CStat n={totalCards} label="Cards" />
              <CStat n={formatCount} label="Formats" accent />
            </div>
          </div>
          <DeckTable decks={decks} onOpen={(d) => router.push(`/deck/${d.publicId}`)} onDelete={deleteDeck} onNew={() => setShowModal(true)} showNew={loaded} />
          <CollectionBlock unique={collection.unique} total={collection.total} sample={collection.sample} onOpen={() => setShowCollection(true)} />
          <div style={{ height: 64 }} />
        </div>
      )}

      {/* HOW IT WORKS — deep neutral band (signed-out landing) */}
      {!me && (
        <div style={{ background: "#14101f", padding: "clamp(56px,7vw,96px) clamp(20px,4vw,52px)" }}>
          <div style={{ maxWidth: 1180, margin: "0 auto" }}>
            <Reveal>
              <div className="id-label" style={{ color: "var(--w-3)", marginBottom: 12 }}>How it works</div>
              <h2 className="id-display" style={{ fontSize: "clamp(34px,4.5vw,56px)", margin: "0 0 48px", maxWidth: 720, color: "var(--w-1)" }}>
                From a sentence to a sideboard.
              </h2>
            </Reveal>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 0 }}>
              {FEATURES.map((f, i) => (
                <Reveal key={f.n} delay={120 + i * 90}>
                  <div style={{ padding: "28px 28px 28px 0", borderTop: "1px solid var(--w-line)", marginRight: i < FEATURES.length - 1 ? 28 : 0, height: "100%" }}>
                    <div className="id-mono" style={{ fontSize: 13, color: "var(--gold)", marginBottom: 18 }}>{f.n}</div>
                    <div className="id-display" style={{ fontSize: 26, marginBottom: 10, color: "var(--w-1)" }}>{f.t}</div>
                    <p style={{ fontSize: 14.5, lineHeight: 1.55, color: "var(--w-2)", margin: 0 }}>{f.d}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* PUBLIC BREWS — color-identity showcase */}
      <div id="brews" style={{ background: "#0e0b18", padding: "clamp(56px,7vw,96px) clamp(20px,4vw,52px) clamp(72px,8vw,112px)", flex: 1 }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, marginBottom: 40, flexWrap: "wrap" }}>
            <div>
              <div className="id-label" style={{ color: "var(--w-3)", marginBottom: 12 }}>Public brews</div>
              <h2 className="id-display" style={{ fontSize: "clamp(34px,4.5vw,56px)", margin: 0, maxWidth: 640, color: "var(--w-1)" }}>
                Decks the pool is talking about.
              </h2>
            </div>
            <button className="id-pill-gold" style={{ padding: "11px 20px" }} onClick={() => setShowModal(true)}>New brew →</button>
          </div>
          <DeckTable decks={publicDecks} onOpen={(d) => router.push(`/deck/${d.publicId}`)} onDelete={deleteDeck} onNew={() => setShowModal(true)} showNew={loaded && !me} />
        </div>
      </div>

      {showCollection && <CollectionView onClose={() => setShowCollection(false)} onChanged={loadCollection} />}

      {showModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(8,6,18,.55)",
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
              boxShadow: "0 30px 70px -20px rgba(8,6,18,.6)",
              padding: "26px 28px 28px",
              width: "100%",
              maxWidth: 440,
              animation: "sp-pop .18s ease",
            }}
          >
            <h2 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 700, letterSpacing: "-.02em" }}>Begin a new deck</h2>
            <p style={{ margin: "0 0 18px", fontSize: 14.5, color: "var(--t2)", lineHeight: 1.5 }}>
              {me ? "Name your brew and choose a format." : "You're brewing as a guest — this deck will be public, and anyone can edit it."}
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

/* Flips true right after mount, driving CSS entrance transitions. */
function useRevealed() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

function Reveal({ delay = 0, style, children }: { delay?: number; style?: React.CSSProperties; children: React.ReactNode }) {
  return <div style={{ ...style, animation: `id-rise .6s cubic-bezier(.2,.8,.2,1) ${delay}ms both` }}>{children}</div>;
}

/* Fanned hand of real cards — staggered deal-in + idle float; hover lifts a card. */
function CardFan() {
  const [hov, setHov] = useState<number | null>(null);
  const fan = [
    { name: "Sol Ring", colors: ["C"] },
    { name: "Counterspell", colors: ["U"] },
    { name: "Braids, Conjurer Adept", colors: ["U"] },
  ];
  return (
    <div className="id-fan" style={{ position: "relative", height: 420, display: "flex", justifyContent: "center", alignItems: "center" }} aria-hidden="true">
      <div style={{ position: "relative", width: 300, height: 380 }}>
        {fan.map((c, i) => {
          const rot = (i - 1) * 13;
          const dx = (i - 1) * 86;
          const dy = Math.abs(i - 1) * 26;
          const hot = hov === i;
          const t = `translateX(-50%) translateX(${dx}px) translateY(${dy + (hot ? -26 : 0)}px) rotate(${hot ? 0 : rot}deg) scale(${hot ? 1.05 : 1})`;
          return (
            <div
              key={c.name}
              onMouseEnter={() => setHov(i)}
              onMouseLeave={() => setHov(null)}
              style={{
                position: "absolute",
                left: "50%",
                top: 12,
                width: 214,
                height: 300,
                cursor: "pointer",
                transformOrigin: "bottom center",
                transform: t,
                transition: "transform .42s cubic-bezier(.2,.8,.2,1)",
                zIndex: hot ? 10 : 5 - Math.abs(i - 1),
              }}
            >
              <div style={{ width: "100%", height: "100%", animation: `id-deal .85s cubic-bezier(.18,.86,.26,1) ${240 + i * 150}ms both` }}>
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: 14,
                    overflow: "hidden",
                    boxShadow: hot
                      ? "0 34px 60px -16px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.14)"
                      : "0 24px 50px -18px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08)",
                    animation: `id-float 6.5s ease-in-out ${1200 + i * 260}ms infinite`,
                  }}
                >
                  <CardArt name={c.name} colors={c.colors} version="normal" radius={14} style={{ width: "100%", height: "100%" }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CStat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div className="id-mono" style={{ fontSize: 32, fontWeight: 700, color: accent ? "var(--gold)" : "var(--w-1)", lineHeight: 1 }}>{n}</div>
      <div className="id-label" style={{ marginTop: 6, color: "var(--w-3)" }}>{label}</div>
    </div>
  );
}

/* ---------- "Your collection" home block ---------- */
function CollectionBlock({ unique, total, sample, onOpen }: { unique: number; total: number; sample: string[]; onOpen: () => void }) {
  return (
    <div style={{ marginTop: 56 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, paddingBottom: 20, borderBottom: "1px solid var(--w-line)" }}>
        <h2 className="id-display" style={{ margin: 0, fontSize: "clamp(24px, 4vw, 32px)", color: "var(--w-1)" }}>Your collection</h2>
        <span className="id-mono" style={{ fontSize: 12.5, color: "var(--w-3)" }}>{unique > 0 ? `${unique} unique · ${total} total` : "nothing yet"}</span>
        <button onClick={onOpen} className="id-ghost" style={{ marginLeft: "auto", padding: "9px 18px" }}>
          {unique > 0 ? "Browse →" : "Import →"}
        </button>
      </div>
      {unique > 0 ? (
        <button
          onClick={onOpen}
          aria-label="Browse your collection"
          className="coll-sample"
          style={{ marginTop: 20, padding: 0, border: "none", background: "transparent", cursor: "pointer", width: "100%" }}
        >
          {sample.map((name) => (
            <div key={name} style={{ minWidth: 0, borderRadius: 10, overflow: "hidden", boxShadow: "0 6px 16px -8px rgba(0,0,0,.5)" }}>
              <CardArt name={name} colors={["C"]} version="normal" radius={10} style={{ aspectRatio: "5 / 7" }} />
            </div>
          ))}
        </button>
      ) : (
        <p style={{ marginTop: 18, fontSize: 15, color: "var(--w-2)", lineHeight: 1.5 }}>
          Import the cards you own to track them across decks, see what you can build for free, and let the AI factor it in.{" "}
          <button onClick={onOpen} style={{ background: "none", border: "none", padding: 0, color: "var(--gold)", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>
            Import your collection
          </button>
          .
        </p>
      )}
    </div>
  );
}

/* ---------- color-identity deck tiles ---------- */
function DeckTable({
  decks,
  onOpen,
  onDelete,
  onNew,
  showNew,
}: {
  decks: Deck[];
  onOpen: (d: Deck) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  showNew: boolean;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))", gap: 22 }}>
      {decks.map((d, i) => (
        <DeckTile key={d.id} deck={d} index={i} onOpen={() => onOpen(d)} onDelete={() => onDelete(d.publicId)} />
      ))}
      {showNew && <NewDeckTile onNew={onNew} />}
    </div>
  );
}

function DeckTile({ deck, index, onOpen, onDelete }: { deck: Deck; index: number; onOpen: () => void; onDelete: () => void }) {
  const [hover, setHover] = useState(false);
  const colors = deck.colors?.length ? deck.colors : ["C"];
  const field = getIdentityField(colors.join(""));
  const count = deck._count?.cards || 0;
  const target = deckTarget(deck.format);
  const pct = Math.min(1, count / Math.max(1, target));
  return (
    <Reveal delay={60 + Math.min(index, 8) * 50}>
      <div style={{ position: "relative" }}>
        <button
          onClick={onOpen}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            textAlign: "left",
            cursor: "pointer",
            width: "100%",
            padding: 0,
            border: "none",
            borderRadius: 18,
            overflow: "hidden",
            position: "relative",
            color: "#fff",
            background: `linear-gradient(165deg, ${field.bg}, ${field.deep})`,
            boxShadow: hover
              ? "0 0 0 2px var(--gold), 0 26px 50px -22px rgba(0,0,0,.7)"
              : "0 0 0 1px rgba(255,255,255,.06), 0 16px 38px -26px rgba(0,0,0,.7)",
            transform: hover ? "translateY(-4px)" : "none",
            transition: "transform .2s, box-shadow .2s",
          }}
        >
          <div style={{ position: "relative", height: 132 }}>
            <CardArt name={deck.commander || deck.name} colors={colors} version="art_crop" radius={0} style={{ position: "absolute", inset: 0 }} />
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, transparent 30%, ${field.deep}ee)` }} />
            <div style={{ position: "absolute", top: 12, left: 14 }}>
              <ColorPips colors={colors} size={20} />
            </div>
            <span
              style={{
                position: "absolute",
                top: 13,
                right: 14,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "rgba(255,255,255,.78)",
                background: "rgba(0,0,0,.32)",
                padding: "3px 8px",
                borderRadius: 6,
                textTransform: "capitalize",
                opacity: hover ? 0 : 1,
                transition: "opacity .15s",
              }}
            >
              {deck.format}
            </span>
          </div>
          <div style={{ padding: "14px 18px 18px" }}>
            <div className="id-display" style={{ fontSize: 30, lineHeight: 0.9, marginBottom: 5, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {deck.name}
            </div>
            <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.78)", marginBottom: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {deck.commander || "An untitled brew"}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ flex: 1, height: 6, borderRadius: 4, background: "rgba(255,255,255,.16)", overflow: "hidden" }}>
                <div style={{ width: `${pct * 100}%`, height: "100%", background: "var(--gold)", borderRadius: 4 }} />
              </div>
              <span className="id-mono" style={{ fontSize: 12.5, color: "#fff", fontWeight: 600 }}>
                {count}
                <span style={{ color: "rgba(255,255,255,.55)" }}>/{target}</span>
              </span>
            </div>
          </div>
        </button>
        <button
          onClick={onDelete}
          title="Delete deck"
          aria-label="Delete deck"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 24,
            height: 24,
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            background: "rgba(0,0,0,.5)",
            color: "#fff",
            fontSize: 11,
            opacity: hover ? 1 : 0,
            transition: "opacity .15s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2,
          }}
        >
          ✕
        </button>
      </div>
    </Reveal>
  );
}

function NewDeckTile({ onNew }: { onNew: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onNew}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        minHeight: 250,
        borderRadius: 18,
        border: "1.5px dashed var(--w-line-2)",
        background: hover ? "var(--w-fill)" : "transparent",
        color: "var(--w-2)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        transition: "background .15s, border-color .15s",
        borderColor: hover ? "var(--gold)" : "var(--w-line-2)",
      }}
    >
      <span className="id-display" style={{ fontSize: 34, color: hover ? "var(--gold)" : "var(--w-2)", lineHeight: 1 }}>+</span>
      <span className="id-label" style={{ color: "var(--w-1)" }}>New deck</span>
    </button>
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
