"use client";

import { useEffect, useState } from "react";
import { LIGHT_VARS } from "@/lib/identity-theme";
import {
  Collection,
  EMPTY_COLLECTION,
  clearCollection,
  fetchCollection,
  importCollection,
} from "@/lib/collection-client";

/* Account-level collection manager. Paste a card list (Moxfield / Deckbox /
   plain "{qty} {name}" all work) to record what you physically own; the deck
   and pool lists then badge owned cards, and the AI factors your collection
   into its suggestions. Stored by name only, so even a huge collection imports
   instantly. */
export default function CollectionModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [collection, setCollection] = useState<Collection>(EMPTY_COLLECTION);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [busy, setBusy] = useState(false);
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
          padding: "26px 28px 28px",
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
        <p style={{ margin: "8px 0 16px", fontSize: 14, color: "var(--t2)", lineHeight: 1.5 }}>
          Paste the cards you own — one per line (<code>1 Sol Ring</code>), or a Moxfield/Deckbox export.
          Your decks and pool will mark which cards you already have, and the AI will factor it in.
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          placeholder={"1 Sol Ring\n1 Cyclonic Rift\n4 Llanowar Elves"}
          style={{
            width: "100%",
            minHeight: 180,
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

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 18 }}>
          <button
            type="button"
            onClick={runClear}
            disabled={busy || collection.unique === 0}
            className="mn-ghost"
            style={{ padding: "10px 18px", fontSize: 13.5, opacity: collection.unique === 0 ? 0.5 : 1 }}
          >
            Clear all
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onClose} className="mn-ghost" style={{ padding: "10px 20px", fontSize: 14 }}>
              Close
            </button>
            <button type="button" onClick={runImport} disabled={busy || !text.trim()} className="mn-btn" style={{ padding: "10px 24px", fontSize: 14 }}>
              {busy ? "Saving…" : "Import"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
