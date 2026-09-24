"use client";

import { useEffect, useState } from "react";
import { Check, Minus, Plus, X } from "lucide-react";
import { ModalShell } from "@/components/deck/ui";
import { ManaCost } from "@/components/mtg";
import { fetchPrintings, type CardPrinting, type CollectionCard } from "@/lib/collection-client";
import { idFromImageUri } from "@/lib/printing";

/* One card of the collection: the version owned, large, with its details and
   count, and every paper printing to pick the owned one from. Picking pins the
   printing (its image, and so its price) to the collection row. */
export default function CollectionCardModal({
  card,
  busy,
  onQty,
  onPick,
  onClose,
}: {
  card: CollectionCard;
  busy: boolean;
  onQty: (n: number) => void;
  onPick: (p: CardPrinting) => Promise<boolean>;
  onClose: () => void;
}) {
  const [printings, setPrintings] = useState<CardPrinting[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let live = true;
    setPrintings(null);
    setFailed(false);
    fetchPrintings(card.name).then((p) => {
      if (!live) return;
      if (p) setPrintings(p);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [card.name]);

  const ownedId = idFromImageUri(card.imageUri);
  const owned = printings?.find((p) => p.id === ownedId) ?? null;
  // The owned printing leads, so it's in view without scrolling a long list;
  // the filter narrows by set name, code, number or year.
  const q = filter.trim().toLowerCase();
  const listed = printings
    ? [...(owned ? [owned] : []), ...printings.filter((p) => p !== owned)].filter(
        (p) => !q || `${p.setName} ${p.set} ${p.number} ${p.released ?? ""}`.toLowerCase().includes(q)
      )
    : null;

  async function pick(p: CardPrinting) {
    if (saving || p.id === ownedId) return;
    setSaving(p.id);
    setError("");
    const ok = await onPick(p);
    setSaving(null);
    if (!ok) setError("Couldn’t save that version. Try again.");
  }

  return (
    <ModalShell onDismiss={onClose} maxWidth={760} zIndex={80} labelledBy="coll-card-title">
      <div style={{ position: "relative" }}>
      {/* Pinned to the corner, so on a phone it's at the top, over the art. */}
      <button type="button" onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 0, right: 0, zIndex: 1, width: 36, height: 36, borderRadius: 999, border: "none", background: "var(--bg3)", color: "var(--text-muted)", display: "grid", placeItems: "center", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.3)" }}>
        <X size={18} strokeWidth={2.25} />
      </button>
      <div className="coll-card-head" style={{ display: "flex", gap: 22, alignItems: "flex-start" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={card.imageUri || owned?.imageUri || ""}
          alt={card.name}
          className="coll-card-art"
          style={{ width: 230, flex: "none", aspectRatio: "5 / 7", borderRadius: "4.8% / 3.5%", objectFit: "cover", background: "rgba(0,0,0,.25)", boxShadow: "0 18px 40px -16px rgba(0,0,0,.6)" }}
        />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 id="coll-card-title" style={{ margin: 0, paddingRight: 44, fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, lineHeight: 1.1, color: "var(--text)" }}>
            {card.name}
          </h2>
          {(card.typeLine || card.manaCost) && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", color: "var(--text-muted)", fontSize: 14 }}>
              {card.manaCost && <ManaCost cost={card.manaCost} size={17} />}
              {card.typeLine && <span>{card.typeLine}</span>}
            </div>
          )}
          <div style={{ fontSize: 13.5, color: "var(--text-muted)" }}>
            {owned ? (
              <>
                You own the <b style={{ color: "var(--text)" }}>{owned.setName}</b> printing · {owned.set.toUpperCase()} #{owned.number}
                {owned.released ? ` · ${owned.released.slice(0, 4)}` : ""}
              </>
            ) : printings ? (
              "Pick the printing you own below."
            ) : null}
            {card.usdPrice ? <> · <b style={{ color: "var(--text)" }}>${card.usdPrice}</b></> : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
            <span className="mn-label" style={{ color: "var(--text-muted)" }}>Copies</span>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg3)", borderRadius: 999, padding: 4 }}>
              <button type="button" onClick={() => onQty(card.quantity - 1)} disabled={busy} aria-label={`Remove one ${card.name}`} style={stepBtn}>
                <Minus size={15} strokeWidth={2.5} />
              </button>
              <span style={{ minWidth: 26, textAlign: "center", fontWeight: 800, fontSize: 15, color: "var(--text)" }} aria-live="polite">
                {busy ? "…" : card.quantity}
              </span>
              <button type="button" onClick={() => onQty(card.quantity + 1)} disabled={busy} aria-label={`Add one ${card.name}`} style={stepBtn}>
                <Plus size={15} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <span className="mn-label" style={{ color: "var(--text-muted)" }}>
            Version you own{printings ? ` · ${printings.length} printing${printings.length === 1 ? "" : "s"}` : ""}
          </span>
          {printings && printings.length > 8 && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by set…"
              aria-label="Filter printings by set, number or year"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={{ flex: "0 1 200px", minWidth: 0, padding: "7px 12px", border: "1px solid var(--line)", borderRadius: 999, background: "var(--bg3)", color: "var(--text)", outline: "none", fontSize: 16 }}
            />
          )}
        </div>
        {error && <p role="alert" style={{ margin: "0 0 10px", fontSize: 13, color: "var(--danger, #ff8a7a)" }}>{error}</p>}
        {failed ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted)" }}>Couldn’t load the printings. Close and open the card to try again.</p>
        ) : !printings ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted)" }}>Loading printings…</p>
        ) : printings.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted)" }}>Scryfall has no paper printings for this name.</p>
        ) : listed!.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted)" }}>No printing matches “{filter}”.</p>
        ) : (
          <div role="radiogroup" aria-label="Printings" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 12 }}>
            {listed!.map((p) => {
              const on = p.id === ownedId;
              const price = p.usd ?? p.usdFoil;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${p.setName}, number ${p.number}${p.released ? `, ${p.released.slice(0, 4)}` : ""}`}
                  onClick={() => pick(p)}
                  disabled={saving !== null}
                  style={{ padding: 0, border: "none", background: "transparent", cursor: on ? "default" : "pointer", textAlign: "left", color: "var(--text)", opacity: saving && saving !== p.id ? 0.55 : 1 }}
                >
                  <div style={{ position: "relative", borderRadius: "4.8% / 3.5%", overflow: "hidden", aspectRatio: "5 / 7", background: "rgba(0,0,0,.25)", boxShadow: on ? "0 0 0 3px var(--accent)" : "0 4px 12px -6px rgba(0,0,0,.5)" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.imageUri} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    {(on || saving === p.id) && (
                      <span style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 999, background: "var(--accent)", color: "var(--accent-ink)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 800 }}>
                        {saving === p.id ? "…" : <Check size={15} strokeWidth={3} />}
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.setName}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {p.set.toUpperCase()} #{p.number}
                    {p.released ? ` · ${p.released.slice(0, 4)}` : ""}
                  </div>
                  {price && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>${price}</div>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </ModalShell>
  );
}

const stepBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 999,
  border: "none",
  background: "var(--surface, rgba(255,255,255,.08))",
  color: "var(--text)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};
