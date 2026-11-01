"use client";

import { useEffect, useRef, useState } from "react";
import { Crown, Ellipsis, RefreshCw, ZoomIn } from "lucide-react";
import { CardArt } from "@/components/mtg";
import { useVerifiedBack } from "@/components/useCardFlip";
import type { PlayCard, Zone } from "@/lib/playtest";

/* The pieces of a playtest table, shared by the solo table (PlaytestModal)
   and the practice game against the AI (PracticeTable): a card, a pile, a
   life counter, a card's ⋯ menu, the big preview, and a side panel. */

export interface MenuState {
  card: PlayCard;
  zone: Zone;
  anchor: DOMRect;
}
export interface Zoom {
  card: PlayCard;
  /** Where the card was when it was hovered. The preview only lives while the
      card is still there: a card that was just played or cast leaves its zone,
      and an unmounted element never fires pointerleave to clear the hover. */
  zone: Zone;
  anchor: DOMRect;
}

/* One card on the table. The primary click is the zone's natural move; ⋯
   opens the full menu; hover (mouse) or 🔍 (touch) shows it large. */
export function PtCard({
  card,
  zone,
  onPrimary,
  onMenu,
  onZoom,
  onTurn,
  selected,
  badge,
  stat,
}: {
  card: PlayCard;
  zone: Zone;
  onPrimary: (card: PlayCard, zone: Zone, anchor: DOMRect) => void;
  onMenu: (anchor: DOMRect, card: PlayCard, zone: Zone) => void;
  onZoom: (card: PlayCard | null, zone?: Zone, anchor?: DOMRect) => void;
  onTurn: (card: PlayCard) => void;
  /** Practice games: picked (as an attacker, or a blocker being placed). */
  selected?: boolean;
  /** Practice games: a word on the card ("Attacking", "Blocks X"). */
  badge?: string;
  /** Practice games: power/toughness now, when it isn't the printed one. */
  stat?: string | null;
}) {
  // A double-faced card shows the face the game says. The new face swaps in
  // halfway through a quick turn, on a layer of its own so the turn doesn't
  // fight the tapped card's rotation.
  const back = useVerifiedBack(card.name, card.imageUri);
  const flipped = !!card.flipped;
  const [shown, setShown] = useState(flipped);
  const [turning, setTurning] = useState(false);
  const was = useRef(flipped);
  useEffect(() => {
    if (flipped === was.current) return;
    was.current = flipped;
    setTurning(true);
    const swap = setTimeout(() => setShown(flipped), 140);
    const done = setTimeout(() => setTurning(false), 300);
    return () => {
      clearTimeout(swap);
      clearTimeout(done);
    };
  }, [flipped]);
  const src = shown && back ? back : card.imageUri || undefined;

  return (
    <div
      className="pt-card"
      data-tapped={card.tapped ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      aria-label={card.name}
      onClick={(e) => {
        e.stopPropagation();
        onPrimary(card, zone, e.currentTarget.getBoundingClientRect());
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") onZoom(card, zone, e.currentTarget.getBoundingClientRect());
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") onZoom(null);
      }}
    >
      <div className="pt-card-inner">
        <div className={`pt-card-face${turning ? " card-flip" : ""}`}>
          {card.token ? (
            // A token has no scan (and no card to look up by name).
            <div className="pt-token">
              <span>{card.name}</span>
              <span className="pt-token-kind">Token</span>
            </div>
          ) : (
            <CardArt name={card.name} src={src} prefer="src" version="normal" loading="lazy" radius={0} style={{ position: "absolute", inset: 0 }} />
          )}
        </div>
      </div>
      {badge && <span className="pt-badge">{badge}</span>}
      {stat && <span className="pt-stat">{stat}</span>}
      {card.commander && (
        <span className="pt-cmdr" title="Commander" aria-label="Commander">
          <Crown size={12} strokeWidth={2.5} />
        </span>
      )}
      <button
        type="button"
        className="pt-card-btn pt-card-menu"
        aria-label={`${card.name}: more moves`}
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e.currentTarget.getBoundingClientRect(), card, zone);
        }}
      >
        <Ellipsis size={16} strokeWidth={2.5} />
      </button>
      <button
        type="button"
        className="pt-card-btn pt-card-zoom"
        aria-label={`Preview ${card.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onZoom(card, zone, e.currentTarget.getBoundingClientRect());
        }}
      >
        <ZoomIn size={15} strokeWidth={2.25} />
      </button>
      {back && zone !== "library" && (
        <button
          type="button"
          className="pt-card-btn pt-card-turn"
          aria-label={flipped ? `Show the front of ${card.name}` : `Turn ${card.name} over`}
          aria-pressed={flipped}
          title={flipped ? "Show the front" : "Turn over"}
          onClick={(e) => {
            e.stopPropagation();
            onTurn(card);
          }}
        >
          <RefreshCw size={13} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

export function PileZone({ label, cards, top, onOpen }: { label: string; cards: PlayCard[]; top?: PlayCard; onOpen: () => void }) {
  return (
    <div className="pt-zone">
      <div className="pt-zone-label">
        {label} <span>{cards.length}</span>
      </div>
      <div
        className={`pt-pile${top ? "" : " pt-pile-empty"}`}
        role="button"
        tabIndex={0}
        title={`Open ${label.toLowerCase()}`}
        onClick={onOpen}
        onKeyDown={(e) => e.key === "Enter" && onOpen()}
      >
        {top ? (
          <CardArt name={top.name} src={top.imageUri || undefined} prefer="src" version="normal" loading="lazy" radius={0} style={{ position: "absolute", inset: 0 }} />
        ) : (
          "—"
        )}
      </div>
    </div>
  );
}

export function LifeCounter({ label, value, onDelta }: { label: string; value: number; onDelta: (d: number) => void }) {
  return (
    <div className="pt-life" title={`${label} life`}>
      <span className="pt-life-label">{label}</span>
      <button type="button" className="pt-life-5" onClick={() => onDelta(-5)} aria-label={`${label} minus five`}>
        −5
      </button>
      <button type="button" onClick={() => onDelta(-1)} aria-label={`${label} minus one`}>
        −
      </button>
      <span className="pt-life-value">{value}</span>
      <button type="button" onClick={() => onDelta(1)} aria-label={`${label} plus one`}>
        +
      </button>
      <button type="button" className="pt-life-5" onClick={() => onDelta(5)} aria-label={`${label} plus five`}>
        +5
      </button>
    </div>
  );
}

/* The ⋯ menu, anchored to its card. Fixed and portalled to <body> so the
   scrolling battlefield can't clip it; opens upward from the hand row. */
export function ActionMenu<S>({
  menu,
  options,
  onPick,
  onClose,
}: {
  menu: MenuState;
  options: { label: string; step: S }[];
  onPick: (step: S) => void;
  onClose: () => void;
}) {
  const W = 236;
  const a = menu.anchor;
  const up = a.bottom > window.innerHeight - 320;
  const left = Math.max(8, Math.min(a.left, window.innerWidth - W - 8));
  const place: React.CSSProperties = up ? { bottom: window.innerHeight - a.top + 6 } : { top: a.bottom + 6 };
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 89 }} />
      <div className="pt-menu" style={{ position: "fixed", left, width: W, zIndex: 90, ...place }} role="menu">
        <div className="pt-menu-title">{menu.card.name}</div>
        {options.map((o) => (
          <button key={o.label} type="button" role="menuitem" onClick={() => onPick(o.step)}>
            {o.label}
          </button>
        ))}
      </div>
    </>
  );
}

/* A large, readable copy of a card beside the one under the pointer — to the
   right when there's room, else the left, else centred (phones). Touch opens
   it with 🔍 and dismisses it with a tap anywhere. The copy itself ignores
   the pointer: if it ever overlapped the hovered card it would otherwise
   steal the hover, close, and reopen in a flicker. */
export function ZoomPreview({ zoom, onDismiss }: { zoom: Zoom; onDismiss: () => void }) {
  const W = Math.min(300, window.innerWidth - 24);
  const H = Math.round(W * 1.4);
  const a = zoom.anchor;
  const left =
    a.right + 12 + W <= window.innerWidth
      ? a.right + 12
      : a.left - 12 - W >= 0
        ? a.left - 12 - W
        : Math.round((window.innerWidth - W) / 2);
  const top = Math.max(8, Math.min(a.top + a.height / 2 - H / 2, window.innerHeight - H - 8));
  // The face that's up.
  const back = useVerifiedBack(zoom.card.name, zoom.card.imageUri);
  const src = zoom.card.flipped && back ? back : zoom.card.imageUri || undefined;
  return (
    <>
      <div className="pt-zoom-backdrop" onClick={onDismiss} style={{ position: "fixed", inset: 0, zIndex: 91 }} />
      <div style={{ position: "fixed", top, left, width: W, height: H, zIndex: 92, pointerEvents: "none", animation: "sp-fade .12s ease", borderRadius: "4.8%/3.5%", overflow: "hidden", boxShadow: "0 24px 60px -18px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.14)", background: "#000" }}>
        <CardArt name={zoom.card.name} src={src} prefer="src" version="normal" loading="eager" radius={0} style={{ position: "absolute", inset: 0 }} />
      </div>
    </>
  );
}

export function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="pt-panel-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pt-panel" role="dialog" aria-label={title}>
        <div className="pt-panel-head">
          <span className="id-display" style={{ fontSize: 20, color: "#fff" }}>
            {title}
          </span>
          <button type="button" className="pt-btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="pt-panel-body">{children}</div>
      </div>
    </div>
  );
}
