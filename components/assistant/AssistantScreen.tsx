"use client";

import { useEffect, useRef } from "react";
import { RotateCcw, Sparkles, X } from "lucide-react";

/* The assistant, full screen: a header (title, a line under it, New, close)
   and the chat filling the rest, its composer docked at the bottom. Esc
   closes it and the page behind stops scrolling. */
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
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A card's deck menu is open: Esc closes that first (it handles its own).
      if (e.key === "Escape" && !document.querySelector('[role="menu"]')) closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="assistant-title"
      style={{ position: "fixed", inset: 0, zIndex: 68, background: "var(--bg)", display: "flex", flexDirection: "column", animation: "sp-fade .15s ease" }}
    >
      <div style={{ borderBottom: "1px solid var(--line)", padding: "12px clamp(16px, 4vw, 32px)" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", alignItems: "center", gap: 10 }}>
          <Sparkles size={20} strokeWidth={2} color="var(--gold)" style={{ flex: "none" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="assistant-title" style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "clamp(17px, 4.6vw, 22px)", fontWeight: 700, color: "var(--frame-ink, var(--text))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
      <div style={{ flex: 1, minHeight: 0, padding: "clamp(12px, 3vw, 24px) clamp(16px, 4vw, 32px) max(16px, env(safe-area-inset-bottom))" }}>
        <div style={{ maxWidth: 860, height: "100%", margin: "0 auto" }}>{children}</div>
      </div>
    </div>
  );
}
