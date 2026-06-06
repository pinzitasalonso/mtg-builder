"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

export interface SwipeCard {
  id: string;
  name: string;
  imageUri: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
}

const SWIPE_THRESHOLD = 110;

export default function SwipeDeck({
  cards,
  inPool,
  onAdd,
  onDiscard,
  onInfo,
  onRestart,
}: {
  cards: SwipeCard[];
  inPool: (id: string) => boolean;
  onAdd: (card: SwipeCard) => void;
  onDiscard: (card: SwipeCard) => void;
  onInfo: (card: SwipeCard) => void;
  onRestart: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [added, setAdded] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [flyOut, setFlyOut] = useState<null | "left" | "right">(null);

  const dragging = useRef(false);
  const moved = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const stackRef = useRef<HTMLDivElement>(null);

  // Prevent iOS Safari from treating the horizontal swipe as a page scroll
  // (touchAction: none alone isn't always respected before the first touchmove)
  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const prevent = (e: TouchEvent) => e.preventDefault();
    el.addEventListener("touchmove", prevent, { passive: false });
    return () => el.removeEventListener("touchmove", prevent);
  }, []);

  const current = cards[index];
  const next = cards[index + 1];
  const done = index >= cards.length;

  const advance = useCallback(() => {
    setDrag({ x: 0, y: 0 });
    setFlyOut(null);
    setIndex((i) => i + 1);
  }, []);

  const decide = useCallback(
    (dir: "left" | "right") => {
      if (!current || flyOut) return;
      if (dir === "right") {
        onAdd(current);
        setAdded((n) => n + 1);
      } else {
        onDiscard(current);
        setSkipped((n) => n + 1);
      }
      setFlyOut(dir);
      window.setTimeout(advance, 260);
    },
    [current, flyOut, onAdd, onDiscard, advance]
  );

  function onPointerDown(e: React.PointerEvent) {
    if (flyOut || !current) return;
    dragging.current = true;
    moved.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved.current = true;
    setDrag({ x: dx, y: dy });
  }

  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    if (drag.x > SWIPE_THRESHOLD) decide("right");
    else if (drag.x < -SWIPE_THRESHOLD) decide("left");
    else setDrag({ x: 0, y: 0 });
  }

  // Visual derivations
  const rotate = flyOut
    ? flyOut === "right"
      ? 16
      : -16
    : Math.max(-16, Math.min(16, drag.x / 16));
  const transform = flyOut
    ? `translate(${flyOut === "right" ? 140 : -140}%, 0) rotate(${rotate}deg)`
    : `translate(${drag.x}px, 0) rotate(${rotate}deg)`;
  const transition =
    flyOut || (!dragging.current && drag.x === 0 && drag.y === 0)
      ? "transform 0.26s ease"
      : "none";
  const likeOpacity = Math.max(0, Math.min(1, drag.x / SWIPE_THRESHOLD));
  const nopeOpacity = Math.max(0, Math.min(1, -drag.x / SWIPE_THRESHOLD));

  if (done) {
    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 16,
          background: "var(--surface)",
          padding: "40px 24px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 32 }}>🎉</div>
        <div style={{ fontWeight: 700, fontSize: 18 }}>All cards reviewed</div>
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
          Added <strong style={{ color: "var(--accent)" }}>{added}</strong> · Skipped{" "}
          <strong>{skipped}</strong> · {cards.length} total
        </div>
        <button
          type="button"
          onClick={onRestart}
          style={{
            marginTop: 6,
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 10,
            color: "var(--text)",
            padding: "10px 18px",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Review again
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, touchAction: "none" }}>
      {/* Progress */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          maxWidth: 360,
          fontSize: 13,
          color: "var(--text-muted)",
        }}
      >
        <span style={{ whiteSpace: "nowrap" }}>
          {index + 1} / {cards.length}
        </span>
        <div
          style={{
            flex: 1,
            height: 6,
            background: "var(--surface2)",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${((index + 1) / cards.length) * 100}%`,
              height: "100%",
              background: "var(--accent)",
              transition: "width 0.26s ease",
            }}
          />
        </div>
        <span style={{ whiteSpace: "nowrap", color: "var(--accent)" }}>+{added}</span>
      </div>

      {/* Card stack */}
      <div
        ref={stackRef}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 360,
          aspectRatio: "5 / 7",
          touchAction: "none",
        }}
      >
        {/* Next card peeking behind for depth */}
        {next && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              transform: "scale(0.94) translateY(10px)",
              borderRadius: 14,
              overflow: "hidden",
              opacity: 0.6,
            }}
          >
            <CardFace card={next} />
          </div>
        )}

        {/* Top card */}
        {current && (
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 14,
              overflow: "hidden",
              cursor: dragging.current ? "grabbing" : "grab",
              transform,
              transition,
              boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
              border: inPool(current.id) ? "2px solid var(--accent)" : "2px solid transparent",
              userSelect: "none",
              touchAction: "none",
            }}
          >
            <CardFace card={current} />

            {/* LIKE / NOPE stamps */}
            <div
              style={{
                position: "absolute",
                top: 18,
                left: 18,
                transform: "rotate(-16deg)",
                border: "4px solid #43d17a",
                color: "#43d17a",
                borderRadius: 8,
                padding: "2px 12px",
                fontWeight: 900,
                fontSize: 26,
                letterSpacing: 1,
                opacity: likeOpacity,
                pointerEvents: "none",
              }}
            >
              ADD
            </div>
            <div
              style={{
                position: "absolute",
                top: 18,
                right: 18,
                transform: "rotate(16deg)",
                border: "4px solid var(--danger)",
                color: "var(--danger)",
                borderRadius: 8,
                padding: "2px 12px",
                fontWeight: 900,
                fontSize: 26,
                letterSpacing: 1,
                opacity: nopeOpacity,
                pointerEvents: "none",
              }}
            >
              SKIP
            </div>

            {/* Info button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!moved.current) onInfo(current);
              }}
              title="Card details"
              aria-label="Card details"
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: "none",
                background: "rgba(0,0,0,0.55)",
                color: "#fff",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
                backdropFilter: "blur(4px)",
              }}
            >
              i
            </button>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 22, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => decide("left")}
          title="Skip"
          aria-label="Skip card"
          style={actionBtn("var(--danger)")}
        >
          ✕
        </button>
        <button
          type="button"
          onClick={() => onInfo(current)}
          title="Details"
          aria-label="Card details"
          style={{ ...actionBtn("var(--text-muted)"), width: 46, height: 46, fontSize: 18 }}
        >
          ⓘ
        </button>
        <button
          type="button"
          onClick={() => decide("right")}
          title="Add to pool"
          aria-label="Add to pool"
          style={actionBtn("#43d17a")}
        >
          ♥
        </button>
      </div>

      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Swipe right to add · left to skip
      </div>
    </div>
  );
}

function CardFace({ card }: { card: SwipeCard }) {
  if (card.imageUri) {
    return (
      <Image
        src={card.imageUri}
        alt={card.name}
        width={488}
        height={680}
        unoptimized
        draggable={false}
        style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
      />
    );
  }
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "var(--surface2)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: 16,
        textAlign: "center",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 16 }}>{card.name}</div>
      {card.typeLine && (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{card.typeLine}</div>
      )}
    </div>
  );
}

function actionBtn(color: string): React.CSSProperties {
  return {
    width: 58,
    height: 58,
    borderRadius: "50%",
    border: `2px solid ${color}`,
    background: "var(--surface)",
    color,
    fontSize: 24,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
  };
}
