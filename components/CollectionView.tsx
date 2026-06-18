"use client";

import { useEffect, useMemo, useState } from "react";
import { getIdentityTheme } from "@/lib/identity-theme";
import {
  Collection,
  EMPTY_COLLECTION,
  clearCollection,
  fetchCollection,
  importCollection,
  setCollectionCard,
} from "@/lib/collection-client";
import { collectionByName, OutCard } from "@/lib/scryfall";
import { categoryOf, manaValue, TYPE_ORDER } from "@/components/mtg";

// Card metadata for filters/images can't be stored at import time (collections
// can be huge), so enrich from Scryfall's bulk endpoint here. The cap is high
// enough to cover any realistic collection so the metadata filters apply to
// every card, not just an early slice.
const MAX_ENRICH = 12000;
// Cap rendered tiles for snappiness; filters/search narrow the set.
const MAX_TILES = 240;

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
   grid with hover previews, and per-card quantity editing. Card metadata is
   enriched from Scryfall on open so the metadata filters and tile art work. */
export default function CollectionView({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [collection, setCollection] = useState<Collection>(EMPTY_COLLECTION);
  const [meta, setMeta] = useState<Map<string, OutCard>>(new Map());
  const [indexing, setIndexing] = useState(false);

  const [search, setSearch] = useState("");
  const [colorSel, setColorSel] = useState<Set<string>>(new Set());
  const [typeSel, setTypeSel] = useState<string | null>(null);
  const [mvSel, setMvSel] = useState<number | null>(null);
  const [sort, setSort] = useState<"name" | "qty" | "mv">("name");

  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<"add" | "replace">("add");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Load the collection, then enrich a bounded slice for filters + art.
  async function load() {
    const c = await fetchCollection();
    setCollection(c);
    return c;
  }
  async function enrich(c: Collection) {
    if (c.cards.length === 0) {
      setMeta(new Map());
      return;
    }
    setIndexing(true);
    const names = c.cards.slice(0, MAX_ENRICH).map((card) => card.name);
    // Enrich in batches and flush into state as each lands, so filtered results
    // fill in progressively instead of blocking on the whole collection.
    const acc = new Map<string, OutCard>();
    const BATCH = 300;
    for (let i = 0; i < names.length; i += BATCH) {
      const part = await collectionByName(names.slice(i, i + BATCH));
      for (const [k, v] of part) acc.set(k, v);
      setMeta(new Map(acc));
    }
    setIndexing(false);
  }
  useEffect(() => {
    load().then(enrich);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        return { cards, unique: cards.length, total: cards.reduce((s, x) => s + x.quantity, 0) };
      });
      onChanged?.();
    }
    setRowBusy(null);
  }

  async function runImport() {
    if (!importText.trim() || busy) return;
    setBusy(true);
    setNote(null);
    const r = await importCollection(importText, importMode);
    if (!r.ok) setNote(r.error ?? "Import failed.");
    else {
      setImportText("");
      setImportOpen(false);
      setNote(`${importMode === "replace" ? "Replaced" : "Merged"} — ${r.unique} unique, ${r.total} total.`);
      const c = await load();
      await enrich(c);
      onChanged?.();
    }
    setBusy(false);
  }

  async function runClear() {
    if (busy || collection.unique === 0) return;
    if (!confirm("Clear your whole collection? This can't be undone.")) return;
    setBusy(true);
    if (await clearCollection()) {
      setCollection(EMPTY_COLLECTION);
      setMeta(new Map());
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
      const m = meta.get(c.name.toLowerCase());
      if (!m) return false; // not enriched / unknown — can't satisfy metadata filters
      if (colorSel.size > 0) {
        const ci = (m.colorIdentity ?? "").replace(/[^WUBRG]/g, "");
        const isColorless = ci.length === 0;
        const matches = [...colorSel].some((c2) => (c2 === "C" ? isColorless : ci.includes(c2)));
        if (!matches) return false;
      }
      if (typeSel && categoryOf(m.typeLine) !== typeSel) return false;
      if (mvSel !== null && Math.min(manaValue(m.manaCost), 7) !== mvSel) return false;
      return true;
    });
    const byMv = (c: { name: string }) => {
      const m = meta.get(c.name.toLowerCase());
      return m ? manaValue(m.manaCost) : 99;
    };
    out.sort((a, b) => {
      if (sort === "qty") return b.quantity - a.quantity || a.name.localeCompare(b.name);
      if (sort === "mv") return byMv(a) - byMv(b) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    return out;
  }, [collection.cards, meta, search, colorSel, typeSel, mvSel, sort, metaFiltersActive]);

  const shown = filtered.slice(0, MAX_TILES);

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
            placeholder={"Paste a list — 1 Sol Ring, 4 Llanowar Elves, or a Moxfield/Deckbox export"}
            style={{ width: "100%", minHeight: 90, resize: "vertical", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontFamily: "var(--font-mono, monospace)", fontSize: 13, background: "var(--surface)", color: "var(--text)", outline: "none" }}
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
          style={{ width: 200, maxWidth: "60vw", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 999, background: "var(--bg3)", color: "var(--text)", outline: "none", fontSize: 14 }}
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
      <div onScroll={() => setPreview(null)} style={{ flex: 1, overflowY: "auto", padding: "18px 22px 40px" }}>
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
                  card={meta.get(c.name.toLowerCase())}
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
                Showing {shown.length} of {filtered.length} — refine your search or filters to see more.
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
  card,
  busy,
  onPreview,
  onInc,
  onDec,
  onDelete,
}: {
  name: string;
  quantity: number;
  card: OutCard | undefined;
  busy: boolean;
  onPreview: (p: Preview | null) => void;
  onInc: () => void;
  onDec: () => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);
  const src = card?.imageUri || "";
  return (
    <div
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        setHover(true);
        onPreview({ src: src || namedImageUrl(name), rect: e.currentTarget.getBoundingClientRect() });
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
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      ) : (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 10, textAlign: "center", fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,.82)" }}>
          {name}
        </div>
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
