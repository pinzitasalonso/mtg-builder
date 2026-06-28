"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClassicCard } from "@/components/mtg";
import { fetchUsdPrice } from "@/lib/scryfall";

export interface SwipeCard {
  id: string;
  name: string;
  imageUri: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
}

const THRESHOLD = 80;

/* Per-variant copy + behaviour. `hasPass` means a left swipe is a real action
   (drop the card) rather than a passive skip. */
const VARIANTS = {
  search: {
    eyebrow: "Oracle Search",
    hint: "← skip · → add to pool",
    doneIcon: "✦",
    doneTitle: (acted: number) => `Added ${acted} card${acted === 1 ? "" : "s"} to the pool`,
    doneSub: () => "That is the end of this batch.",
    hasPass: false,
  },
  review: {
    eyebrow: "Review Pool",
    hint: "← remove from pool · → add to deck",
    doneIcon: "✓",
    doneTitle: (acted: number) => `Moved ${acted} card${acted === 1 ? "" : "s"} to the deck`,
    doneSub: (passed: number) =>
      passed > 0 ? `Removed ${passed} card${passed === 1 ? "" : "s"} from the pool.` : "You triaged the whole pool.",
    hasPass: true,
  },
  "deck-review": {
    eyebrow: "Review Deck",
    hint: "← remove from deck · → keep",
    doneIcon: "✓",
    doneTitle: (acted: number) => `Kept ${acted} card${acted === 1 ? "" : "s"}`,
    doneSub: (passed: number) =>
      passed > 0 ? `Removed ${passed} card${passed === 1 ? "" : "s"} from the deck.` : "You reviewed the whole deck.",
    hasPass: true,
  },
} as const;

export type SwipeVariant = keyof typeof VARIANTS;

/* Full-screen swipe modal — review cards one full-scan card at a time.
   variant "search": swipe/→ adds the card to the pool, swipe/← skips.
   variant "review": triage the pool — swipe/→ promotes the card to the deck
   (onAdd), swipe/← passes on it, removing it from the pool (onPass).
   variant "deck-review": triage the deck — swipe/→ keeps the card (onAdd, a
   no-op), swipe/← discards it from the deck entirely (onPass). */
