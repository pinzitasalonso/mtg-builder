// Shared styles & small primitives for the deck screen and its modals.

export const paperInput: React.CSSProperties = {
  flex: 1,
  padding: "12px 15px",
  border: "none",
  outline: "none",
  fontFamily: "var(--font-body)",
  fontSize: 16,
  color: "var(--ink)",
  borderRadius: 6,
  width: "100%",
  minWidth: 0,
};

export const actionBtn: React.CSSProperties = {
  background: "var(--app-bg2)",
  border: "none",
  boxShadow: "inset 0 0 0 1px rgba(200,155,65,.3)",
  borderRadius: 9,
  color: "var(--text)",
  padding: "13px 16px",
  cursor: "pointer",
  fontFamily: "var(--font-display)",
  fontSize: 16,
  fontWeight: 700,
  whiteSpace: "nowrap",
};

export const toolBtn: React.CSSProperties = {
  background: "rgba(0,0,0,.22)",
  border: "none",
  boxShadow: "inset 0 0 0 1px rgba(236,225,198,.22)",
  borderRadius: 8,
  color: "var(--frame-ink)",
  padding: "11px 12px",
  cursor: "pointer",
  fontFamily: "var(--font-display)",
  fontSize: 15,
  fontWeight: 600,
  textAlign: "center",
};

export const ghostBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  boxShadow: "inset 0 0 0 1px rgba(236,225,198,.3)",
  borderRadius: 7,
  color: "var(--frame-ink)",
  padding: "9px 18px",
  cursor: "pointer",
  fontFamily: "var(--font-display)",
  fontSize: 15,
  fontWeight: 600,
};

export const goldBtn: React.CSSProperties = {
  background: "var(--gold)",
  border: "none",
  borderRadius: 7,
  color: "var(--accent-ink)",
  padding: "9px 20px",
  cursor: "pointer",
  fontFamily: "var(--font-display)",
  fontWeight: 700,
  fontSize: 15,
};

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span className="label-sc" style={{ fontSize: 11.5, color: "rgba(236,225,198,.75)", letterSpacing: ".1em" }}>{label}</span>
      {children}
    </label>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "#f4dccd", fontSize: 13.5, fontStyle: "italic", padding: "10px 14px", background: "rgba(207,125,94,.16)", borderRadius: 8, boxShadow: "inset 0 0 0 1px rgba(207,125,94,.4)" }}>
      {children}
    </div>
  );
}

// Dark frame-in-frame modal scaffold shared by the deck dialogs.
export function ModalShell({
  onDismiss,
  maxWidth,
  zIndex = 72,
  children,
}: {
  onDismiss: () => void;
  maxWidth: number;
  zIndex?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(8,6,4,0.74)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex, animation: "sp-fade .15s ease" }}
      onClick={(e) => e.target === e.currentTarget && onDismiss()}
    >
      <div className="cc-black" style={{ padding: 9, width: "100%", maxWidth, maxHeight: "88vh", display: "flex", animation: "sp-pop .18s ease" }}>
        <div className="cc-brown" style={{ padding: "16px 18px 18px", overflowY: "auto", width: "100%" }}>{children}</div>
      </div>
    </div>
  );
}
