"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Layers } from "lucide-react";
import type { CardInDeck } from "@/app/api/cards/decks/route";

/* Which of your decks a card is in, for the card views (the deck's card
   sheet, the collection's card): each deck a link, with the copies in its
   list or that it's only in the pool. Nothing while loading, or signed out. */
export default function CardInDecks({ name, currentDeckId }: { name: string; currentDeckId?: string }) {
  const [decks, setDecks] = useState<CardInDeck[] | null>(null);

  useEffect(() => {
    let live = true;
    setDecks(null);
    fetch(`/api/cards/decks?name=${encodeURIComponent(name)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { decks?: CardInDeck[] } | null) => {
        if (live) setDecks(data?.decks ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [name]);

  if (!decks) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="mn-label" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}>
        <Layers size={13} strokeWidth={2.25} /> {decks.length ? `In ${decks.length} of your decks` : "In none of your decks"}
      </span>
      {decks.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {decks.map((d) => {
            const here = d.publicId === currentDeckId;
            const where = d.deck > 0 ? `×${d.deck}${d.pool ? ` · ${d.pool} in pool` : ""}` : "pool";
            return (
              <Link
                key={d.publicId}
                href={`/deck/${d.publicId}`}
                aria-current={here ? "page" : undefined}
                title={here ? "This deck" : `Open ${d.name}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  maxWidth: "100%",
                  padding: "4px 11px",
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 600,
                  textDecoration: "none",
                  color: "var(--text)",
                  background: "var(--bg3)",
                  boxShadow: here ? "inset 0 0 0 1.5px var(--gold)" : "none",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                <span style={{ flex: "none", color: "var(--text-muted)", fontWeight: 500 }}>{where}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
