"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Sparkles, X } from "lucide-react";

/* The assistant's frame: a header (title, a line under it, New, close) and
   the chat filling the rest, its composer docked at the bottom.

   On a wide screen it's a panel down the right, and the page moves over to
   make room, so the deck stays in view — and changes as the chat changes it.
   On a phone or a narrow window it takes the whole screen. */

// Wide enough for a deck page and a chat side by side.
const SIDE_QUERY = "(min-width: 1100px)";
const PANEL_W = "min(460px, 40vw)";

function useSidePanel(): boolean {
  const [side, setSide] = useState(() => typeof window !== "undefined" && window.matchMedia(SIDE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(SIDE_QUERY);
    const on = () => setSide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return side;
}
export default function AssistantScreen({
  title,
  subtitle,
  onClose,
  onNew,
  newDisabled = false,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  /** Start a new conversation; omitted when there's nothing to clear. */
  onNew?: () => void;
  newDisabled?: boolean;
  children: React.ReactNode;
}) {
  const side = useSidePanel();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A card's deck menu is open: Esc closes that first (it handles its own).
      if (document.querySelector('[role="menu"]')) return;
      // Beside the page, Esc belongs to whatever has focus: the page's own
      // dialogs close on it too, and shouldn't take the chat with them.
      if (side && !panelRef.current?.contains(document.activeElement)) return;
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [side]);

  // Side panel: move the page over rather than cover it.
  useEffect(() => {
    if (!side) return;
    const b = document.body.style;
    const prev = { paddingRight: b.paddingRight, transition: b.transition };
    b.transition = "padding-right .18s ease";
    b.paddingRight = PANEL_W;
    return () => {
      b.paddingRight = prev.paddingRight;
      setTimeout(() => (b.transition = prev.transition), 200);
    };
  }, [side]);
  // Pin the page behind. `overflow: hidden` alone doesn't stop iOS Safari
  // scrolling it when the keyboard opens, and the page then showed between
  // the composer and the keyboard. Fixing the body in place (at its scroll
  // position, restored on close) leaves nothing to scroll.
  useEffect(() => {
    if (side) return;
    const y = window.scrollY;
    const b = document.body.style;
    const prev = { overflow: b.overflow, position: b.position, top: b.top, width: b.width };
    b.overflow = "hidden";
    b.position = "fixed";
    b.top = `-${y}px`;
    b.width = "100%";
    return () => {
      Object.assign(b, prev);
      window.scrollTo(0, y);
    };
  }, [side]);

  // Fit the part of the screen you can see. With the keyboard up, iOS shrinks
  // the visual viewport and may shift it; sized to the layout viewport, the
  // header went off the top. Tracking visualViewport keeps the header at the
  // top and the composer right above the keyboard.
  const [vv, setVv] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const update = () => setVv({ top: v.offsetTop, height: v.height });
    update();
    v.addEventListener("resize", update);
    v.addEventListener("scroll", update);
    return () => {
      v.removeEventListener("resize", update);
      v.removeEventListener("scroll", update);
    };
  }, []);

  // The visible area is well short of the window: the keyboard is up.
  const keyboardUp = vv !== null && typeof window !== "undefined" && vv.height < window.innerHeight * 0.8;

  return (
    <>
    {/* Full screen: solid ground under everything, reaching below the screen.
        iOS's keyboard is see-through, and nothing of the page may show in it. */}
    {!side && <div aria-hidden style={{ position: "fixed", left: 0, right: 0, top: 0, height: "200lvh", zIndex: 67, background: "var(--bg)" }} />}
    <div
      ref={panelRef}
      role="dialog"
      // Beside the page, the page stays usable: not modal.
      aria-modal={side ? undefined : true}
      aria-labelledby="assistant-title"
      style={{
        position: "fixed",
        zIndex: 68,
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        ...(side
          ? {
              top: 0,
              bottom: 0,
              right: 0,
              width: PANEL_W,
              borderLeft: "1px solid var(--line)",
              boxShadow: "-18px 0 40px -24px rgba(0,0,0,.35)",
              animation: "sp-panel-in .18s ease",
            }
          : {
              left: 0,
              right: 0,
              ...(vv ? { top: vv.top, height: vv.height } : { top: 0, bottom: 0 }),
              animation: "sp-fade .15s ease",
            }),
      }}
    >
      <div style={{ borderBottom: "1px solid var(--line)", padding: side ? "12px 18px" : "12px clamp(16px, 4vw, 32px)" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", alignItems: "center", gap: 10 }}>
          <Sparkles size={20} strokeWidth={2} color="var(--gold)" style={{ flex: "none" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="assistant-title" style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: side ? 18 : "clamp(17px, 4.6vw, 22px)", fontWeight: 700, color: "var(--frame-ink, var(--text))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {title}
            </h2>
            <div style={{ fontSize: 13, color: "var(--t3, var(--text-muted))", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</div>
          </div>
          {onNew && (
            <button type="button" onClick={onNew} disabled={newDisabled} className="id-ghost" style={{ padding: "7px 12px", fontSize: 13, flex: "none", opacity: newDisabled ? 0.5 : 1 }} title="Start a new conversation">
              <RotateCcw size={14} strokeWidth={2.25} /> New
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 36, height: 36, flex: "none", borderRadius: 999, border: "none", background: "var(--bg3)", color: "var(--t2, var(--text-muted))", display: "grid", placeItems: "center", cursor: "pointer" }}>
            <X size={18} strokeWidth={2.25} />
          </button>
        </div>
      </div>
      {/* The home-indicator gap only matters without the keyboard; with it up,
          the composer sits right on top of the keys. */}
      <div style={{ flex: 1, minHeight: 0, padding: side ? "14px 18px 16px" : `clamp(12px, 3vw, 24px) clamp(16px, 4vw, 32px) ${keyboardUp ? "10px" : "max(16px, env(safe-area-inset-bottom))"}` }}>
        <div style={{ maxWidth: 860, height: "100%", margin: "0 auto" }}>{children}</div>
      </div>
    </div>
    </>
  );
}
