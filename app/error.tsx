"use client";

// A page that threw while rendering. Without this file Next shows its own
// bare "Application error" screen, with no way back.

import { useEffect } from "react";

export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, color: "var(--text)" }}>Something went wrong</h1>
        <p style={{ color: "var(--text-muted)", marginTop: 8 }}>This page hit an error. Your decks and collection are safe.</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18, flexWrap: "wrap" }}>
          <button
            onClick={() => retry()}
            style={{ padding: "11px 24px", borderRadius: 999, border: "none", background: "var(--accent)", color: "var(--accent-ink)", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, cursor: "pointer" }}
          >
            Try again
          </button>
          {/* A plain link, so it loads the home page fresh. */}
          <a
            href="/"
            className="cc-plate"
            style={{ padding: "11px 24px", color: "var(--text)", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, textDecoration: "none" }}
          >
            Home
          </a>
        </div>
      </div>
    </main>
  );
}
