// Shared styles & small primitives for the deck screen and its modals.

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
};

export const ghostBtn: React.CSSProperties = {
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
  background: "var(--t1)",
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

// Flat white modal scaffold shared by the deck dialogs.
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
      style={{ position: "fixed", inset: 0, background: "rgba(21,21,26,.32)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex, animation: "sp-fade .15s ease" }}
      onClick={(e) => e.target === e.currentTarget && onDismiss()}
    >
      <div
        style={{
          background: "var(--bg)",
          borderRadius: 20,
          boxShadow: "0 30px 70px -20px rgba(21,21,26,.4)",
          width: "100%",
          maxWidth,
          maxHeight: "88vh",
          display: "flex",
          animation: "sp-pop .18s ease",
        }}
      >
        <div style={{ padding: "24px 26px 26px", overflowY: "auto", width: "100%" }}>{children}</div>
      </div>
    </div>
  );
}
