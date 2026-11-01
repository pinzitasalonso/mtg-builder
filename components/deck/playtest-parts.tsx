"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Crown, Ellipsis, RefreshCw, Smartphone, X, ZoomIn } from "lucide-react";
import { CardArt } from "@/components/mtg";
import { backImageOf, useVerifiedBack } from "@/components/useCardFlip";
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
  /** Opened by a mouse resting on the card (it closes when the mouse
      leaves), not by 🔍 (it closes with a tap anywhere, on a backdrop). */
  hover?: boolean;
}

/* Only a device that can really hover gets previews on hover. A phone fires
   "mouse" pointer events of its own after a tap, at the spot tapped: when the
   next card in hand slid under that spot its preview opened, its backdrop
   came up under the "mouse", the card lost it, the preview closed, and round
   again until you tapped somewhere else. */
const canHover = () => typeof window !== "undefined" && window.matchMedia("(any-hover: hover) and (any-pointer: fine)").matches;

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
  stack,
}: {
  card: PlayCard;
  zone: Zone;
  onPrimary: (card: PlayCard, zone: Zone, anchor: DOMRect) => void;
  onMenu: (anchor: DOMRect, card: PlayCard, zone: Zone) => void;
  /** Open the preview; null closes it. hover: the mouse arrived (or left:
      then only a preview it opened closes). */
  onZoom: (card: PlayCard | null, zone?: Zone, anchor?: DOMRect, hover?: boolean) => void;
  onTurn: (card: PlayCard) => void;
  /** Practice games: picked (as an attacker, or a blocker being placed). */
  selected?: boolean;
  /** Practice games: a word on the card ("Attacking", "Blocks X"). */
  badge?: string;
  /** Practice games: power/toughness now, when it isn't the printed one. */
  stat?: string | null;
  /** Practice games, lands: on the pile, on top of the card before. "same":
      the same land (a thin strip of the one below shows); "other": a
      different land (a little more shows, to tell them apart). */
  stack?: "same" | "other";
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
  // A card that's already turned over (a modal land the AI played land side
  // up) shows its back at once: waiting for the check would flash the front
  // first. Its back exists, or it couldn't have been turned.
  const backSrc = back ?? (card.flipped ? backImageOf(card.name, card.imageUri) : null);
  const src = shown && backSrc ? backSrc : card.imageUri || undefined;

  return (
    <div
      className="pt-card"
      data-tapped={card.tapped ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-stacked={stack}
      aria-label={card.name}
      onClick={(e) => {
        e.stopPropagation();
        onPrimary(card, zone, e.currentTarget.getBoundingClientRect());
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse" && canHover()) onZoom(card, zone, e.currentTarget.getBoundingClientRect(), true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse" && canHover()) onZoom(null, undefined, undefined, true);
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
  // Open toward the more room, and scroll if even that is short (a phone
  // held sideways is about 340px tall).
  const above = a.top - 14;
  const below = window.innerHeight - a.bottom - 14;
  const up = below < 320 && above > below;
  const left = Math.max(8, Math.min(a.left, window.innerWidth - W - 8));
  const place: React.CSSProperties =
    Math.max(above, below) < 180
      ? { top: 8, maxHeight: window.innerHeight - 16 }
      : up
        ? { bottom: window.innerHeight - a.top + 6, maxHeight: above }
        : { top: a.bottom + 6, maxHeight: below };
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 89 }} />
      <div className="pt-menu" style={{ position: "fixed", left, width: W, zIndex: 90, overflowY: "auto", ...place }} role="menu">
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
  // As big as fits: a phone held sideways is short, not narrow.
  const W = Math.round(Math.min(300, window.innerWidth - 24, (window.innerHeight - 16) / 1.4));
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
  // The face that's up, at once: the back of a turned card without waiting
  // for its check, which would show the front for a moment (a flash).
  const src = zoom.card.flipped ? (back ?? backImageOf(zoom.card.name, zoom.card.imageUri) ?? zoom.card.imageUri) || undefined : zoom.card.imageUri || undefined;
  return (
    <>
      {/* A preview opened by 🔍 closes with a tap anywhere; one opened by the
          mouse closes when it leaves the card, and needs no backdrop (which
          would take the mouse off the card and close it at once). */}
      {!zoom.hover && <div className="pt-zoom-backdrop" onClick={onDismiss} style={{ position: "fixed", inset: 0, zIndex: 91 }} />}
      <div style={{ position: "fixed", top, left, width: W, height: H, zIndex: 92, pointerEvents: "none", animation: "sp-fade .12s ease", borderRadius: "4.8%/3.5%", overflow: "hidden", boxShadow: "0 24px 60px -18px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.14)", background: "#000" }}>
        <CardArt key={src} name={zoom.card.name} src={src} prefer="src" version="normal" loading="eager" radius={0} style={{ position: "absolute", inset: 0 }} />
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

/* Phones play the table sideways. A web page can't turn an iPhone's screen,
   so held upright the table asks for it (CSS shows this only on a phone in
   portrait); Android can, from fullscreen, which useLandscapeLock asks for. */
export function RotateHint({ onClose }: { onClose: () => void }) {
  return (
    <div className="pt-rotate" role="alert">
      <Smartphone size={44} strokeWidth={1.75} className="pt-rotate-icon" aria-hidden />
      <div className="id-display" style={{ fontSize: 24, color: "#fff" }}>
        Turn your phone sideways
      </div>
      <p>The table is laid out for landscape. If the screen doesn&apos;t turn, check that rotation lock is off.</p>
      <button type="button" className="pt-btn" onClick={onClose}>
        <X size={14} strokeWidth={2.5} /> Close
      </button>
    </div>
  );
}

/** On a phone, open the playtest fullscreen and locked to landscape where
    the browser allows it (Android Chrome; never an iPhone). It runs as the
    table opens, so it still counts as the tap that opened it. Undone on
    close. */
export function useLandscapeLock() {
  useEffect(() => {
    const phone = window.matchMedia("(pointer: coarse)").matches && Math.min(window.screen.width, window.screen.height) < 500;
    const el = document.documentElement;
    const orientation = window.screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
    if (!phone || !document.fullscreenEnabled || typeof el.requestFullscreen !== "function" || typeof orientation?.lock !== "function") return;
    let live = true;
    let locked = false;
    el.requestFullscreen({ navigationUI: "hide" })
      .then(() => (live ? orientation.lock!("landscape") : undefined))
      .then(() => void (locked = live))
      .catch(() => {});
    return () => {
      live = false;
      try {
        if (locked) orientation.unlock();
      } catch {
        /* not locked after all */
      }
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
}

/* On a phone held sideways the hand is a strip of card tops along the
   bottom. A tap raises it over the board (the cover takes that first tap,
   so it can't play a card you haven't seen), and it drops again after a
   play or with Hide. Both buttons are hidden everywhere else. */
export function HandToggle({ up, count, onToggle }: { up: boolean; count: number; onToggle: (up: boolean) => void }) {
  return up ? (
    <button type="button" className="pt-btn pt-hand-handle" onClick={() => onToggle(false)}>
      <ChevronDown size={14} strokeWidth={2.5} /> Hide hand
    </button>
  ) : (
    <button type="button" className="pt-hand-cover" aria-label={`Show your hand (${count} card${count === 1 ? "" : "s"})`} onClick={() => onToggle(true)} />
  );
}
