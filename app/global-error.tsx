"use client";

// The root layout itself threw. This replaces it, so it brings its own
// document and its own styles: globals.css isn't loaded here.

import { useEffect } from "react";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box", background: "#0c0c0c", color: "#ffffff", fontFamily: "system-ui, sans-serif" }}>
        <title>Something went wrong · Spellpool</title>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Something went wrong</h1>
          <p style={{ color: "#868686", marginTop: 8 }}>Spellpool hit an error. Your decks and collection are safe.</p>
          <button
            onClick={() => retry()}
            style={{ marginTop: 18, padding: "11px 24px", borderRadius: 999, border: "none", background: "#fdf26f", color: "#181228", fontWeight: 600, fontSize: 16, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
