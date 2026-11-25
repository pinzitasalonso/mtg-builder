"use client";

/* Card names you can point at. Inside a <CardHoverProvider>, a <CardName>
   shows the card's picture beside it on hover (a tap on a touch screen, or
   keyboard focus), <LinkedText> finds the deck's card names in a run of plain
   text and makes each one a <CardName>, and <CardThumb> is the small picture
   of a card that does the same.

   The Stats pane wraps itself in the provider, so the primer, the scan's
   write-up, the combos, the Score's working and the roles all behave alike.
   Outside a provider (a game review, say) a <CardName> is just the name. */

import { createContext, useContext, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CardArt } from "@/components/mtg";

interface Preview {
  name: string;
  src: string | null;
  rect: DOMRect;
}

interface Hover {
  /** The stored scan of a card of the deck, by its lower-cased name. */
  image: (name: string) => string | null;
  /** Finds the deck's card names in prose. Null when the deck has none. */
  matcher: RegExp | null;
  show: (p: Preview | null) => void;
}

const HoverContext = createContext<Hover | null>(null);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function CardHoverProvider({ cards, children }: { cards: { name: string; imageUri?: string | null }[]; children: ReactNode }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const value = useMemo<Hover>(() => {
    const images = new Map<string, string>();
    const names = new Set<string>();
    for (const c of cards) {
      // A two-faced card is "Front // Back": prose usually names the front.
      for (const n of [c.name, c.name.split(" // ")[0]!]) {
        names.add(n);
        if (c.imageUri && !images.has(n.toLowerCase())) images.set(n.toLowerCase(), c.imageUri);
      }
    }
    // Longest first, so "Sol Ring" never wins over a longer name that holds it.
    const list = [...names].filter((n) => n.length > 2).sort((a, b) => b.length - a.length);
    return {
      image: (name) => images.get(name.toLowerCase()) ?? null,
      matcher: list.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "gu") : null,
      show: setPreview,
    };
  }, [cards]);
  return (
    <HoverContext.Provider value={value}>
      {children}
      {preview && <FloatingCard preview={preview} onDismiss={() => setPreview(null)} />}
    </HoverContext.Provider>
  );
}

/** A card's name. `strong` is for a name the writer marked as a card (the
    primer's [[links]]); found names are quieter, so a paragraph that names
    six cards still reads as a paragraph. */
export function CardName({ name, strong, children }: { name: string; strong?: boolean; children?: ReactNode }) {
  const hover = useContext(HoverContext);
  if (!hover) {
    return (
      <span className="card-ref" data-strong={strong || undefined} data-plain>
        {children ?? name}
      </span>
    );
  }
  const from = (el: Element) => hover.show({ name, src: hover.image(name), rect: el.getBoundingClientRect() });
  return (
    <span
      className="card-ref"
      data-strong={strong || undefined}
      tabIndex={0}
      onPointerEnter={(e) => e.pointerType === "mouse" && from(e.currentTarget)}
      onPointerLeave={(e) => e.pointerType === "mouse" && hover.show(null)}
      // A tap, where there is no hover. (The backdrop behind the card closes it.)
      onClick={(e) => from(e.currentTarget)}
      onFocus={(e) => from(e.currentTarget)}
      onBlur={() => hover.show(null)}
    >
      {children ?? name}
    </span>
  );
}

/** Plain text, with every card of the deck it names made a <CardName>. */
export function LinkedText({ text }: { text: string }) {
  const hover = useContext(HoverContext);
  const parts = useMemo(() => {
    if (!hover?.matcher) return [text];
    const out: (string | { name: string })[] = [];
    let at = 0;
    for (const m of text.matchAll(hover.matcher)) {
      if (m.index > at) out.push(text.slice(at, m.index));
      out.push({ name: m[0] });
      at = m.index + m[0].length;
    }
    if (at < text.length) out.push(text.slice(at));
    return out;
  }, [text, hover?.matcher]);
  return <>{parts.map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : <CardName key={i} name={p.name} />))}</>;
}

/** A small picture of a card: its stored scan, cut down to the small size.
    Pointing at it shows the card large, as a name does. */
export function CardThumb({ name, width = 62, style }: { name: string; width?: number; style?: CSSProperties }) {
  const hover = useContext(HoverContext);
  const src = hover?.image(name) ?? null;
  const from = (el: Element) => hover?.show({ name, src, rect: el.getBoundingClientRect() });
  return (
    <span
      className="card-thumb"
      title={name}
      tabIndex={hover ? 0 : undefined}
      onPointerEnter={(e) => e.pointerType === "mouse" && from(e.currentTarget)}
      onPointerLeave={(e) => e.pointerType === "mouse" && hover?.show(null)}
      onClick={(e) => from(e.currentTarget)}
      onFocus={(e) => from(e.currentTarget)}
      onBlur={() => hover?.show(null)}
      style={{ width, ...style }}
    >
      <CardArt name={name} src={src ?? undefined} version="small" radius={Math.round(width * 0.05)} loading="lazy" style={{ width: "100%", aspectRatio: "5 / 7" }} />
    </span>
  );
}

/* The card, large, beside what was pointed at: above it when there is room,
   below otherwise, kept inside the window. Drawn at the end of <body> so no
   panel's backdrop-filter can trap it behind text. On a touch screen a tap
   anywhere closes it. */
function FloatingCard({ preview, onDismiss }: { preview: Preview; onDismiss: () => void }) {
  if (typeof document === "undefined") return null;
  const W = 240;
  const H = Math.round(W * 1.4) + 12;
  const { rect } = preview;
  const above = rect.top > H + 16;
  const top = above ? rect.top - H - 10 : Math.min(rect.bottom + 10, window.innerHeight - H - 8);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - W - 8));
  return createPortal(
    <>
      <div className="cardlink-preview-backdrop" onClick={onDismiss} style={{ position: "fixed", inset: 0, zIndex: 79 }} />
      <div onClick={onDismiss} style={{ position: "fixed", top: Math.max(8, top), left, width: W, zIndex: 80, pointerEvents: "none", animation: "sp-fade .12s ease" }}>
        <div className="cc-black" style={{ padding: 6 }}>
          <CardArt key={preview.name} name={preview.name} src={preview.src ?? undefined} prefer="src" version="normal" loading="eager" radius={8} style={{ aspectRatio: "5 / 7" }} />
        </div>
      </div>
    </>,
    document.body
  );
}
