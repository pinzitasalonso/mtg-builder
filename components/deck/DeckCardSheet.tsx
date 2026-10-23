"use client";

import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Check, ExternalLink, Minus, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import FlippableArt from "@/components/FlippableArt";
import { ModalShell } from "@/components/deck/ui";
import { ManaCost, Pip, parseSymbols } from "@/components/mtg";
import { fetchPrintings, type CardPrinting } from "@/lib/collection-client";
import { idFromImageUri } from "@/lib/printing";
import { deleteCard, moveCard, setPrinting, setQuantity, type PoolEntry } from "@/lib/pool-client";

/* A card in the deck, opened: the printing in the deck, large, with what the
   card does (cost, type, rules text), what it costs, whether you own it — and,
   for the deck's owner, every paper printing to switch to, the one in your
   collection first, plus the usual moves (copies, deck ↔ pool, remove).

   The same shape as the collection's card view (CollectionCardModal), so a
   card reads the same wherever you open it. */

export interface OwnedCopy {
  quantity: number;
  /** The owned printing's image (its Scryfall id is inside), when known. */
  imageUri: string | null;
}

export default function DeckCardSheet({
  deckId,
  card,
  canEdit,
  isCommander,
  owned,
  warning,
  canSetQty,
  onChanged,
  onClose,
}: {
  deckId: string;
  card: PoolEntry;
  canEdit: boolean;
  /** The commander stays on the deck board and can't be removed here. */
  isCommander: boolean;
  owned: OwnedCopy | null;
  /** Legality warnings, joined. */
  warning?: string;
  /** Whether copies can be changed (playsets, basics in Commander). */
  canSetQty: boolean;
  /** Something changed: reload the deck. */
  onChanged: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [printings, setPrintings] = useState<CardPrinting[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  const currentId = card.id;
  const ownedId = idFromImageUri(owned?.imageUri ?? null);
  const current = printings?.find((p) => p.id === currentId) ?? null;
  const mine = printings?.find((p) => p.id === ownedId) ?? null;
  const price = current?.usd ?? current?.usdFoil ?? null;
  // Yours first, then the one in the deck, then the rest newest first.
  const q = filter.trim().toLowerCase();
  const lead = [mine, current].filter((p, i, a): p is CardPrinting => Boolean(p) && a.indexOf(p) === i);
  const listed = printings
    ? [...lead, ...printings.filter((p) => !lead.includes(p))].filter(
        (p) => !q || `${p.setName} ${p.set} ${p.number} ${p.released ?? ""}`.toLowerCase().includes(q)
      )
    : null;

  async function pick(p: CardPrinting) {
    if (saving || p.id === currentId) return;
    setSaving(p.id);
    setError("");
    const err = await setPrinting(deckId, card.dbId, p.id, p.imageUri);
    if (err) setError(err);
    else await onChanged();
    setSaving(null);
  }

  async function act(fn: () => Promise<boolean>, failMsg: string, closeAfter = false) {
    setBusy(true);
    setError("");
    const ok = await fn();
    if (!ok) setError(failMsg);
    await onChanged();
    setBusy(false);
    if (ok && closeAfter) onClose();
  }

  const onDeck = card.board === "deck";

  return (
    <ModalShell onDismiss={onClose} maxWidth={780} zIndex={70} labelledBy="deck-card-title">
      <div style={{ position: "relative" }}>
        <button type="button" onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 0, right: 0, zIndex: 1, width: 36, height: 36, borderRadius: 999, border: "none", background: "var(--bg3)", color: "var(--text-muted)", display: "grid", placeItems: "center", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.3)" }}>
          <X size={18} strokeWidth={2.25} />
        </button>
        <div className="coll-card-head" style={{ display: "flex", gap: 22, alignItems: "flex-start" }}>
        <FlippableArt name={card.name} imageUri={card.imageUri || current?.imageUri || ""} width={240} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 id="deck-card-title" style={{ margin: 0, paddingRight: 44, fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, lineHeight: 1.1, color: "var(--text)" }}>
              {card.name}
            </h2>
            {(card.typeLine || card.manaCost) && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", color: "var(--text-muted)", fontSize: 14 }}>
                {card.manaCost && <ManaCost cost={card.manaCost} size={17} />}
                {card.typeLine && <span>{card.typeLine}</span>}
              </div>
            )}
            {card.oracleText && <RulesText text={card.oracleText} />}

            {/* What it is to you: in your collection, the printing, the price. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {isCommander && <Chip>Commander</Chip>}
              {card.role && <Chip>{card.role}</Chip>}
              {owned ? (
                <Chip tone="good">
                  <Check size={12} strokeWidth={3} /> You own {owned.quantity}
                </Chip>
              ) : (
                <Chip>Not in your collection</Chip>
              )}
              {current && (
                <Chip>
                  {current.setName} · {current.set.toUpperCase()} #{current.number}
                </Chip>
              )}
              {price && <Chip>${price}</Chip>}
            </div>
            {warning && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "#ff9c86", lineHeight: 1.4 }}>
                <TriangleAlert size={15} strokeWidth={2.25} style={{ flex: "none", marginTop: 1 }} />
                {warning}
              </div>
            )}

            {canEdit && (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 4 }}>
                {canSetQty && !isCommander && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg3)", borderRadius: 999, padding: 4 }}>
                    <button type="button" onClick={() => act(() => setQuantity(deckId, card.dbId, card.quantity - 1), "Couldn’t change the copies.")} disabled={busy || card.quantity <= 1} aria-label={`One ${card.name} fewer`} style={stepBtn}>
                      <Minus size={15} strokeWidth={2.5} />
                    </button>
                    <span style={{ minWidth: 26, textAlign: "center", fontWeight: 800, fontSize: 15, color: "var(--text)" }} aria-live="polite">
                      {card.quantity}
                    </span>
                    <button type="button" onClick={() => act(() => setQuantity(deckId, card.dbId, card.quantity + 1), "Couldn’t change the copies.")} disabled={busy} aria-label={`One ${card.name} more`} style={stepBtn}>
                      <Plus size={15} strokeWidth={2.5} />
                    </button>
                  </div>
                )}
                {!isCommander && (
                  <button type="button" className="id-ghost" disabled={busy} onClick={() => act(() => moveCard(deckId, card.dbId, onDeck ? "pool" : "deck"), "Couldn’t move the card.", true)} style={{ padding: "7px 13px", fontSize: 13 }}>
                    {onDeck ? <ArrowDownToLine size={14} strokeWidth={2.25} /> : <ArrowUpFromLine size={14} strokeWidth={2.25} />}
                    {onDeck ? "Move to pool" : "Move to deck"}
                  </button>
                )}
                {!isCommander && (
                  <button type="button" className="id-ghost" disabled={busy} onClick={() => act(() => deleteCard(deckId, card.dbId), "Couldn’t remove the card.", true)} style={{ padding: "7px 13px", fontSize: 13, color: "var(--danger, #ff8a7a)" }}>
                    <Trash2 size={14} strokeWidth={2.25} /> Remove
                  </button>
                )}
                <a
                  href={`https://scryfall.com/search?q=${encodeURIComponent(`!"${card.name}"`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="id-ghost"
                  style={{ padding: "7px 13px", fontSize: 13, textDecoration: "none" }}
                >
                  <ExternalLink size={14} strokeWidth={2.25} /> Scryfall
                </a>
              </div>
            )}
          </div>
        </div>

        {canEdit && (
          <div style={{ marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
              <span className="mn-label" style={{ color: "var(--text-muted)" }}>
                Printing in this deck{printings ? ` · ${printings.length} to choose from` : ""}
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
            {/* Which printing shows, and why: yours by default, or the one you
                picked (which sticks until you pick yours again). */}
            {mine && (
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.45 }}>
                {card.printingPinned && currentId !== ownedId
                  ? <>You picked this printing, so it stays. Pick <b style={{ color: "var(--text)" }}>Yours</b> to match your collection again.</>
                  : "Shows the printing in your collection. Pick another to use it instead."}
              </p>
            )}
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
                  const on = p.id === currentId;
                  const yours = p.id === ownedId;
                  const cost = p.usd ?? p.usdFoil;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`${p.setName}, number ${p.number}${p.released ? `, ${p.released.slice(0, 4)}` : ""}${yours ? ", in your collection" : ""}`}
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
                        {yours && (
                          <span style={{ position: "absolute", left: 6, bottom: 6, padding: "1px 7px", borderRadius: 999, background: "rgba(13,138,95,.95)", color: "#fff", fontSize: 10.5, fontWeight: 800 }}>
                            Yours
                          </span>
                        )}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.setName}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.set.toUpperCase()} #{p.number}
                        {p.released ? ` · ${p.released.slice(0, 4)}` : ""}
                      </div>
                      {cost && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>${cost}</div>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

/* Rules text with its mana symbols drawn, a paragraph per line. */
function RulesText({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14, lineHeight: 1.5, color: "var(--text)", padding: "10px 12px", borderRadius: 10, background: "var(--bg3)" }}>
      {text.split("\n").map((line, i) => (
        <p key={i} style={{ margin: 0 }}>
          {line.split(/(\{[^}]+\})/g).map((part, j) =>
            /^\{[^}]+\}$/.test(part) ? (
              <span key={j} style={{ display: "inline-flex", verticalAlign: "-3px", margin: "0 1px" }}>
                <Pip sym={parseSymbols(part)[0] ?? part.slice(1, -1)} size={15} />
              </span>
            ) : (
              <span key={j}>{part}</span>
            )
          )}
        </p>
      ))}
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "good" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 600,
        background: tone === "good" ? "rgba(13,138,95,.16)" : "var(--bg3)",
        color: tone === "good" ? "#0d8a5f" : "var(--text-muted)",
      }}
    >
      {children}
    </span>
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