export default function SwipeModal<T extends SwipeCard>({
  cards,
  query,
  intent,
  onAdd,
  onPass,
  onInfo,
  onClose,
  variant = "search",
  startIndex = 0,
}: {
  cards: T[];
  query: string;
  intent?: string;
  onAdd: (card: T) => void;
  /** Called when a card is passed (swipe/←) — used to drop it from the pool or deck. */
  onPass?: (card: T) => void;
  onInfo?: (card: T) => void;
  onClose: () => void;
  variant?: SwipeVariant;
  /** Card index to open on — lets a tapped tile start review from that card. */
  startIndex?: number;
}) {
  const copy = VARIANTS[variant];
  const [i, setI] = useState(startIndex);
  // Counts cards acted on (→): added in search, promoted in pool review, kept in deck review.
  const [acted, setActed] = useState(0);
  // Counts cards passed (←) — removed from the pool or deck.
  const [passed, setPassed] = useState(0);
  const [exit, setExit] = useState<null | "left" | "right">(null);
  const [drag, setDrag] = useState(0);

  const dragging = useRef(false);
  const startX = useRef(0);

  const card = cards[i];
  const done = i >= cards.length;

  const act = useCallback(
    (dir: "left" | "right") => {
      if (exit || done) return;
      setExit(dir);
      if (card && dir === "right") {
        onAdd(card);
        setActed((a) => a + 1);
      } else if (card && dir === "left" && copy.hasPass) {
        onPass?.(card);
        setPassed((p) => p + 1);
      }
      setTimeout(() => {
        setExit(null);
        setDrag(0);
        setI((x) => x + 1);
      }, 280);
    },
    [exit, done, card, copy.hasPass, onAdd, onPass]
  );

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") act("right");
      else if (e.key === "ArrowLeft") act("left");
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, onClose]);

  // Market price of the current card (and a quiet prefetch of the next one), via
  // Scryfall by id. `undefined` = loading, `null` = no price, string = USD.
  const [price, setPrice] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const id = card?.id;
    if (!id) {
      setPrice(null);
      return;
    }
    let live = true;
    setPrice(undefined);
    fetchUsdPrice(id).then((p) => {
      if (live) setPrice(p);
    });
    if (cards[i + 1]?.id) fetchUsdPrice(cards[i + 1].id);
    return () => {
      live = false;
    };
  }, [card?.id, cards, i]);

  function onPointerDown(e: React.PointerEvent) {
    if (done || exit) return;
    dragging.current = true;
    startX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    setDrag(e.clientX - startX.current);
  }
  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    if (drag > THRESHOLD) act("right");
    else if (drag < -THRESHOLD) act("left");
    else setDrag(0);
  }

  const pct = Math.round((Math.min(i, cards.length) / cards.length) * 100);
  const tilt = exit === "right" ? 11 : exit === "left" ? -11 : drag / 18;
  const tx = exit === "right" ? "120%" : exit === "left" ? "-120%" : `${drag}px`;
  const decision = exit || (drag > 50 ? "right" : drag < -50 ? "left" : null);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        animation: "sp-fade .2s ease",
        background: "color-mix(in srgb, var(--bg) 94%, transparent)",
        backdropFilter: "blur(8px)",
        display: "flex",
        flexDirection: "column",
        touchAction: "none",
        overscrollBehavior: "none",
      }}
    >
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 28px", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="mn-label" style={{ color: "var(--accent)" }}>
            {copy.eyebrow}
          </div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 23,
              fontWeight: 600,
              color: "var(--text)",
              marginTop: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            “{query}”
          </div>
        </div>
        <button
          onClick={onClose}
          className="cc-plate"
          style={{ width: 40, height: 40, borderRadius: 999, cursor: "pointer", color: "var(--t2)", fontSize: 15, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* intent + progress */}
      <div style={{ maxWidth: 440, width: "92%", margin: "0 auto" }}>
        {intent && (
          <div className="cc-paper" style={{ padding: "11px 16px", marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--t1)", textAlign: "center" }}>
              <span className="mn-label" style={{ color: "var(--accent)" }}>
                What I sought ·{" "}
              </span>
              {intent}
            </p>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13.5, color: "var(--text-muted)", width: 46, fontVariantNumeric: "tabular-nums" }}>
            {Math.min(i + (done ? 0 : 1), cards.length)} / {cards.length}
          </span>
          <div style={{ flex: 1, height: 5, borderRadius: 99, background: "var(--bar-track)", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width .35s ease" }} />
          </div>
          <span style={{ fontSize: 14, color: "var(--accent)", fontWeight: 600, width: 38, textAlign: "right", fontFamily: "var(--font-mono)" }}>
            +{acted}
          </span>
        </div>
      </div>

      {/* card area */}
      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        {/* on wide screens the keep/remove buttons flank the card */}
        {!done && (
          <>
            <div className="sw-side sw-side-left">
              <SwBtn kind="skip" size={74} onClick={() => act("left")} />
            </div>
            <div className="sw-side sw-side-right">
              <SwBtn kind="add" size={74} onClick={() => act("right")} />
            </div>
          </>
        )}
        {done ? (
          <div style={{ textAlign: "center", animation: "sp-pop .35s ease" }}>
            <div style={{ fontSize: 40, color: "var(--accent)", marginBottom: 6 }}>{copy.doneIcon}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 600, color: "var(--text)" }}>
              {copy.doneTitle(acted)}
            </div>
            <div style={{ fontSize: 14.5, color: "var(--t2)", marginTop: 6 }}>
              {copy.doneSub(passed)}
            </div>
            <button
              onClick={onClose}
              className="cc-plate"
              style={{ marginTop: 20, padding: "11px 24px", borderRadius: 999, cursor: "pointer", fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 15, color: "var(--t1)" }}
            >
              Return to deck
            </button>
          </div>
        ) : (
          <>
            {cards[i + 1] && (
              <div style={{ position: "absolute", width: 320, transform: "scale(.92) translateY(14px)", opacity: 0.5, filter: "saturate(.4)", pointerEvents: "none" }}>
                <CardFace card={cards[i + 1]} />
              </div>
            )}
            <div
              key={i}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={{
                position: "relative",
                width: 332,
                touchAction: "pan-y",
                cursor: dragging.current ? "grabbing" : "grab",
                transition: exit || !dragging.current ? "transform .3s cubic-bezier(.4,0,.2,1), opacity .3s" : "none",
                transform: `translateX(${tx}) rotate(${tilt}deg)`,
                opacity: exit ? 0 : 1,
              }}
            >
              <CardFace card={card} />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 16,
                  pointerEvents: "none",
                  boxShadow:
                    decision === "right"
                      ? "0 0 60px rgba(13,138,95,.45)"
                      : decision === "left"
                        ? "0 0 60px rgba(194,64,42,.45)"
                        : "none",
                  transition: "box-shadow .1s",
                }}
              />
            </div>
          </>
        )}
      </div>

      {/* actions */}
      {!done && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 13, padding: "8px 0 30px" }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 15,
              fontWeight: 600,
              color: price ? "var(--accent)" : "var(--t3)",
              minHeight: 18,
              letterSpacing: ".02em",
            }}
          >
            {price === undefined ? "" : price ? `$${price}` : "no price"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <span className="sw-narrow-only">
              <SwBtn kind="skip" onClick={() => act("left")} />
            </span>
            <SwBtn kind="info" onClick={() => card && onInfo?.(card)} />
            <span className="sw-narrow-only">
              <SwBtn kind="add" onClick={() => act("right")} />
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--t3)" }}>
            {copy.hint}
          </div>
        </div>
      )}
    </div>
  );
}

/* The card face shown in the swipe stack — matches the card detail screen:
   the real Scryfall scan in a clean white frame, with the readable proxy as a
   fallback when no image is stored. */
function CardFace({ card }: { card: SwipeCard }) {
  if (card.imageUri) {
    return (
      <div className="cc-black" style={{ padding: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={card.imageUri}
          alt={card.name}
          draggable={false}
          style={{ borderRadius: 8, width: "100%", height: "auto", display: "block", userSelect: "none" }}
        />
      </div>
    );
  }
  return <ClassicCard card={card} variant="full" />;
}

function SwBtn({ kind, onClick, size }: { kind: "skip" | "info" | "add"; onClick?: () => void; size?: number }) {
  const cfg = {
    skip: { ic: "✕", color: "#c2402a", size: 58 },
    info: { ic: "i", color: "#9a9aa2", size: 46 },
    add: { ic: "✦", color: "#0d8a5f", size: 58 },
  }[kind];
  const dim = size ?? cfg.size;
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      aria-label={kind}
      style={{
        width: dim,
        height: dim,
        borderRadius: "50%",
        cursor: "pointer",
        border: "none",
        background: h ? `${cfg.color}14` : "var(--bg2)",
        color: cfg.color,
        fontSize: dim * 0.36,
        fontFamily: kind === "info" ? "var(--font-display)" : "inherit",
        
        boxShadow: `inset 0 0 0 2px ${cfg.color}55, 0 4px 12px rgba(21,21,26,.12)`,
        transform: h ? "scale(1.08)" : "scale(1)",
        transition: "transform .15s, background .15s",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {cfg.ic}
    </button>
  );
}
