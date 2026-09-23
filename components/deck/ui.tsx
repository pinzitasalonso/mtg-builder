"use client";

// Shared styles & small primitives for the deck screen and its modals.

import { useEffect, useRef } from "react";

export const paperInput: React.CSSProperties = {
  flex: 1,
  padding: "12px 15px",
  border: "1px solid var(--line)",
  background: "var(--bg2)",
  outline: "none",
  fontFamily: "var(--font-body)",
  fontSize: 16,
  color: "var(--t1)",
  borderRadius: 12,
  width: "100%",
  minWidth: 0,
};

export const actionBtn: React.CSSProperties = {
  background: "var(--bg2)",
  border: "1px solid var(--line)",
  borderRadius: 999,
  color: "var(--t1)",
  padding: "12px 16px",
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
  fontSize: 15,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

export const toolBtn: React.CSSProperties = {
  background: "var(--bg3)",
  border: "none",
  borderRadius: 10,
  color: "var(--t1)",
  padding: "11px 12px",
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
  fontSize: 14,
  fontWeight: 600,
  textAlign: "center",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
};

export const ghostBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  background: "transparent",
  border: "1px solid var(--line)",
  borderRadius: 999,
  color: "var(--t2)",
  padding: "9px 18px",
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
  fontSize: 14,
  fontWeight: 500,
};

export const goldBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  background: "var(--gold)",
  border: "none",
  borderRadius: 999,
  color: "var(--accent-ink)",
  padding: "9px 20px",
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
  fontWeight: 700,
  fontSize: 14.5,
};

export const dangerBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  background: "var(--danger)",
  border: "none",
  borderRadius: 999,
  color: "#fff",
  padding: "9px 20px",
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 14.5,
};

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="mn-label">{label}</span>
      {children}
    </label>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "var(--danger)", fontSize: 13.5, padding: "10px 14px", background: "rgba(194,64,42,.07)", borderRadius: 10, boxShadow: "inset 0 0 0 1px rgba(194,64,42,.25)" }}>
      {children}
    </div>
  );
}

// Open shells, oldest first. Only the top one answers Esc, so a sheet opened
// from a modal closes on its own.
const openShells: symbol[] = [];

// Flat white modal scaffold shared by the deck dialogs. It is a real dialog:
// Esc closes it, the page behind stops scrolling, and focus goes back to
// whatever opened it.
export function ModalShell({
  onDismiss,
  maxWidth,
  zIndex = 72,
  labelledBy,
  children,
}: {
  onDismiss: () => void;
  maxWidth: number;
  zIndex?: number;
  labelledBy?: string;
  children: React.ReactNode;
}) {
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });

  useEffect(() => {
    const id = Symbol("modal");
    openShells.push(id);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      // A child that used Esc itself (a suggestion list) marks it handled.
      if (e.key !== "Escape" || e.defaultPrevented || openShells[openShells.length - 1] !== id) return;
      e.preventDefault();
      dismiss.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      openShells.splice(openShells.indexOf(id), 1);
      if (openShells.length === 0) document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(8,6,11,.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex, animation: "sp-fade .15s ease" }}
      onClick={(e) => e.target === e.currentTarget && onDismiss()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{
          background: "var(--bg)",
          borderRadius: 20,
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,.09), 0 30px 70px -20px rgba(0,0,0,.7)",
          width: "100%",
          maxWidth,
          maxHeight: "88vh",
          display: "flex",
          animation: "sp-pop .18s ease",
        }}
      >
        <div style={{ padding: "24px 26px 26px", overflowY: "auto", overscrollBehavior: "contain", width: "100%" }}>{children}</div>
      </div>
    </div>
  );
}
