"use client";

import { useState } from "react";
import { mapPool } from "@/lib/async";
import { parseDecklist } from "@/lib/decklist";
import { PoolEntry, poolByName, resolveAndAdd } from "@/lib/pool-client";
import { ModalShell, ghostBtn, goldBtn, paperInput } from "./ui";

export type Tool = "export" | "import" | "lands";

// Preset quick-add lands & colorless staples for the bulk-land tool.
const PRESET_LANDS = [
  "Plains", "Island", "Swamp", "Mountain", "Forest",
  "Command Tower", "Sol Ring", "Arcane Signet", "Evolving Wilds",
];

// How many Scryfall name lookups to run at once during an import.
const IMPORT_CONCURRENCY = 4;

const summaryBox: React.CSSProperties = {
  fontSize: 13.5,
  color: "var(--frame-ink)",
  background: "rgba(0,0,0,.18)",
  borderRadius: 8,
  padding: "10px 14px",
};

const noteP: React.CSSProperties = { margin: 0, fontSize: 13.5, fontStyle: "normal", color: "var(--t2)" };

/* Export / import / bulk-lands tool sheet. State lives here, so closing the
   sheet resets it — each open starts fresh. */
export default function ToolSheet({
  tool,
  deckId,
  pool,
  onClose,
  onChanged,
}: {
  tool: Tool;
  deckId: number;
  pool: PoolEntry[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [copied, setCopied] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [landSel, setLandSel] = useState<Record<string, number>>({});
  const [landBusy, setLandBusy] = useState(false);
  const [landSummary, setLandSummary] = useState<string | null>(null);

  // ── Export — standard "{qty} {name}" decklist; deck board first, then the
  // remaining pool as a commented section (the importer skips "//" lines).
  const deckLines = pool.filter((c) => c.board === "deck").map((c) => `${c.quantity} ${c.name}`);
  const poolLines = pool.filter((c) => c.board !== "deck").map((c) => `${c.quantity} ${c.name}`);
  const exportText =
    deckLines.length > 0 && poolLines.length > 0
      ? [...deckLines, "", "// Pool", ...poolLines].join("\n")
      : [...deckLines, ...poolLines].join("\n");
  async function copyExport() {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked — the textarea is already on screen to copy manually
    }
  }

  // ── Import — parse "{qty} {name}" lines, resolve each on Scryfall (bounded
  // concurrency) and add the copies, merging quantities for repeated names.
  async function runImport() {
    const entries = parseDecklist(importText);
    if (entries.length === 0) {
      setImportSummary("Nothing to import — paste a decklist first.");
      return;
    }
    setImporting(true);
    setImportSummary(null);
    const known = poolByName(pool);
    const results = await mapPool(entries, IMPORT_CONCURRENCY, ({ name, qty }) =>
      resolveAndAdd(deckId, name, qty, known)
    );
    let added = 0;
    const notFound: string[] = [];
    results.forEach((r, i) => {
      if (r === "added") added += entries[i].qty;
      else if (r === "notfound") notFound.push(entries[i].name);
    });
    await onChanged();
    const parts = [`Added ${added} card${added === 1 ? "" : "s"}`];
    if (notFound.length) parts.push(`${notFound.length} not found: ${notFound.join(", ")}`);
    setImportSummary(parts.join(", ") + ".");
    setImportText("");
    setImporting(false);
  }

  // ── Bulk lands — add the chosen quantity of each preset land/staple.
  const landTotal = PRESET_LANDS.reduce((s, l) => s + (landSel[l] ?? 0), 0);
  async function addLands() {
    if (landTotal === 0) return;
    setLandBusy(true);
    setLandSummary(null);
    const known = poolByName(pool);
    let added = 0;
    for (const name of PRESET_LANDS) {
      const qty = landSel[name] ?? 0;
      if (qty <= 0) continue;
      const r = await resolveAndAdd(deckId, name, qty, known);
      if (r === "added") added += qty;
    }
    await onChanged();
    setLandSel({});
    setLandSummary(`Added ${added} card${added === 1 ? "" : "s"} to the pool.`);
    setLandBusy(false);
  }

  return (
    <ModalShell onDismiss={onClose} maxWidth={460}>
      <h2 style={{ margin: "0 0 14px", fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--frame-ink)" }}>
        {tool === "export" ? "Export decklist" : tool === "import" ? "Import decklist" : "Add lands & staples"}
      </h2>

      {tool === "export" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={noteP}>
            {pool.length} cards · standard {`{qty} {name}`} format.
          </p>
          <textarea readOnly value={exportText} onFocus={(e) => e.currentTarget.select()} className="cc-paper" style={{ ...paperInput, minHeight: 220, fontFamily: "var(--font-mono, monospace)", fontSize: 13.5, resize: "vertical" }} />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={ghostBtn}>Close</button>
            <button onClick={copyExport} disabled={pool.length === 0} style={goldBtn}>{copied ? "Copied ✓" : "Copy to clipboard"}</button>
          </div>
        </div>
      )}

      {tool === "import" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={noteP}>
            Paste a decklist — one card per line (e.g. <code>1 Lightning Bolt</code>). Cards not already in the pool are added.
          </p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            disabled={importing}
            placeholder={"1 Sol Ring\n1 Lightning Bolt\n1 Counterspell"}
            className="cc-paper"
            style={{ ...paperInput, minHeight: 200, fontFamily: "var(--font-mono, monospace)", fontSize: 13.5, resize: "vertical" }}
          />
          {importSummary && <div style={summaryBox}>{importSummary}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={ghostBtn}>Close</button>
            <button onClick={runImport} disabled={importing || !importText.trim()} style={goldBtn}>
              {importing ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
      )}

      {tool === "lands" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={noteP}>
            Set a quantity for each, then add your whole mana base in one tap.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {PRESET_LANDS.map((l) => {
              const n = landSel[l] ?? 0;
              return (
                <div key={l} style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 10, padding: "5px 6px", borderRadius: 8, background: n > 0 ? "rgba(39,66,214,.07)" : "transparent" }}>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600, color: "var(--frame-ink)" }}>{l}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={n === 0 ? "" : n}
                    placeholder="0"
                    onChange={(e) => {
                      const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                      setLandSel((s) => ({ ...s, [l]: v }));
                    }}
                    className="cc-paper"
                    style={{
                      width: 64,
                      padding: "8px 10px",
                      border: "none",
                      outline: "none",
                      borderRadius: 7,
                      fontFamily: "var(--font-display)",
                      fontSize: 16,
                      fontWeight: 700,
                      textAlign: "center",
                      color: "var(--ink)",
                    }}
                  />
                </div>
              );
            })}
          </div>
          {landSummary && <div style={summaryBox}>{landSummary}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
            <button onClick={onClose} style={ghostBtn}>Close</button>
            <button onClick={addLands} disabled={landBusy || landTotal === 0} style={goldBtn}>
              {landBusy ? "Adding…" : landTotal > 0 ? `Add ${landTotal} land${landTotal === 1 ? "" : "s"}` : "Add to pool"}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
