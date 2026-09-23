"use client";

import { useEffect, useState } from "react";
import { PoolEntry } from "@/lib/pool-client";
import { DeckDiff, VersionCard, VersionSummary, diffDecklists, isEmptyDiff } from "@/lib/deck-diff";
import { ModalShell, ghostBtn, goldBtn, paperInput } from "./ui";

/* Saved versions of the deck. Save the list as it is now, then compare any
   earlier version with the current deck: what came in, what went out, whose
   count changed. */
export default function VersionsModal({
  deckId,
  pool,
  canEdit,
  onClose,
}: {
  deckId: string;
  pool: PoolEntry[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [compare, setCompare] = useState<{ version: VersionSummary; diff: DeckDiff } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const now: VersionCard[] = pool.map((c) => ({ name: c.name, quantity: c.quantity, board: c.board, scryfallId: c.id }));
  const deckNow = now.filter((c) => c.board === "deck").reduce((n, c) => n + c.quantity, 0);

  async function load() {
    const res = await fetch(`/api/decks/${deckId}/versions`);
    setVersions(res.ok ? await res.json() : []);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/decks/${deckId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Couldn't save this version.");
      } else {
        setLabel("");
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  async function open(version: VersionSummary) {
    setBusyId(version.id);
    setError("");
    try {
      const res = await fetch(`/api/decks/${deckId}/versions/${version.id}`);
      if (!res.ok) {
        setError("Couldn't load that version.");
        return;
      }
      const body = (await res.json()) as { cards: VersionCard[] };
      setCompare({ version, diff: diffDecklists(body.cards, now, "deck") });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(version: VersionSummary) {
    if (!confirm(`Delete the version "${titleOf(version)}"?`)) return;
    setBusyId(version.id);
    try {
      const res = await fetch(`/api/decks/${deckId}/versions/${version.id}`, { method: "DELETE" });
      if (!res.ok) setError("Couldn't delete that version.");
      if (compare?.version.id === version.id) setCompare(null);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ModalShell onDismiss={onClose} maxWidth={560}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--frame-ink)" }}>
          Versions 🕘
        </h2>
        <button onClick={onClose} style={{ ...ghostBtn, padding: "6px 12px" }}>Close</button>
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 13.5, color: "var(--t2)" }}>
        Save the deck as it is now, then compare any earlier version with the current list. The deck has {deckNow} card{deckNow === 1 ? "" : "s"} right now.
      </p>

      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          style={{ display: "flex", gap: 8, marginBottom: 16 }}
        >
          <input
            className="cc-paper"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional) — e.g. before the combo package"
            maxLength={80}
            disabled={saving}
            style={paperInput}
          />
          <button type="submit" disabled={saving} style={{ ...goldBtn, flex: "none" }}>
            {saving ? "Saving…" : "Save version"}
          </button>
        </form>
      )}
      {error && <div style={{ color: "var(--danger)", fontSize: 13.5, marginBottom: 10 }}>{error}</div>}

      {versions === null ? (
        <p style={{ fontSize: 13.5, color: "var(--t3)" }}>Loading…</p>
      ) : versions.length === 0 ? (
        <p style={{ fontSize: 13.5, color: "var(--t3)" }}>No versions saved yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {versions.map((v) => {
            const active = compare?.version.id === v.id;
            return (
              <div
                key={v.id}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: active ? "rgba(39,66,214,.09)" : "rgba(0,0,0,.05)" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--frame-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{titleOf(v)}</div>
                  <div style={{ fontSize: 12, color: "var(--t3)" }}>
                    {when(v.createdAt)} · {v.deckCount} in deck · {v.poolCount} in pool
                  </div>
                </div>
                <button onClick={() => open(v)} disabled={busyId === v.id} style={{ ...ghostBtn, padding: "6px 12px", fontSize: 13 }}>
                  {busyId === v.id ? "…" : active ? "Comparing" : "Compare"}
                </button>
                {canEdit && (
                  <button onClick={() => remove(v)} disabled={busyId === v.id} title="Delete version" aria-label="Delete version" style={{ ...ghostBtn, padding: "6px 10px", fontSize: 13, color: "var(--danger)" }}>
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {compare && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
          <div className="label-sc" style={{ fontSize: 11.5, color: "var(--t2)", letterSpacing: ".1em", marginBottom: 8 }}>
            {titleOf(compare.version)} → now · the deck
          </div>
          {isEmptyDiff(compare.diff) ? (
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--t3)" }}>No changes — the deck is the same as this version.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <DiffList title="Added" color="#0d8a5f" rows={compare.diff.added.map((c) => `${c.quantity > 1 ? `${c.quantity}× ` : ""}${c.name}`)} />
              <DiffList title="Removed" color="var(--danger)" rows={compare.diff.removed.map((c) => `${c.quantity > 1 ? `${c.quantity}× ` : ""}${c.name}`)} />
              <DiffList title="Count changed" color="var(--gold)" rows={compare.diff.changed.map((c) => `${c.name}: ${c.from} → ${c.to}`)} />
              <div style={{ fontSize: 12, color: "var(--t3)" }}>{compare.diff.unchanged} card{compare.diff.unchanged === 1 ? "" : "s"} unchanged.</div>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}

function titleOf(v: VersionSummary) {
  return v.label || `Version of ${when(v.createdAt)}`;
}

function when(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function DiffList({ title, color, rows }: { title: string; color: string; rows: string[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 4 }}>
        {title} · {rows.length}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {rows.map((r) => (
          <span key={r} style={{ fontSize: 13, padding: "3px 9px", borderRadius: 999, background: "rgba(0,0,0,.07)", color: "var(--frame-ink)" }}>
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}
