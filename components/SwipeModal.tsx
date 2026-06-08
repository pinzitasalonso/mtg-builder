"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClassicCard } from "@/components/mtg";

export interface SwipeCard {
  id: string;
  name: string;
  imageUri: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
}

const THRESHOLD = 110;

/* Full-screen "Oracle Search" modal — review AI/Scryfall results one classic
   card at a time: swipe/→ to add to the pool, swipe/← to skip. */
export default function SwipeModal({
  cards,
  query,
  intent,
  onAdd,
  onInfo,
  onClose,
}: {
  cards: SwipeCard[];
  query: string;
  intent?: string;
  onAdd: (card: SwipeCard) => void;
  onInfo?: (card: SwipeCard) => void;
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const [added, setAdded] = useState(0);
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
      if (dir === "right" && card) {
        onAdd(card);
        setAdded((a) => a + 1);
      }
      setTimeout(() => {
        setExit(null);
        setDrag(0);
        setI((x) => x + 1);
      }, 280);
    },
    [exit, done, card, onAdd]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") act("right");
      else if (e.key === "ArrowLeft") act("left");
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, onClose]);

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
        background: "radial-gradient(120% 90% at 50% 0%, rgba(40,28,14,.9), rgba(8,6,4,.94))",
        backdropFilter: "blur(8px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 28px", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="label-sc" style={{ fontSize: 12, color: "var(--gold)", letterSpacing: ".16em" }}>
            Oracle Search
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
          style={{ width: 40, height: 40, borderRadius: 10, border: "none", cursor: "pointer", color: "#f0e3c4", fontSize: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* intent + progress */}
      <div style={{ maxWidth: 440, width: "92%", margin: "0 auto" }}>
        {intent && (
          <div className="cc-paper" style={{ padding: "11px 16px", marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--ink)", textAlign: "center", fontStyle: "italic" }}>
              <span className="label-sc" style={{ fontStyle: "normal", fontSize: 11, color: "#7a5a1e", letterSpacing: ".1em" }}>
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
          <div style={{ flex: 1, height: 6, borderRadius: 4, background: "rgba(0,0,0,.4)", overflow: "hidden", boxShadow: "inset 0 0 0 1px rgba(200,155,65,.25)" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--gold)", transition: "width .35s ease" }} />
          </div>
          <span style={{ fontSize: 14, color: "var(--gold-bright)", fontWeight: 600, width: 34, textAlign: "right", fontFamily: "var(--font-display)" }}>
            +{added}
          </span>
        </div>
      </div>

      {/* card area */}
      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        {done ? (
          <div style={{ textAlign: "center", animation: "sp-pop .35s ease" }}>
            <div style={{ fontSize: 40, color: "var(--gold)", marginBottom: 6 }}>✦</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 600, color: "var(--text)" }}>
              Added {added} card{added === 1 ? "" : "s"} to the pool
            </div>
            <div style={{ fontStyle: "italic", fontSize: 14.5, color: "var(--text-muted)", marginTop: 6 }}>
              That is the end of this batch.
            </div>
            <button
              onClick={onClose}
              className="cc-plate"
              style={{ marginTop: 20, padding: "11px 24px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, color: "#f4e9cd" }}
            >
              Return to deck
            </button>
          </div>
        ) : (
          <>
            {cards[i + 1] && (
              <div style={{ position: "absolute", width: 320, transform: "scale(.92) translateY(14px)", opacity: 0.45, filter: "brightness(.7)", pointerEvents: "none" }}>
                <ClassicCard card={cards[i + 1]} variant="full" />
              </div>
            )}
            <div
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
              <ClassicCard card={card} variant="full" />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 16,
                  pointerEvents: "none",
                  boxShadow:
                    decision === "right"
                      ? "0 0 60px rgba(120,200,120,.5)"
                      : decision === "left"
                        ? "0 0 60px rgba(200,110,90,.5)"
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
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <SwBtn kind="skip" onClick={() => act("left")} />
            <SwBtn kind="info" onClick={() => card && onInfo?.(card)} />
            <SwBtn kind="add" onClick={() => act("right")} />
          </div>
          <div style={{ fontSize: 13, color: "var(--text-dim)", fontStyle: "italic" }}>← skip · → add to pool</div>
        </div>
      )}
    </div>
  );
}

function SwBtn({ kind, onClick }: { kind: "skip" | "info" | "add"; onClick?: () => void }) {
  const cfg = {
    skip: { ic: "✕", color: "#cf7d5e", size: 58 },
    info: { ic: "i", color: "#b6a37c", size: 46 },
    add: { ic: "✦", color: "#9bbf6e", size: 58 },
  }[kind];
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      aria-label={kind}
      style={{
        width: cfg.size,
        height: cfg.size,
        borderRadius: "50%",
        cursor: "pointer",
        border: "none",
        background: h ? `${cfg.color}26` : "rgba(20,14,8,.6)",
        color: cfg.color,
        fontSize: cfg.size * 0.36,
        fontFamily: kind === "info" ? "var(--font-display)" : "inherit",
        fontStyle: kind === "info" ? "italic" : "normal",
        boxShadow: `inset 0 0 0 2px ${cfg.color}99, 0 4px 10px rgba(0,0,0,.4)`,
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
