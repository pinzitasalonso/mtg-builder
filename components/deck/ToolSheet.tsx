"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { parseDecklist } from "@/lib/decklist";
import { ImportEntry, ImportResult, PoolEntry, importByName, poolByName, setQuantity, deleteCard } from "@/lib/pool-client";
import { ModalShell, ghostBtn, goldBtn, paperInput } from "./ui";

export type Tool = "export" | "import" | "lands";

// Preset quick-add lands & colorless staples for the bulk-land tool.
const PRESET_LANDS = [
  "Plains", "Island", "Swamp", "Mountain", "Forest",
  "Command Tower", "Sol Ring", "Arcane Signet", "Evolving Wilds",
];

const summaryBox: React.CSSProperties = {
  fontSize: 13.5,
  color: "var(--frame-ink)",
  background: "rgba(0,0,0,.18)",
  borderRadius: 8,
  padding: "10px 14px",
};

const noteP: React.CSSProperties = { margin: 0, fontSize: 13.5, fontStyle: "normal", color: "var(--t2)" };

const stepBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 7,
  border: "none",
  cursor: "pointer",
  background: "rgba(0,0,0,.12)",
  color: "var(--frame-ink)",
  fontFamily: "var(--font-display)",
  fontSize: 18,
  fontWeight: 700,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

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
  deckId: string;
  pool: PoolEntry[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [copied, setCopied] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  // Outcome of the last import, in three buckets so a throttled lookup is
  // never presented as a card that doesn't exist. `failed` is retryable.
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [landSel, setLandSel] = useState<Record<string, number>>({});
  const [landBusy, setLandBusy] = useState(false);
  const [landSummary, setLandSummary] = useState<string | null>(null);
  // dbId of the land whose count is currently being saved (disables its stepper).
  const [qtyBusy, setQtyBusy] = useState<number | null>(null);

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

  // ── Import — parse "{qty} {name}" lines and add them in bulk (batched
  // Scryfall lookup, one insert). Shared by the first run and by Retry, which
  // re-submits only the entries whose lookup failed and folds the outcome in.
  async function importEntries(entries: ImportEntry[], prior: ImportResult | null) {
    setImporting(true);
    setImportNote(null);
    try {
      const r = await importByName(deckId, entries, poolByName(pool));
      await onChanged();
      setImportResult({
        added: (prior?.added ?? 0) + r.added,
        notFound: [...(prior?.notFound ?? []), ...r.notFound],
        failed: r.failed,
      });
    } catch {
      setImportNote("Something went wrong while importing — check the pool, then try again.");
    } finally {
      setImporting(false);
    }
  }
  async function runImport() {
    const entries = parseDecklist(importText);
    if (entries.length === 0) {
      setImportNote("Nothing to import — paste a decklist first.");
      return;
    }
    setImportResult(null);
    await importEntries(entries, null);
    setImportText("");
  }
  async function retryFailed() {
    if (!importResult?.failed.length) return;
    await importEntries(importResult.failed, importResult);
  }

  // Lands already in the pool, so their counts can be edited in place. Matches on
  // the type line ("Basic Land — Forest", "Artifact Land", …) — basics by name
  // aren't reliable, but every land's type line carries the word "Land".
  const landsInPool = pool
    .filter((c) => /\bland\b/i.test(c.typeLine ?? ""))
    .sort((a, b) => a.name.localeCompare(b.name));
  const landCount = landsInPool.reduce((s, c) => s + c.quantity, 0);

  // ── Edit count — set the exact number of copies of a land already in the pool.
  // Dropping to 0 removes the row entirely.
  async function editLandQty(card: PoolEntry, next: number) {
    if (next === card.quantity) return;
    setQtyBusy(card.dbId);
    setLandSummary(null);
    if (next <= 0) await deleteCard(deckId, card.dbId);
    else await setQuantity(deckId, card.dbId, next);
    await onChanged();
    setQtyBusy(null);
  }

  // ── Bulk lands — add the chosen quantity of each preset land/staple.
  const landTotal = PRESET_LANDS.reduce((s, l) => s + (landSel[l] ?? 0), 0);
  async function addLands() {
    if (landTotal === 0) return;
    setLandBusy(true);
    setLandSummary(null);
    const entries = PRESET_LANDS.filter((l) => (landSel[l] ?? 0) > 0).map((name) => ({ name, qty: landSel[name] }));
    const r = await importByName(deckId, entries, poolByName(pool));
    await onChanged();
    setLandSel({});
    const parts = [`Added ${r.added} card${r.added === 1 ? "" : "s"} to the pool`];
    if (r.failed.length) parts.push(`couldn't add ${r.failed.map((f) => f.name).join(", ")} — Scryfall was busy, try again`);
    setLandSummary(parts.join("; ") + ".");
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
            <button onClick={copyExport} disabled={pool.length === 0} style={goldBtn}>{copied ? <><Check size={15} strokeWidth={2.5} /> Copied</> : "Copy to clipboard"}</button>
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
          {importNote && <div style={summaryBox}>{importNote}</div>}
          {importResult && (
            <div style={{ ...summaryBox, display: "flex", flexDirection: "column", gap: 6 }}>
              <div>
                <b>Added {importResult.added} card{importResult.added === 1 ? "" : "s"}</b>
                {importResult.notFound.length === 0 && importResult.failed.length === 0 && " — all done."}
              </div>
              {importResult.notFound.length > 0 && (
                <div>
                  <b>{importResult.notFound.length} not on Scryfall</b> (check the spelling):{" "}
                  {importResult.notFound.join(", ")}
                </div>
              )}
              {importResult.failed.length > 0 && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ flex: 1, minWidth: 200 }}>
                    <b>{importResult.failed.length} lookup{importResult.failed.length === 1 ? "" : "s"} failed</b> — Scryfall
                    was busy, nothing wrong with the names: {importResult.failed.map((f) => f.name).join(", ")}
                  </span>
                  <button onClick={retryFailed} disabled={importing} style={{ ...goldBtn, padding: "7px 14px", fontSize: 13.5, flex: "none" }}>
                    {importing ? "Retrying…" : `Retry ${importResult.failed.length}`}
                  </button>
                </div>
              )}
            </div>
          )}
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
          {landsInPool.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ ...noteP, fontWeight: 600 }}>
                {landCount} land{landCount === 1 ? "" : "s"} in your pool — tap − / + to adjust.
              </p>
              {landsInPool.map((c) => (
                <div key={c.dbId} style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 10, padding: "5px 6px", borderRadius: 8, background: "rgba(39,66,214,.05)" }}>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600, color: "var(--frame-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      type="button"
                      aria-label={`Remove one ${c.name}`}
                      disabled={qtyBusy === c.dbId}
                      onClick={() => editLandQty(c, c.quantity - 1)}
                      style={stepBtn}
                    >
                      −
                    </button>
                    <span style={{ minWidth: 24, textAlign: "center", fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>
                      {qtyBusy === c.dbId ? "…" : c.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label={`Add one ${c.name}`}
                      disabled={qtyBusy === c.dbId}
                      onClick={() => editLandQty(c, c.quantity + 1)}
                      style={stepBtn}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
