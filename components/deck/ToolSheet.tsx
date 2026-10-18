"use client";

import { useEffect, useState } from "react";
import { tryFetchCollection } from "@/lib/collection-client";
import { withoutOwned } from "@/lib/collection-diff";
import { Check } from "lucide-react";
import { parseDecklistBoards } from "@/lib/decklist";
import { ImportEntry, ImportResult, PoolEntry, importByName, poolByName, setQuantity, deleteCard, type Board } from "@/lib/pool-client";
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
  commander,
  initialImport = "",
  onClose,
  onChanged,
}: {
  tool: Tool;
  deckId: string;
  pool: PoolEntry[];
  /** The deck's commander: a replacing import keeps it. */
  commander?: string | null;
  /** A list pasted elsewhere (the Add cards box), to start the import with. */
  initialImport?: string;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [copied, setCopied] = useState(false);
  const [importText, setImportText] = useState(initialImport);
  // Where an import goes: the deck (its sideboard/maybeboard to the pool), or
  // all of it to the pool. Replacing clears the deck's list first, after
  // saving it as a version.
  const [importTo, setImportTo] = useState<Board>("deck");
  const [replace, setReplace] = useState(false);
  // Lookups that failed, by the board they were headed for, for Retry.
  const [retry, setRetry] = useState<{ deck: ImportEntry[]; pool: ImportEntry[] }>({ deck: [], pool: [] });
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
  // Two settings, remembered on this device: leave the pool out, and leave out
  // what you own (copy for copy — 30 Mountains with 10 owned exports 20), which
  // turns the export into a shopping list.
  const [withPool, setWithPool] = useState(() => readSetting("sp-export-pool", true));
  const [skipOwned, setSkipOwned] = useState(() => readSetting("sp-export-skip-owned", false));
  const [owned, setOwned] = useState<{ name: string; quantity: number }[] | null>(null);
  useEffect(() => {
    if (tool !== "export") return;
    // null when signed out or offline: the setting then isn't offered.
    void tryFetchCollection().then((c) => setOwned(c && c.cards.length ? c.cards.map((x) => ({ name: x.name, quantity: x.quantity })) : null));
  }, [tool]);
  const leaveOut = (rows: PoolEntry[]) => (skipOwned && owned ? withoutOwned(rows, owned) : rows);
  const deckRows = leaveOut(pool.filter((c) => c.board === "deck"));
  const poolRows = withPool ? leaveOut(pool.filter((c) => c.board !== "deck")) : [];
  const deckLines = deckRows.map((c) => `${c.quantity} ${c.name}`);
  const poolLines = poolRows.map((c) => `${c.quantity} ${c.name}`);
  const exportCount = [...deckRows, ...poolRows].reduce((n, c) => n + c.quantity, 0);
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

  // ── Import — parse the pasted list into its deck and pool sections and add
  // them in bulk (batched Scryfall lookup, one insert per board). Retry
  // re-submits only the lookups that failed and folds the outcome in.
  async function importBoards(lists: { deck: ImportEntry[]; pool: ImportEntry[] }, prior: ImportResult | null) {
    const known = poolByName(pool);
    const sum: ImportResult = { added: prior?.added ?? 0, notFound: [...(prior?.notFound ?? [])], failed: [] };
    const failed = { deck: [] as ImportEntry[], pool: [] as ImportEntry[] };
    for (const board of ["deck", "pool"] as const) {
      if (!lists[board].length) continue;
      const r = await importByName(deckId, lists[board], known, board);
      sum.added += r.added;
      sum.notFound.push(...r.notFound);
      sum.failed.push(...r.failed);
      failed[board] = r.failed;
    }
    setRetry(failed);
    return sum;
  }
  async function runImport() {
    const parsed = parseDecklistBoards(importText);
    const lists = importTo === "deck" ? parsed : { deck: [], pool: [...parsed.deck, ...parsed.pool] };
    if (lists.deck.length + lists.pool.length === 0) {
      setImportNote("Nothing to import — paste a decklist first.");
      return;
    }
    setImporting(true);
    setImportNote(null);
    setImportResult(null);
    try {
      if (replace && importTo === "deck") {
        // Saved first, so the old list is one Restore away in Versions.
        const v = await fetch(`/api/decks/${deckId}/versions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: "Before import" }),
        }).catch(() => null);
        if (!v?.ok) {
          setImportNote("Couldn’t save a version of the current list first, so nothing was replaced. Try again.");
          return;
        }
        const cmd = (commander ?? "").trim().toLowerCase();
        const old = pool.filter((c) => c.board === "deck" && c.name.trim().toLowerCase() !== cmd);
        for (let i = 0; i < old.length; i += 8) await Promise.all(old.slice(i, i + 8).map((c) => deleteCard(deckId, c.dbId)));
      }
      setImportResult(await importBoards(lists, null));
      await onChanged();
      setImportText("");
      setReplace(false);
    } catch {
      setImportNote("Something went wrong while importing — check the deck, then try again.");
    } finally {
      setImporting(false);
    }
  }
  async function retryFailed() {
    if (!retry.deck.length && !retry.pool.length) return;
    setImporting(true);
    try {
      setImportResult(await importBoards(retry, importResult));
      await onChanged();
    } finally {
      setImporting(false);
    }
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
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Toggle
              on={withPool}
              onChange={(v) => { setWithPool(v); saveSetting("sp-export-pool", v); }}
              label="Include the pool"
              note="After the deck, under // Pool"
              disabled={!pool.some((c) => c.board !== "deck")}
            />
            {owned && (
              <Toggle
                on={skipOwned}
                onChange={(v) => { setSkipOwned(v); saveSetting("sp-export-skip-owned", v); }}
                label="Leave out cards I own"
                note="Only what you'd still need to buy"
              />
            )}
          </div>
          <p style={noteP}>
            {exportCount} card{exportCount === 1 ? "" : "s"} · standard {`{qty} {name}`} format.
          </p>
          <textarea readOnly value={exportText} onFocus={(e) => e.currentTarget.select()} className="cc-paper" style={{ ...paperInput, minHeight: 220, fontFamily: "var(--font-mono, monospace)", fontSize: 13.5, resize: "vertical" }} />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={ghostBtn}>Close</button>
            <button onClick={copyExport} disabled={!exportText} style={goldBtn}>{copied ? <><Check size={15} strokeWidth={2.5} /> Copied</> : "Copy to clipboard"}</button>
          </div>
        </div>
      )}

      {tool === "import" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={noteP}>
            Paste a decklist — one card per line (e.g. <code>1 Lightning Bolt</code>). Exports from Moxfield, Archidekt, MTGO
            and Spellpool work: a <b>Sideboard</b> or <b>Maybeboard</b> goes to the pool.
          </p>
          <div role="radiogroup" aria-label="Import into" style={{ display: "flex", gap: 6 }}>
            {([["deck", "Into the deck"], ["pool", "Into the pool"]] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={importTo === v}
                onClick={() => setImportTo(v)}
                disabled={importing}
                style={{ flex: 1, padding: "8px 10px", borderRadius: 999, border: "1px solid " + (importTo === v ? "transparent" : "var(--line)"), background: importTo === v ? "var(--accent)" : "transparent", color: importTo === v ? "var(--accent-ink)" : "var(--frame-ink)", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}
              >
                {label}
              </button>
            ))}
          </div>
          {importTo === "deck" && pool.some((c) => c.board === "deck") && (
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 12px", borderRadius: 10, background: "rgba(0,0,0,.12)", cursor: "pointer" }}>
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} disabled={importing} style={{ width: 18, height: 18, marginTop: 1, accentColor: "var(--gold, #fdf26f)", flex: "none" }} />
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--frame-ink)" }}>Replace the deck’s current list</span>
                <span style={{ fontSize: 12, color: "var(--t2)" }}>Saves it as a version first, so you can restore it from Versions.{commander ? " The commander stays." : ""}</span>
              </span>
            </label>
          )}
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
              {importResult.failed.length > 0 && (retry.deck.length > 0 || retry.pool.length > 0) && (
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
              {importing ? "Importing…" : replace && importTo === "deck" ? "Replace & import" : "Import"}
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

function readSetting(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function saveSetting(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* storage off: it just isn't remembered */
  }
}

/* A labelled switch row for the export settings. */
function Toggle({ on, onChange, label, note, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; note?: string; disabled?: boolean }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 10, background: "rgba(0,0,0,.12)", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" role="switch" checked={on && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--gold, #fdf26f)", flex: "none" }} />
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--frame-ink)" }}>{label}</span>
        {note && <span style={{ fontSize: 12, color: "var(--t2)" }}>{note}</span>}
      </span>
    </label>
  );
}
