"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, Heart, PackageCheck } from "lucide-react";
import type { CardElsewhere } from "@/app/api/decks/[id]/assemble/route";
import type { OwnedCopy } from "@/components/deck/DeckCardSheet";
import { CardArt, CAT_COLOR, categoryOf, scanVersionURL, TYPE_ORDER } from "@/components/mtg";
import type { PoolEntry } from "@/lib/pool-client";
import { addToWishlist } from "@/lib/wishlist-client";
import { ModalShell, ghostBtn, goldBtn } from "./ui";

/* "Assemble deck": building the deck in cardboard. Tick each card as it goes
   into the pile; what's left is what you still have to find. For those, the
   sheet says what it knows: the copies in your collection, and which of your
   other decks hold the card (ticked there too: that's where it probably is).
   The ticks are saved on the deck, so the list is the same on your phone.

   The list reads like the deck view: the commander first, then the cards by
   type, A to Z. Each row has the card's picture small; resting the mouse on a
   row, or tapping the picture, shows the card large, to tell it from the
   pile in front of you. */

/** The card shown large: beside the sheet where there's room, else over it. */
interface Preview {
  card: PoolEntry;
  /** The row, and the sheet it's in. */
  row: DOMRect;
  sheet: DOMRect;
  /** Opened by a tap: it stays until the next tap. */
  pinned: boolean;
}

interface State {
  assembled: Set<number>;
  elsewhere: Record<string, CardElsewhere[]>;
}

