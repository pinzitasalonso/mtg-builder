"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, ExternalLink, Heart, PackageCheck } from "lucide-react";
import type { CardElsewhere } from "@/app/api/decks/[id]/assemble/route";
import type { OwnedCopy } from "@/components/deck/DeckCardSheet";
import { CardArt, CAT_COLOR, categoryOf, scanVersionURL, TYPE_ORDER } from "@/components/mtg";
import type { PoolEntry } from "@/lib/pool-client";
import { addToWishlist } from "@/lib/wishlist-client";
import { ModalShell, ghostBtn, goldBtn } from "./ui";

/* "Assemble deck": building the deck in cardboard. Tick each card as it goes
   into the pile; what's left is what you still have to find. For those, the
   screen says what it knows: the copies in your collection, and which of your
   other decks hold the card (ticked there too: that's where it probably is).
   The ticks are saved on the deck, so the list is the same on your phone.

   It takes the whole screen. The list reads like the deck view: the
   commander first, then the cards by type, A to Z. It can be narrowed to
   what's still to find, what you don't own, or what one of your other decks
   holds: pick a deck, pull those cards out of its box, tick them all.

   Each row has the card's picture small. On a wide screen the card the mouse
   is on shows large in a column at the side; on a phone a tap on the picture
   shows it over the list. */

interface State {
  assembled: Set<number>;
  elsewhere: Record<string, CardElsewhere[]>;
}

/** What the list shows: everything, what's left, what you'd have to buy, or
    what's left that one of your other decks holds ("deck:<publicId>"). */
type Filter = "all" | "missing" | "unowned" | `deck:${string}`;

/** One of your other decks, as a filter: how many of the cards still to find it holds. */
interface DeckHolding {
  publicId: string;
  name: string;
  missing: number;
  /** Some of them are ticked there: the cardboard is probably in that box. */
  ticked: boolean;
}

