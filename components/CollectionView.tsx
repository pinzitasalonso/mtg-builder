"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getIdentityTheme } from "@/lib/identity-theme";
import {
  Collection,
  CollectionCard,
  EMPTY_COLLECTION,
  clearCollection,
  fetchCollection,
  importCollection,
  setCollectionCard,
} from "@/lib/collection-client";
import { parseDecklist } from "@/lib/decklist";
import { categoryOf, manaValue, TYPE_ORDER } from "@/components/mtg";

// Tiles render in pages; scrolling near the bottom reveals the next page, so a
// filtered set shows every match without dumping thousands of nodes at once.
const PAGE = 120;

const theme = getIdentityTheme(null);

const COLORS: { code: string; label: string; bg: string }[] = [
  { code: "W", label: "White", bg: "#dcd1a4" },
  { code: "U", label: "Blue", bg: "#4a90c9" },
  { code: "B", label: "Black", bg: "#9b85b5" },
  { code: "R", label: "Red", bg: "#d96b45" },
  { code: "G", label: "Green", bg: "#58a877" },
  { code: "C", label: "Colorless", bg: "#b8b6ae" },
];
const TYPES = TYPE_ORDER.filter((t) => t !== "Other");
const MVS = [0, 1, 2, 3, 4, 5, 6, 7];

function namedImageUrl(name: string): string {
  return `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}&format=image&version=normal`;
}

interface Preview {
  src: string;
  rect: DOMRect;
}

/* Full-screen collection browser: search, color/type/mana-value filters, a card
   grid with hover previews, and per-card quantity editing. Cards arrive with
   server-resolved Scryfall metadata (color/type/mana value) so the filters work
   on the whole collection; while the server is still resolving newer cards the
   `pending` count drives a short poll. */
