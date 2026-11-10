// An address that isn't a page. A Server Component with a plain link: Next
// sends this file along with every page.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, color: "var(--text)" }}>Page not found</h1>
        <p style={{ color: "var(--text-muted)", marginTop: 8 }}>There’s nothing at this address.</p>
        <Link
          href="/"
          style={{ display: "inline-block", marginTop: 18, padding: "11px 24px", borderRadius: 999, background: "var(--accent)", color: "var(--accent-ink)", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, textDecoration: "none" }}
        >
          Back to Spellpool
        </Link>
      </div>
    </main>
  );
}