const WIDE = "(min-width: 960px)";

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
  const [filter, setFilter] = useState<Filter>("all");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // The card shown large: in the side column on a wide screen, over the list otherwise.
  const [focus, setFocus] = useState<PoolEntry | null>(null);
  const [overlay, setOverlay] = useState<PoolEntry | null>(null);
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

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
  async function tick(list: PoolEntry[], on: boolean) {
    if (!state || !list.length) return;
    const ids = list.map((c) => c.dbId);
    const flip = (to: boolean) =>
      setState((s) => {
        if (!s) return s;
        const assembled = new Set(s.assembled);
        for (const id of ids) {
          if (to) assembled.add(id);
          else assembled.delete(id);
        }
        return { ...s, assembled };
      });
    flip(on);
    setNote("");
    if (!(await post({ cardIds: ids, assembled: on }))) {
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

  const key = (c: PoolEntry) => c.name.toLowerCase();
  const have = (c: PoolEntry) => owned.get(key(c))?.quantity ?? 0;
  const total = cards.reduce((n, c) => n + c.quantity, 0);
  const done = state ? cards.filter((c) => state.assembled.has(c.dbId)).reduce((n, c) => n + c.quantity, 0) : 0;
  const missing = state ? cards.filter((c) => !state.assembled.has(c.dbId)) : [];
  // Still to find, and not in your collection: what you'd have to get.
  const toBuy = missing.filter((c) => have(c) < c.quantity);

  // Your other decks that hold cards still to find, the most first. A deck
  // stays in the row while it's the one picked, even once it's emptied.
  const holdings = useMemo(() => {
    if (!state) return [];
    const by = new Map<string, DeckHolding>();
    for (const c of cards) {
      const left = !state.assembled.has(c.dbId);
      for (const d of state.elsewhere[key(c)] ?? []) {
        const h = by.get(d.publicId) ?? { publicId: d.publicId, name: d.name, missing: 0, ticked: false };
        if (left) {
          h.missing += 1;
          h.ticked ||= d.assembled;
        }
        by.set(d.publicId, h);
      }
    }
    return [...by.values()].filter((h) => h.missing > 0 || filter === `deck:${h.publicId}`).sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name));
  }, [cards, state, filter]);
  const pickedDeck = filter.startsWith("deck:") ? (holdings.find((h) => `deck:${h.publicId}` === filter) ?? null) : null;

  const shown = useMemo(() => {
    if (!state) return [];
    if (filter === "missing") return missing;
    if (filter === "unowned") return toBuy;
    if (filter.startsWith("deck:")) {
      const id = filter.slice(5);
      return missing.filter((c) => (state.elsewhere[key(c)] ?? []).some((d) => d.publicId === id));
    }
    return cards;
    // missing and toBuy are worked out from cards, state and owned on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, state, owned, filter]);

  // The deck view's order: the commander, then each type, A to Z within it.
  const groups = useMemo(() => {
    const commander = shown.filter((c) => isCommander?.(c));
    const by = new Map<string, PoolEntry[]>();
    for (const c of shown) {
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
  }, [shown]);

  async function wishMissing() {
    if (busy || !toBuy.length) return;
    setBusy(true);
    const r = await addToWishlist(
      toBuy.map((c) => ({ name: c.name, quantity: Math.max(1, c.quantity - have(c)), imageUri: c.imageUri, typeLine: c.typeLine, manaCost: c.manaCost, colorIdentity: c.colorIdentity }))
    );
    setBusy(false);
    setNote(r.ok ? `${(r.added ?? 0) + (r.raised ?? 0)} added to your wishlist${r.already ? `, ${r.already} already there` : ""}.` : (r.error ?? "Couldn’t add them."));
  }

  const pickDeck = (publicId: string) => {
    setFilter(`deck:${publicId}`);
    setNote("");
  };
  const showLarge = (c: PoolEntry) => (wide ? setFocus(c) : setOverlay(c));
  // The side column shows the card the mouse was last on, else the first in the list.
  const large = (focus && shown.some((c) => c.dbId === focus.dbId) ? focus : null) ?? groups[0]?.cards[0] ?? null;
  const pad = wide ? "0 32px" : "0 16px";

  return (
    <ModalShell onDismiss={onClose} maxWidth={0} fullScreen labelledBy="assemble-title">
      {/* The head: the title, the progress, Close. It stays while the list scrolls. */}
      <header style={{ flex: "none", borderBottom: "1px solid var(--line)", background: "var(--bg)" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: wide ? "18px 32px 14px" : "14px 16px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <h2 id="assemble-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: 9, fontFamily: "var(--font-display)", fontSize: wide ? 26 : 22, fontWeight: 700, color: "var(--frame-ink)" }}>
              <PackageCheck size={wide ? 24 : 21} strokeWidth={2} /> Assemble deck
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {state && state.assembled.size > 0 && total - done === 0 && (
                <button onClick={onClose} style={{ ...goldBtn, padding: "7px 16px" }}>
                  Done
                </button>
              )}
              <button onClick={onClose} style={{ ...ghostBtn, padding: "7px 14px" }}>
                Close
              </button>
            </div>
          </div>
          {state && (
            <>
              <div aria-live="polite" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 10, fontSize: 14, color: "var(--t1)", fontWeight: 600 }}>
                <span data-testid="assemble-progress">
                  {done} of {total} cards in the deck
                </span>
                <span style={{ color: "var(--t3)", fontWeight: 500 }}>{total - done === 0 ? "All there." : `${total - done} to find`}</span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: "var(--bg3)", overflow: "hidden", marginTop: 7 }}>
                <div style={{ width: `${total ? (done / total) * 100 : 0}%`, height: "100%", background: "var(--gold)", transition: "width .2s ease" }} />
              </div>
            </>
          )}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: pad, display: "flex", gap: 32, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0, padding: "16px 0 40px" }}>
            {failed ? (
              <p role="alert" style={{ margin: 0, fontSize: 14, color: "#ff9c86" }}>Couldn’t load this deck’s list. Close this and try again.</p>
            ) : !state ? (
              <p style={{ margin: 0, fontSize: 14, color: "var(--t2)" }}>Loading…</p>
            ) : (
              <>
                <p style={{ margin: "0 0 14px", fontSize: 14, color: "var(--t2)", lineHeight: 1.45 }}>Tick each card as you put it in the deck. What’s left is what you still have to find.</p>

                {/* What to show. */}
                <div role="group" aria-label="Show" style={chipRow(wide)}>
                  <Chip on={filter === "all"} onClick={() => setFilter("all")} label="All" count={cards.length} />
                  <Chip on={filter === "missing"} onClick={() => setFilter("missing")} label="Still to find" count={missing.length} />
                  <Chip on={filter === "unowned"} onClick={() => setFilter("unowned")} label="Not owned" count={toBuy.length} />
                </div>
                {/* Where the missing cards are: one of your other decks. */}
                {holdings.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div className="id-label" style={{ color: "var(--t3)", fontSize: 11, marginBottom: 6 }}>
                      In your other decks
                    </div>
                    <div role="group" aria-label="In your other decks" style={chipRow(wide)}>
                      {holdings.map((h) => (
                        <Chip
                          key={h.publicId}
                          on={filter === `deck:${h.publicId}`}
                          onClick={() => pickDeck(h.publicId)}
                          label={h.name}
                          count={h.missing}
                          ticked={h.ticked}
                          title={h.ticked ? `Some are ticked as assembled in ${h.name}: they’re probably in that box` : undefined}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* A deck picked: pull its cards, tick them all. */}
                {pickedDeck && (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 14, padding: "10px 12px", borderRadius: 12, background: "var(--bg2)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
                    <span style={{ flex: "1 1 200px", fontSize: 14, color: "var(--t1)", fontWeight: 600 }}>
                      {shown.length ? `${shown.length} to pull from ${pickedDeck.name}` : `Nothing left to pull from ${pickedDeck.name}.`}
                    </span>
                    <Link href={`/deck/${pickedDeck.publicId}`} style={{ ...ghostBtn, padding: "6px 12px", fontSize: 13, textDecoration: "none" }}>
                      <ExternalLink size={13} strokeWidth={2.25} /> Open deck
                    </Link>
                    {shown.length > 0 && (
                      <button onClick={() => void tick(shown, true)} style={{ ...goldBtn, padding: "6px 14px", fontSize: 13 }}>
                        <Check size={14} strokeWidth={3} /> Tick all {shown.length}
                      </button>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, margin: "14px 0" }}>
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

                {groups.length === 0 && !pickedDeck && (
                  <p style={{ margin: 0, fontSize: 14, color: "var(--t2)" }}>
                    {!cards.length ? "This deck has no cards yet." : filter === "unowned" ? "You own every card that’s still to find." : "Every card is in the deck."}
                  </p>
                )}
                {groups.map((g) => (
                  <section key={g.type} style={{ marginBottom: 16 }}>
                    {/* The deck view's section head: the type's colour, its name, its count. */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: CAT_COLOR[g.type] || "#ccc", flex: "none" }} />
                      <span className="id-label" style={{ color: "var(--t2)", fontSize: 11.5 }}>{g.type}</span>
                      <span className="id-mono" style={{ fontSize: 11.5, color: "var(--t3)" }}>{g.cards.reduce((n, c) => n + c.quantity, 0)}</span>
                      <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
                    </div>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                      {g.cards.map((c) => {
                        const on = state.assembled.has(c.dbId);
                        const own = have(c);
                        // The picked deck first among the places to look.
                        const other = [...(state.elsewhere[key(c)] ?? [])].sort((a, b) => Number(`deck:${b.publicId}` === filter) - Number(`deck:${a.publicId}` === filter));
                        return (
                          <li
                            key={c.dbId}
                            onPointerEnter={(e) => wide && e.pointerType === "mouse" && setFocus(c)}
                            style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 10, padding: "5px 6px", margin: "0 -6px", borderBottom: "1px solid var(--line)", borderRadius: 6, background: wide && large?.dbId === c.dbId ? "var(--bg2)" : "transparent" }}
                          >
                            {/* The card, small. A tap shows it large (on a phone there's no hover). */}
                            <button
                              type="button"
                              onClick={() => showLarge(c)}
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
                              onClick={() => void tick([c], !on)}
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
                            {/* Where to look for it, while it's still missing. A deck's chip shows what else to pull from it. */}
                            {!on && (
                              <span style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: 5, flex: "0 1 auto", maxWidth: "100%", marginLeft: "auto", padding: "5px 0", fontSize: 12.5 }}>
                                {own > 0 ? (
                                  <span style={{ ...hint, background: "rgba(13,138,95,.16)", color: "#0d8a5f" }} title="In your collection">
                                    Own {own}
                                  </span>
                                ) : (
                                  <span style={{ ...hint, color: "var(--t3)" }}>Not owned</span>
                                )}
                                {other.slice(0, 3).map((d) => (
                                  <button
                                    key={d.publicId}
                                    type="button"
                                    onClick={() => pickDeck(d.publicId)}
                                    title={`${d.assembled ? `Ticked as assembled in ${d.name}: it’s probably there` : d.deck ? `In ${d.name}’s list` : `In ${d.name}’s pool`}. Show what else to pull from it.`}
                                    style={{ ...hint, maxWidth: 170, border: "none", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--t1)", boxShadow: d.assembled ? "inset 0 0 0 1.5px var(--gold)" : "none" }}
                                  >
                                    {d.assembled && <Check size={11} strokeWidth={3.25} style={{ flex: "none", color: "var(--gold)" }} />}
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {d.deck ? "In " : "Pool of "}
                                      {d.name}
                                    </span>
                                  </button>
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
              </>
            )}
          </div>

          {/* The card the mouse is on, large, with where to find it. */}
          {wide && state && large && (
            <aside aria-label="The card" style={{ flex: "none", width: 280, position: "sticky", top: 16, padding: "16px 0" }}>
              <div style={{ width: 280, aspectRatio: "5 / 7", borderRadius: "4.8%/3.5%", overflow: "hidden", background: "#000", boxShadow: "0 18px 40px -12px rgba(0,0,0,.6)" }}>
                <CardArt key={large.dbId} name={large.name} src={large.imageUri || undefined} prefer="src" version="normal" loading="eager" radius={0} style={{ width: "100%", height: "100%" }} />
              </div>
              <Where card={large} have={have(large)} elsewhere={state.elsewhere[key(large)] ?? []} ticked={state.assembled.has(large.dbId)} onDeck={pickDeck} />
            </aside>
          )}
        </div>
      </div>
      {overlay && typeof document !== "undefined" && createPortal(<CardOverlay card={overlay} onClose={() => setOverlay(null)} />, document.body)}
    </ModalShell>
  );
}

/** Under the large card: in the deck or not, the copies owned, every deck that holds it. */
function Where({ card, have, elsewhere, ticked, onDeck }: { card: PoolEntry; have: number; elsewhere: CardElsewhere[]; ticked: boolean; onDeck: (publicId: string) => void }) {
  return (
    <div style={{ marginTop: 12, fontSize: 13, color: "var(--t2)", lineHeight: 1.5 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--t1)" }}>
        {card.quantity > 1 ? `${card.quantity} ` : ""}
        {card.name}
      </div>
      <div>{ticked ? "In the deck." : have > 0 ? `${have} in your collection.` : "Not in your collection."}</div>
      {!ticked && elsewhere.length > 0 && (
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {elsewhere.map((d) => (
            <li key={d.publicId}>
              <button type="button" onClick={() => onDeck(d.publicId)} style={{ ...hint, border: "none", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--t1)", maxWidth: "100%", boxShadow: d.assembled ? "inset 0 0 0 1.5px var(--gold)" : "none" }}>
                {d.assembled && <Check size={11} strokeWidth={3.25} style={{ flex: "none", color: "var(--gold)" }} />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.deck ? `${d.deck} in ` : "Pool of "}
                  {d.name}
                  {d.assembled ? ", ticked there" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A filter: its name and how many cards it shows. */
function Chip({ on, onClick, label, count, ticked, title }: { on: boolean; onClick: () => void; label: string; count: number; ticked?: boolean; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={title}
      style={{
        ...ghostBtn,
        flex: "none",
        maxWidth: 260,
        padding: "6px 12px",
        fontSize: 13,
        gap: 7,
        ...(on ? { background: "var(--t1)", borderColor: "var(--t1)", color: "var(--bg)" } : {}),
      }}
    >
      {ticked && <Check size={12} strokeWidth={3.25} style={{ flex: "none", color: on ? "var(--bg)" : "var(--gold)" }} />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span className="id-mono" style={{ opacity: 0.7 }}>{count}</span>
    </button>
  );
}

/* A row of filters: wrapped on a wide screen, one line that scrolls sideways on a phone. */
const chipRow = (wide: boolean): React.CSSProperties =>
  wide
    ? { display: "flex", flexWrap: "wrap", gap: 6 }
    : { display: "flex", gap: 6, overflowX: "auto", margin: "0 -16px", padding: "0 16px 2px", scrollbarWidth: "none" };

/* The card, large, over the list (a phone, where the side column isn't). A tap closes it. */
function CardOverlay({ card, onClose }: { card: PoolEntry; onClose: () => void }) {
  const W = Math.min(300, window.innerWidth - 40);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(8,6,11,.6)", display: "flex", alignItems: "center", justifyContent: "center", animation: "sp-fade .12s ease" }}>
      <div role="img" aria-label={card.name} style={{ width: W, aspectRatio: "5 / 7", borderRadius: "4.8%/3.5%", overflow: "hidden", background: "#000", boxShadow: "0 18px 40px -12px rgba(0,0,0,.7)" }}>
        <CardArt key={card.dbId} name={card.name} src={card.imageUri || undefined} prefer="src" version="normal" loading="eager" radius={0} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
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