export default function AssembleSheet({
  deckId,
  cards,
  owned,
  isCommander,
  onClose,
}: {
  deckId: string;
  /** The decklist (the deck board). */
  cards: PoolEntry[];
  /** The deck's commander goes first, as in the deck view. */
  isCommander?: (card: PoolEntry) => boolean;
  /** Copies in your collection, by lowercase name. */
  owned: Map<string, OwnedCopy>;
  onClose: () => void;
}) {
  const [state, setState] = useState<State | null>(null);
  const [failed, setFailed] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const show = (card: PoolEntry, el: Element, pinned: boolean) => {
    const sheet = el.closest('[role="dialog"]')?.getBoundingClientRect() ?? el.getBoundingClientRect();
    // A hovered card shows only where it fits beside the sheet: over the
    // list, it would cover the rows the mouse is on. (A tap always shows it.)
    if (!pinned && !fitsBeside(sheet)) return;
    setPreview({ card, row: el.getBoundingClientRect(), sheet, pinned });
  };

  useEffect(() => {
    let live = true;
    fetch(`/api/decks/${deckId}/assemble`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { assembled?: number[]; elsewhere?: Record<string, CardElsewhere[]> } | null) => {
        if (!live) return;
        if (d) setState({ assembled: new Set(d.assembled ?? []), elsewhere: d.elsewhere ?? {} });
        else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [deckId]);

  const post = (body: unknown) =>
    fetch(`/api/decks/${deckId}/assemble`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.ok)
      .catch(() => false);

  // Tick at once; put it back if the save fails.
  async function toggle(card: PoolEntry) {
    if (!state) return;
    const on = !state.assembled.has(card.dbId);
    const flip = (to: boolean) =>
      setState((s) => {
        if (!s) return s;
        const assembled = new Set(s.assembled);
        if (to) assembled.add(card.dbId);
        else assembled.delete(card.dbId);
        return { ...s, assembled };
      });
    flip(on);
    setNote("");
    if (!(await post({ cardIds: [card.dbId], assembled: on }))) {
      flip(!on);
      setNote("Couldn’t save that. Try again.");
    }
  }

  async function reset() {
    if (!state || busy || !confirm("Untick every card in this deck?")) return;
    setBusy(true);
    if (await post({ reset: true })) setState({ ...state, assembled: new Set() });
    else setNote("Couldn’t reset. Try again.");
    setBusy(false);
  }

  const copies = (c: PoolEntry) => c.quantity;
  const total = cards.reduce((n, c) => n + copies(c), 0);
  const done = state ? cards.filter((c) => state.assembled.has(c.dbId)).reduce((n, c) => n + copies(c), 0) : 0;
  const missing = state ? cards.filter((c) => !state.assembled.has(c.dbId)) : [];
  // Still to find, and not in your collection: what you'd have to get.
  const toBuy = missing.filter((c) => (owned.get(c.name.toLowerCase())?.quantity ?? 0) < c.quantity);

  async function wishMissing() {
    if (busy || !toBuy.length) return;
    setBusy(true);
    const r = await addToWishlist(
      toBuy.map((c) => ({ name: c.name, quantity: Math.max(1, c.quantity - (owned.get(c.name.toLowerCase())?.quantity ?? 0)), imageUri: c.imageUri, typeLine: c.typeLine, manaCost: c.manaCost, colorIdentity: c.colorIdentity }))
    );
    setBusy(false);
    setNote(r.ok ? `${(r.added ?? 0) + (r.raised ?? 0)} added to your wishlist${r.already ? `, ${r.already} already there` : ""}.` : (r.error ?? "Couldn’t add them."));
  }

  // The deck view's order: the commander, then each type, A to Z within it.
  const groups = useMemo(() => {
    const list = state && onlyMissing ? cards.filter((c) => !state.assembled.has(c.dbId)) : cards;
    const commander = list.filter((c) => isCommander?.(c));
    const by = new Map<string, PoolEntry[]>();
    for (const c of list) {
      if (isCommander?.(c)) continue;
      const k = categoryOf(c.typeLine);
      by.set(k, [...(by.get(k) ?? []), c]);
    }
    return [
      ...(commander.length ? [{ type: "Commander", cards: commander }] : []),
      ...TYPE_ORDER.filter((t) => by.has(t)).map((t) => ({ type: t, cards: by.get(t)!.sort((a, b) => a.name.localeCompare(b.name)) })),
    ];
    // isCommander is the page's own function, new on every render: the deck's cards are what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, state, onlyMissing]);

  return (
    <ModalShell onDismiss={onClose} maxWidth={620} labelledBy="assemble-title">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
        <h2 id="assemble-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: 9, fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--frame-ink)" }}>
          <PackageCheck size={22} strokeWidth={2} /> Assemble deck
        </h2>
        <button onClick={onClose} style={{ ...ghostBtn, padding: "6px 12px" }}>Close</button>
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 14, color: "var(--t2)", lineHeight: 1.45 }}>Tick each card as you put it in the deck. What’s left is what you still have to find.</p>

      {failed ? (
        <p role="alert" style={{ margin: 0, fontSize: 14, color: "#ff9c86" }}>Couldn’t load this deck’s list. Close this and try again.</p>
      ) : !state ? (
        <p style={{ margin: 0, fontSize: 14, color: "var(--t2)" }}>Loading…</p>
      ) : (
        <>
          <div aria-live="polite" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, fontSize: 14, color: "var(--t1)", fontWeight: 600 }}>
            <span data-testid="assemble-progress">
              {done} of {total} cards in the deck
            </span>
            <span style={{ color: "var(--t3)", fontWeight: 500 }}>{total - done === 0 ? "All there." : `${total - done} to find`}</span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: "var(--bg3)", overflow: "hidden", margin: "8px 0 14px" }}>
            <div style={{ width: `${total ? (done / total) * 100 : 0}%`, height: "100%", background: "var(--gold)", transition: "width .2s ease" }} />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <button onClick={() => setOnlyMissing((v) => !v)} aria-pressed={onlyMissing} style={{ ...ghostBtn, padding: "7px 14px", fontSize: 13, ...(onlyMissing ? { background: "var(--bg3)", color: "var(--t1)" } : {}) }}>
              {onlyMissing ? "Showing what’s missing" : "Show only what’s missing"}
            </button>
            {toBuy.length > 0 && (
              <button onClick={wishMissing} disabled={busy} style={{ ...ghostBtn, padding: "7px 14px", fontSize: 13 }} title="The unticked cards that aren’t in your collection">
                <Heart size={14} strokeWidth={2.25} /> Wishlist the {toBuy.length} I don’t own
              </button>
            )}
            {done > 0 && (
              <button onClick={reset} disabled={busy} style={{ ...ghostBtn, padding: "7px 14px", fontSize: 13 }}>
                Untick all
              </button>
            )}
          </div>
          {note && <p role="status" style={{ margin: "0 0 12px", fontSize: 13, color: "var(--t2)" }}>{note}</p>}

          {groups.length === 0 && <p style={{ margin: 0, fontSize: 14, color: "var(--t2)" }}>{cards.length ? "Every card is in the deck." : "This deck has no cards yet."}</p>}
          {groups.map((g) => (
            <section key={g.type} style={{ marginBottom: 14 }}>
              {/* The deck view's section head: the type's colour, its name, its count. */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: CAT_COLOR[g.type] || "#ccc", flex: "none" }} />
                <span className="id-label" style={{ color: "var(--t2)", fontSize: 11.5 }}>{g.type}</span>
                <span className="id-mono" style={{ fontSize: 11.5, color: "var(--t3)" }}>{g.cards.reduce((n, c) => n + copies(c), 0)}</span>
                <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {g.cards.map((c) => {
                  const on = state.assembled.has(c.dbId);
                  const have = owned.get(c.name.toLowerCase())?.quantity ?? 0;
                  const other = state.elsewhere[c.name.toLowerCase()] ?? [];
                  return (
                    <li
                      key={c.dbId}
                      onPointerEnter={(e) => e.pointerType === "mouse" && show(c, e.currentTarget, false)}
                      onPointerLeave={(e) => e.pointerType === "mouse" && setPreview((p) => (p?.pinned ? p : null))}
                      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 10, padding: "5px 0", borderBottom: "1px solid var(--line)" }}
                    >
                      {/* The card, small. A tap shows it large (on a phone there's no hover). */}
                      <button
                        type="button"
                        onClick={(e) => (preview?.pinned && preview.card.dbId === c.dbId ? setPreview(null) : show(c, e.currentTarget.closest("li")!, true))}
                        aria-label={`Show ${c.name}`}
                        title="Show the card"
                        style={{ flex: "none", width: 34, height: 47, padding: 0, border: "none", borderRadius: 4, overflow: "hidden", background: "var(--bg3)", cursor: "zoom-in", opacity: on ? 0.55 : 1 }}
                      >
                        {/* The small scan from the image CDN: a hundred rows of full-size ones is a lot to load. */}
                        <CardArt name={c.name} src={scanVersionURL(c.imageUri || undefined, "small") ?? (c.imageUri || undefined)} prefer="src" version="small" loading="lazy" radius={0} style={{ width: "100%", height: "100%" }} />
                      </button>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        aria-label={`${c.name}: in the deck`}
                        onClick={() => toggle(c)}
                        style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 150px", minWidth: 0, padding: "5px 0", border: "none", background: "none", cursor: "pointer", textAlign: "left", color: on ? "var(--t3)" : "var(--t1)", fontFamily: "var(--font-ui)", fontSize: 15 }}
                      >
                        <span style={{ flex: "none", width: 22, height: 22, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", background: on ? "var(--gold)" : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px var(--t3)", color: "var(--accent-ink)" }}>
                          {on && <Check size={15} strokeWidth={3.25} />}
                        </span>
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: on ? "line-through" : "none" }}>
                          {c.quantity > 1 ? `${c.quantity} ` : ""}
                          {c.name}
                        </span>
                      </button>
                      {/* Where to look for it, while it's still missing. */}
                      {!on && (
                        <span style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: 5, flex: "0 1 auto", maxWidth: "100%", marginLeft: "auto", padding: "5px 0", fontSize: 12.5 }}>
                          {have > 0 ? (
                            <span style={{ ...hint, background: "rgba(13,138,95,.16)", color: "#0d8a5f" }} title="In your collection">
                              Own {have}
                            </span>
                          ) : (
                            <span style={{ ...hint, color: "var(--t3)" }}>Not owned</span>
                          )}
                          {other.slice(0, 3).map((d) => (
                            <Link key={d.publicId} href={`/deck/${d.publicId}`} title={d.assembled ? `Ticked as assembled in ${d.name}: it’s probably there` : d.deck ? `In ${d.name}’s list` : `In ${d.name}’s pool`} style={{ ...hint, maxWidth: 170, color: "var(--t1)", textDecoration: "none", boxShadow: d.assembled ? "inset 0 0 0 1.5px var(--gold)" : "none" }}>
                              {d.assembled && <Check size={11} strokeWidth={3.25} style={{ flex: "none", color: "var(--gold)" }} />}
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {d.deck ? "In " : "Pool of "}
                                {d.name}
                              </span>
                            </Link>
                          ))}
                          {other.length > 3 && <span style={{ ...hint, color: "var(--t3)" }}>+{other.length - 3}</span>}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {preview && typeof document !== "undefined" && createPortal(<CardPreview preview={preview} onClose={() => setPreview(null)} />, document.body)}
          {state.assembled.size > 0 && total - done === 0 && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={onClose} style={goldBtn}>Done</button>
            </div>
          )}
        </>
      )}
    </ModalShell>
  );
}

