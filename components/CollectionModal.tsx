"use client";

import { useEffect, useState } from "react";
import { LIGHT_VARS } from "@/lib/identity-theme";
import {
  Collection,
  EMPTY_COLLECTION,
  clearCollection,
  fetchCollection,
  importCollection,
  setCollectionCard,
} from "@/lib/collection-client";

// Cap the rendered rows so a huge collection stays snappy; search narrows it.
const MAX_ROWS = 300;

/* Account-level collection manager. Browse what you own (search + edit/remove),
   or import a pasted card list (Moxfield / Deckbox / plain "{qty} {name}"). The
   deck and pool lists badge owned cards and the AI factors the collection in.
   Stored by name only, so even a huge collection imports instantly. */
export default function CollectionModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [collection, setCollection] = useState<Collection>(EMPTY_COLLECTION);
  const [view, setView] = useState<"browse" | "import">("browse");
  const [search, setSearch] = useState("");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [busy, setBusy] = useState(false);
  // nameKey of the row whose quantity is currently saving.
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setCollection(await fetchCollection());
  }
  useEffect(() => {
    reload();
  }, []);

  async function runImport() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    const r = await importCollection(text, mode);
    if (!r.ok) setError(r.error ?? "Import failed.");
    else {
      setSummary(`${mode === "replace" ? "Replaced" : "Merged"} — ${r.unique} unique cards, ${r.total} total.`);
      setText("");
      await reload();
      onChanged?.();
      setView("browse");
    }
    setBusy(false);
  }

  async function runClear() {
    if (busy || collection.unique === 0) return;
    if (!confirm("Clear your whole collection? This can't be undone.")) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    const ok = await clearCollection();
    if (ok) {
      setSummary("Collection cleared.");
      await reload();
      onChanged?.();
    } else setError("Couldn't clear the collection.");
    setBusy(false);
  }

  // Edit one card's owned count; 0 removes it.
  async function editQty(name: string, next: number) {
    const key = name.toLowerCase();
    setRowBusy(key);
    const ok = await setCollectionCard(name, next);
    if (ok) {
      await reload();
      onChanged?.();
    }
    setRowBusy(null);
  }

  const q = search.trim().toLowerCase();
  const filtered = q ? collection.cards.filter((c) => c.name.toLowerCase().includes(q)) : collection.cards;
  const shown = filtered.slice(0, MAX_ROWS);

  return (
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
        zIndex: 60,
        animation: "sp-fade .15s ease",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          ...LIGHT_VARS,
          background: "var(--bg)",
          color: "var(--t1)",
          borderRadius: 20,
          boxShadow: "0 30px 70px -20px rgba(21,21,26,.4)",
          padding: "24px 26px 24px",
          width: "100%",
          maxWidth: 480,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          animation: "sp-pop .18s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.02em" }}>Your collection</h2>
          <span className="mn-label">
            {collection.unique > 0 ? `${collection.unique} unique · ${collection.total} total` : "empty"}
          </span>
        </div>

        {/* view toggle */}
        <div style={{ display: "inline-flex", alignSelf: "flex-start", borderRadius: 999, background: "var(--bg3)", padding: 3, margin: "14px 0 4px" }}>
          {(["browse", "import"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => { setView(v); setError(null); setSummary(null); }}
              style={{
                padding: "6px 16px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font-ui)",
                fontSize: 13,
                fontWeight: 600,
                background: view === v ? "var(--accent)" : "transparent",
                color: view === v ? "var(--accent-ink)" : "var(--t2)",
              }}
            >
              {v === "browse" ? "Browse" : "Import"}
            </button>
          ))}
        </div>

        {view === "browse" ? (
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
            {collection.unique === 0 ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--t2)", fontSize: 14, lineHeight: 1.5 }}>
                No cards yet.{" "}
                <button type="button" onClick={() => setView("import")} style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
                  Import your collection
                </button>{" "}
                to get started.
              </div>
            ) : (
              <>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search your cards…"
                  style={{
                    width: "100%",
                    margin: "10px 0",
                    padding: "10px 12px",
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    background: "var(--bg2)",
                    color: "var(--t1)",
                    outline: "none",
                  }}
                />
                <div style={{ overflowY: "auto", flex: 1, minHeight: 120, display: "flex", flexDirection: "column", gap: 2 }}>
                  {shown.map((c) => (
                    <div
                      key={c.name}
                      style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, background: "var(--bg2)" }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.name}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button type="button" aria-label={`Remove one ${c.name}`} disabled={rowBusy === c.name.toLowerCase()} onClick={() => editQty(c.name, c.quantity - 1)} style={qtyBtn}>−</button>
                        <span style={{ minWidth: 22, textAlign: "center", fontFamily: "var(--font-mono, monospace)", fontSize: 14, fontWeight: 700, color: "var(--t1)" }}>
                          {rowBusy === c.name.toLowerCase() ? "…" : c.quantity}
                        </span>
                        <button type="button" aria-label={`Add one ${c.name}`} disabled={rowBusy === c.name.toLowerCase()} onClick={() => editQty(c.name, c.quantity + 1)} style={qtyBtn}>+</button>
                        <button type="button" aria-label={`Remove ${c.name} entirely`} disabled={rowBusy === c.name.toLowerCase()} onClick={() => editQty(c.name, 0)} style={{ ...qtyBtn, color: "var(--danger)", marginLeft: 2 }}>✕</button>
                      </div>
                    </div>
                  ))}
                  {filtered.length > shown.length && (
                    <p style={{ margin: "8px 4px", fontSize: 12.5, color: "var(--t3)", textAlign: "center" }}>
                      Showing {shown.length} of {filtered.length} — search to narrow down.
                    </p>
                  )}
                  {filtered.length === 0 && (
                    <p style={{ margin: "16px 4px", fontSize: 13.5, color: "var(--t3)", textAlign: "center" }}>No matches for “{search}”.</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={runClear}
                  disabled={busy}
                  className="mn-ghost"
                  style={{ alignSelf: "flex-start", marginTop: 12, padding: "8px 16px", fontSize: 13 }}
                >
                  Clear all
                </button>
              </>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <p style={{ margin: "10px 0 12px", fontSize: 14, color: "var(--t2)", lineHeight: 1.5 }}>
              Paste the cards you own — one per line (<code>1 Sol Ring</code>), or a Moxfield/Deckbox export.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
              placeholder={"1 Sol Ring\n1 Cyclonic Rift\n4 Llanowar Elves"}
              style={{
                width: "100%",
                minHeight: 170,
                resize: "vertical",
                border: "1px solid var(--line)",
                borderRadius: 12,
                padding: "12px 14px",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 13.5,
                lineHeight: 1.5,
                background: "var(--bg2)",
                color: "var(--t1)",
                outline: "none",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
              <span className="mn-label">On import</span>
              <div style={{ display: "inline-flex", borderRadius: 999, background: "var(--bg3)", padding: 3 }}>
                {(["add", "replace"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 999,
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "var(--font-ui)",
                      fontSize: 13,
                      fontWeight: 600,
                      background: mode === m ? "var(--accent)" : "transparent",
                      color: mode === m ? "var(--accent-ink)" : "var(--t2)",
                    }}
                  >
                    {m === "add" ? "Add to it" : "Replace it"}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" onClick={runImport} disabled={busy || !text.trim()} className="mn-btn" style={{ alignSelf: "flex-end", marginTop: 14, padding: "10px 24px", fontSize: 14 }}>
              {busy ? "Saving…" : "Import"}
            </button>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, color: "var(--danger)", fontSize: 13.5, padding: "10px 14px", background: "rgba(194,64,42,.07)", borderRadius: 10, boxShadow: "inset 0 0 0 1px rgba(194,64,42,.25)" }}>
            {error}
          </div>
        )}
        {summary && !error && (
          <div style={{ marginTop: 12, color: "#0d8a5f", fontSize: 13.5, padding: "10px 14px", background: "rgba(13,138,95,.08)", borderRadius: 10, boxShadow: "inset 0 0 0 1px rgba(13,138,95,.28)" }}>
            {summary}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" onClick={onClose} className="mn-ghost" style={{ padding: "10px 20px", fontSize: 14 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const qtyBtn: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 7,
  border: "1px solid var(--line)",
  cursor: "pointer",
  background: "var(--bg)",
  color: "var(--t1)",
  fontFamily: "var(--font-display)",
  fontSize: 15,
  fontWeight: 700,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