export default function CollectionView({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [collection, setCollection] = useState<Collection>(EMPTY_COLLECTION);
  // Server is still resolving metadata for some cards; filters fill in as it does.
  const indexing = collection.pending > 0;

  const [search, setSearch] = useState("");
  const [colorSel, setColorSel] = useState<Set<string>>(new Set());
  const [typeSel, setTypeSel] = useState<string | null>(null);
  const [mvSel, setMvSel] = useState<number | null>(null);
  const [sort, setSort] = useState<"name" | "qty" | "mv">("name");

  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  // Infinite-scroll window: how many of the filtered cards are rendered.
  const [visible, setVisible] = useState(PAGE);
  const gridRef = useRef<HTMLDivElement>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<"add" | "replace">("add");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Load the collection; cards already carry server-resolved metadata.
  async function load() {
    const c = await fetchCollection();
    setCollection(c);
    return c;
  }
  useEffect(() => {
    load();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Each GET resolves another batch of cards server-side; poll until none remain
  // so the filters end up backed by the whole collection (persisted thereafter).
  useEffect(() => {
    if (collection.pending <= 0) return;
    const t = setTimeout(() => {
      load();
    }, 500);
    return () => clearTimeout(t);
  }, [collection.pending, collection.unique]);

  // Edit one card's quantity (0 removes). Update locally to avoid re-enriching.
  async function editQty(name: string, next: number) {
    const key = name.toLowerCase();
    setRowBusy(key);
    const ok = await setCollectionCard(name, next);
    if (ok) {
      setCollection((c) => {
        const cards =
          next <= 0
            ? c.cards.filter((x) => x.name.toLowerCase() !== key)
            : c.cards.map((x) => (x.name.toLowerCase() === key ? { ...x, quantity: next } : x));
        return { ...c, cards, unique: cards.length, total: cards.reduce((s, x) => s + x.quantity, 0) };
      });
      onChanged?.();
    }
    setRowBusy(null);
  }

  async function runImport() {
    if (!importText.trim() || busy) return;
    setBusy(true);
    setNote(null);
    const text = importText;
    const mode = importMode;
    const r = await importCollection(text, mode);
    if (!r.ok) {
      setNote(r.error ?? "Import failed.");
      setBusy(false);
      return;
    }
    // Optimistically reflect the import right away so the grid never flashes the
    // old list or an empty state while the server round-trip + enrichment finish.
    const parsed = parseDecklist(text);
    setCollection((prev) => {
      const map = new Map<string, CollectionCard>();
      if (mode === "add") for (const c of prev.cards) map.set(c.name.toLowerCase(), { ...c });
      for (const e of parsed) {
        const k = e.name.toLowerCase();
        const ex = map.get(k);
        if (ex) ex.quantity += e.qty;
        else map.set(k, { name: e.name, quantity: e.qty });
      }
      const cards = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
      return { cards, unique: cards.length, total: cards.reduce((s, x) => s + x.quantity, 0), pending: cards.length };
    });
    setImportText("");
    setImportOpen(false);
    setNote(`${mode === "replace" ? "Replaced" : "Merged"} — ${r.unique} unique, ${r.total} total.`);
    setBusy(false);
    onChanged?.();
    // Reconcile with the server (canonical counts + kicks off enrichment/polling).
    load();
  }

  async function runClear() {
    if (busy || collection.unique === 0) return;
    if (!confirm("Clear your whole collection? This can't be undone.")) return;
    setBusy(true);
    if (await clearCollection()) {
      setCollection(EMPTY_COLLECTION);
      onChanged?.();
    }
    setBusy(false);
  }

  const metaFiltersActive = colorSel.size > 0 || typeSel !== null || mvSel !== null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = collection.cards.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q)) return false;
      if (!metaFiltersActive) return true;
      // Resolved cards always carry a type line; if it's missing the card is
      // either still being indexed or didn't resolve — it can't match.
      if (c.typeLine == null) return false;
      if (colorSel.size > 0) {
        const ci = (c.colorIdentity ?? "").replace(/[^WUBRG]/g, "");
        const isColorless = ci.length === 0;
        // AND: the card's color identity must contain every selected color.
        const matches = [...colorSel].every((c2) => (c2 === "C" ? isColorless : ci.includes(c2)));
        if (!matches) return false;
      }
      if (typeSel && categoryOf(c.typeLine) !== typeSel) return false;
      if (mvSel !== null && Math.min(manaValue(c.manaCost ?? null), 7) !== mvSel) return false;
      return true;
    });
    out.sort((a, b) => {
      if (sort === "qty") return b.quantity - a.quantity || a.name.localeCompare(b.name);
      if (sort === "mv") return manaValue(a.manaCost ?? null) - manaValue(b.manaCost ?? null) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    return out;
  }, [collection.cards, search, colorSel, typeSel, mvSel, sort, metaFiltersActive]);

  const shown = filtered.slice(0, visible);

  // A new search/filter/sort resets the window and scrolls back to the top.
  useEffect(() => {
    setVisible(PAGE);
    gridRef.current?.scrollTo({ top: 0 });
  }, [search, colorSel, typeSel, mvSel, sort]);

  function clearFilters() {
    setSearch("");
    setColorSel(new Set());
    setTypeSel(null);
    setMvSel(null);
  }
  const anyFilter = search.trim() !== "" || metaFiltersActive;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        ...theme.vars,
        background: theme.bg,
        color: theme.text,
        display: "flex",
        flexDirection: "column",
        animation: "sp-fade .15s ease",
      }}
    >
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 22px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".02em", color: "var(--text)" }}>
            Collection
          </h1>
          <span className="mn-label" style={{ color: "var(--text-muted)" }}>
            {collection.unique > 0 ? `${collection.unique} unique · ${collection.total} total` : "empty"}
            {indexing ? " · indexing…" : ""}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setImportOpen((v) => !v)} className="mn-btn" style={{ padding: "9px 18px", fontSize: 14 }}>
            Import
          </button>
          <button onClick={onClose} aria-label="Close collection" className="mn-ghost" style={{ padding: "9px 16px", fontSize: 14 }}>
            ✕ Close
          </button>
        </div>
      </div>

      {/* import panel */}
      {importOpen && (
        <div style={{ padding: "14px 22px", borderBottom: "1px solid var(--line)", background: "var(--bg3)" }}>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            disabled={busy}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder={"Paste a list — 1 Sol Ring, 4 Llanowar Elves, or a Moxfield/Deckbox export"}
            style={{ width: "100%", minHeight: 110, resize: "vertical", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", fontFamily: "var(--font-mono, monospace)", fontSize: 16, lineHeight: 1.5, background: "var(--surface)", color: "var(--text)", outline: "none" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", borderRadius: 999, background: "var(--surface)", padding: 3 }}>
              {(["add", "replace"] as const).map((m) => (
                <button key={m} onClick={() => setImportMode(m)} style={{ padding: "5px 12px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, background: importMode === m ? "var(--accent)" : "transparent", color: importMode === m ? "var(--accent-ink)" : "var(--text-muted)" }}>
                  {m === "add" ? "Add to it" : "Replace it"}
                </button>
              ))}
            </div>
            <button onClick={runImport} disabled={busy || !importText.trim()} className="mn-btn" style={{ padding: "8px 18px", fontSize: 13.5 }}>
              {busy ? "Saving…" : "Import"}
            </button>
            <button onClick={runClear} disabled={busy || collection.unique === 0} className="mn-ghost" style={{ padding: "8px 14px", fontSize: 13 }}>
              Clear all
            </button>
            {note && <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{note}</span>}
          </div>
        </div>
      )}

      {/* filter bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 22px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          style={{ width: 200, maxWidth: "60vw", padding: "9px 14px", border: "1px solid var(--line)", borderRadius: 999, background: "var(--bg3)", color: "var(--text)", outline: "none", fontSize: 16 }}
        />
        <div style={{ display: "flex", gap: 6 }} title={indexing ? "Indexing — color filters available shortly" : undefined}>
          {COLORS.map((c) => {
            const on = colorSel.has(c.code);
            return (
              <button
                key={c.code}
                onClick={() => setColorSel((s) => { const n = new Set(s); n.has(c.code) ? n.delete(c.code) : n.add(c.code); return n; })}
                title={c.label}
                aria-pressed={on}
                style={{ width: 26, height: 26, borderRadius: "50%", border: "none", cursor: "pointer", background: c.bg, color: "#fff", fontWeight: 700, fontSize: 12, opacity: on || colorSel.size === 0 ? 1 : 0.4, boxShadow: on ? "0 0 0 2px var(--text)" : "inset 0 0 0 1px rgba(0,0,0,.1)" }}
              >
                {c.code}
              </button>
            );
          })}
        </div>
        <select
          value={typeSel ?? ""}
          onChange={(e) => setTypeSel(e.target.value || null)}
          style={{ padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 999, background: "var(--bg3)", color: "var(--text)", fontSize: 13.5, cursor: "pointer" }}
        >
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <div style={{ display: "flex", gap: 4 }}>
          {MVS.map((v) => {
            const on = mvSel === v;
            return (
              <button key={v} onClick={() => setMvSel(on ? null : v)} style={{ width: 28, height: 28, borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: on ? "var(--accent)" : "var(--bg3)", color: on ? "var(--accent-ink)" : "var(--text-muted)" }}>
                {v === 7 ? "7+" : v}
              </button>
            );
          })}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as "name" | "qty" | "mv")} style={{ padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 999, background: "var(--bg3)", color: "var(--text)", fontSize: 13.5, cursor: "pointer" }}>
          <option value="name">Sort: Name</option>
          <option value="qty">Sort: Quantity</option>
          <option value="mv">Sort: Mana value</option>
        </select>
        <span style={{ fontSize: 13, color: "var(--text-muted)", marginLeft: "auto" }}>
          {filtered.length} card{filtered.length === 1 ? "" : "s"}
          {anyFilter && (
            <button onClick={clearFilters} style={{ marginLeft: 10, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 13 }}>Clear filters</button>
          )}
        </span>
      </div>

      {/* grid */}
      <div
        ref={gridRef}
        onScroll={(e) => {
          setPreview(null);
          const el = e.currentTarget;
          // Near the bottom — reveal the next page of matches.
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 700) {
            setVisible((v) => (v < filtered.length ? Math.min(filtered.length, v + PAGE) : v));
          }
        }}
        style={{ flex: 1, overflowY: "auto", padding: "18px 22px 40px" }}
      >
        {collection.unique === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "60px 20px", fontSize: 15 }}>
            Your collection is empty.{" "}
            <button onClick={() => setImportOpen(true)} style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 600, cursor: "pointer", textDecoration: "underline", fontSize: 15 }}>
              Import a list
            </button>{" "}
            to fill it.
          </div>
        ) : (
          <>
            {indexing && metaFiltersActive && (
              <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13.5, margin: "0 0 14px" }}>
                Still indexing your collection — more matches will appear as cards are read…
              </p>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))", gap: 14 }}>
              {shown.map((c) => (
                <CollectionTile
                  key={c.name}
                  name={c.name}
                  quantity={c.quantity}
                  imageUri={c.imageUri ?? null}
                  busy={rowBusy === c.name.toLowerCase()}
                  onPreview={setPreview}
                  onInc={() => editQty(c.name, c.quantity + 1)}
                  onDec={() => editQty(c.name, c.quantity - 1)}
                  onDelete={() => editQty(c.name, 0)}
                />
              ))}
            </div>
            {filtered.length > shown.length && (
              <p style={{ textAlign: "center", color: "var(--text-dim)", fontSize: 13, marginTop: 18 }}>
                Loading more… {shown.length} of {filtered.length}
              </p>
            )}
            {filtered.length === 0 && !indexing && (
              <p style={{ textAlign: "center", color: "var(--text-dim)", fontSize: 14, marginTop: 40 }}>No cards match these filters.</p>
            )}
          </>
        )}
      </div>

      {preview && <CardPreview preview={preview} />}
    </div>
  );
}