const previewWidth = () => Math.min(260, window.innerWidth - 40);
/** Is there room for the large card to the right or the left of the sheet? */
const fitsBeside = (sheet: DOMRect) => sheet.right + 14 + previewWidth() <= window.innerWidth - 8 || sheet.left - 14 - previewWidth() >= 8;

/* The card, large. Hovered: beside the sheet, level with its row, and out of
   the mouse's way. Tapped: the same place when there's room, else the middle
   of the screen, over a layer that closes it. */
function CardPreview({ preview, onClose }: { preview: Preview; onClose: () => void }) {
  const { card, row, sheet, pinned } = preview;
  const W = previewWidth();
  const H = Math.round((W * 7) / 5);
  const right = sheet.right + 14 + W <= window.innerWidth - 8;
  const leftSide = sheet.left - 14 - W >= 8;
  const beside = right || leftSide;
  const left = right ? sheet.right + 14 : leftSide ? sheet.left - 14 - W : Math.round((window.innerWidth - W) / 2);
  const top = beside ? Math.max(8, Math.min(row.top + row.height / 2 - H / 2, window.innerHeight - H - 8)) : Math.max(8, Math.round((window.innerHeight - H) / 2));
  return (
    <>
      {pinned && <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 94, background: beside ? "transparent" : "rgba(8,6,11,.55)" }} />}
      <div
        onClick={onClose}
        role="img"
        aria-label={card.name}
        style={{ position: "fixed", top, left, width: W, height: H, zIndex: 95, pointerEvents: pinned ? "auto" : "none", borderRadius: "4.8%/3.5%", overflow: "hidden", background: "#000", boxShadow: "0 18px 40px -12px rgba(0,0,0,.7)", animation: "sp-fade .12s ease" }}
      >
        <CardArt key={card.dbId} name={card.name} src={card.imageUri || undefined} prefer="src" version="normal" loading="eager" radius={0} style={{ position: "absolute", inset: 0 }} />
      </div>
    </>
  );
}

const hint: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 9px",
  borderRadius: 999,
  background: "var(--bg3)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};
