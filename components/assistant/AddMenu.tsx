"use client";

import { Plus } from "lucide-react";

export interface AssistantDeckRef {
  publicId: string;
  name: string;
}

function namedImageUrl(name: string): string {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
}

/* A card's menu: its image, and every deck to add it to. */
export default function AddMenu({
  name,
  rect,
  decks,
  onPick,
  onClose,
}: {
  name: string;
  rect: DOMRect;
  decks: AssistantDeckRef[];
  onPick: (d: AssistantDeckRef) => void;
  onClose: () => void;
}) {
  const width = 240;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  const below = rect.bottom + 8;
  const top = below + 380 > window.innerHeight ? Math.max(8, rect.top - 388) : below;
  const sorted = [...decks].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90 }} />
      <div role="menu" aria-label={`Add ${name} to a deck`} className="id-card" style={{ position: "fixed", top, left, width, zIndex: 91, padding: 8, display: "flex", flexDirection: "column", gap: 6, maxHeight: 380, background: "var(--bg)", borderRadius: 14, boxShadow: "0 18px 40px -12px rgba(0,0,0,.45), inset 0 0 0 1px var(--line)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={namedImageUrl(name)} alt={name} style={{ width: 120, alignSelf: "center", borderRadius: "4.8% / 3.5%", aspectRatio: "5 / 7", objectFit: "cover", background: "rgba(0,0,0,.1)" }} />
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--t3, var(--text-muted))", padding: "2px 6px" }}>Add to a deck’s pool</div>
        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {sorted.length === 0 ? (
            <div style={{ fontSize: 13, padding: 6, color: "var(--t3, var(--text-muted))" }}>No decks yet.</div>
          ) : (
            sorted.map((d) => (
              <button key={d.publicId} role="menuitem" type="button" onClick={() => onPick(d)} className="tools-item" style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left", padding: "8px 8px", borderRadius: 8, border: "none", background: "transparent", color: "var(--t1, var(--text))", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
                <Plus size={14} strokeWidth={2.5} style={{ flex: "none", opacity: 0.7 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