function CollectionTile({
  name,
  quantity,
  imageUri,
  busy,
  onPreview,
  onInc,
  onDec,
  onDelete,
}: {
  name: string;
  quantity: number;
  imageUri: string | null;
  busy: boolean;
  onPreview: (p: Preview | null) => void;
  onInc: () => void;
  onDec: () => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);
  // Prefer the persisted CDN image (cards.scryfall.io) — it isn't rate-limited,
  // so a screenful loading at once is fine. Fall back to the rate-limited
  // by-name API endpoint only while a card is still awaiting enrichment.
  const base = imageUri || namedImageUrl(name);
  // Retry transient failures (e.g. a 429 burst while scrolling) a few times with
  // backoff before giving up to the text fallback; a cache-buster forces reload.
  const [attempt, setAttempt] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setAttempt(0);
    setImgFailed(false);
  }, [base]);
  const src = attempt === 0 ? base : `${base}${base.includes("?") ? "&" : "?"}retry=${attempt}`;
  return (
    <div
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        setHover(true);
        onPreview({ src: base, rect: e.currentTarget.getBoundingClientRect() });
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        setHover(false);
        onPreview(null);
      }}
      style={{
        position: "relative",
        borderRadius: "4.8%/3.5%",
        overflow: "hidden",
        aspectRatio: "5 / 7",
        background: "rgba(0,0,0,.28)",
        boxShadow: hover ? "0 14px 30px -10px rgba(0,0,0,.6)" : "0 4px 12px -4px rgba(0,0,0,.45)",
        transform: hover ? "translateY(-3px)" : "none",
        transition: "transform .16s ease, box-shadow .16s ease",
      }}
    >
      {imgFailed ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 10, textAlign: "center", fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,.82)" }}>
          {name}
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          loading="lazy"
          decoding="async"
          onError={() => {
            if (attempt < 4) {
              const next = attempt + 1;
              // Stagger retries so a whole screen doesn't hammer Scryfall in lockstep.
              setTimeout(() => setAttempt(next), 500 * next + Math.random() * 400);
            } else {
              setImgFailed(true);
            }
          }}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      )}
      <span style={{ position: "absolute", top: 7, left: 7, background: "rgba(13,138,95,.92)", color: "#fff", fontSize: 12, fontWeight: 800, padding: "1px 8px", borderRadius: 999, boxShadow: "0 1px 4px rgba(0,0,0,.35)" }}>
        ×{busy ? "…" : quantity}
      </span>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6, padding: 6, background: "linear-gradient(transparent, rgba(0,0,0,.6))", opacity: hover ? 1 : 0, transition: "opacity .15s" }}>
        <button onClick={onDec} disabled={busy} aria-label={`Remove one ${name}`} style={tileBtn}>−</button>
        <button onClick={onInc} disabled={busy} aria-label={`Add one ${name}`} style={tileBtn}>+</button>
        <button onClick={onDelete} disabled={busy} aria-label={`Remove all ${name}`} style={{ ...tileBtn, color: "#ff9b8a" }}>✕</button>
      </div>
    </div>
  );
}

const tileBtn: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 7,
  border: "none",
  cursor: "pointer",
  background: "rgba(10,8,6,.78)",
  color: "#fff",
  fontSize: 14,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backdropFilter: "blur(4px)",
};

/* Floating full-card preview anchored to the hovered tile. Non-interactive. */
function CardPreview({ preview }: { preview: Preview }) {
  const W = 240;
  const H = 334;
  const { rect } = preview;
  const right = rect.right + W + 16 < window.innerWidth;
  const left = right ? rect.right + 10 : Math.max(8, rect.left - W - 10);
  const top = Math.max(8, Math.min(rect.top, window.innerHeight - H - 8));
  return (
    <div style={{ position: "fixed", top, left, width: W, zIndex: 90, pointerEvents: "none", animation: "sp-fade .12s ease" }}>
      <div className="cc-black" style={{ padding: 6 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview.src} alt="" draggable={false} style={{ width: "100%", height: "auto", display: "block", borderRadius: 8 }} />
      </div>
    </div>
  );
}
