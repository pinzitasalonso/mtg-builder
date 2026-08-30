"use client";

import type React from "react";
import Logo from "@/components/Logo";
import { LIGHT_VARS } from "@/lib/identity-theme";

// The card that /login and /reset both sit in, plus the styles they share.
// Extracted when reset arrived: the alternative was a second copy of the
// panel markup and eight style objects, which would drift the moment either
// page was touched.

export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 16px",
        gap: 26,
        background: "var(--bg)",
        color: "var(--t1)",
        minHeight: "100dvh",
      }}
    >
      <Logo />
      <div
        className="cc-black"
        style={{ ...LIGHT_VARS, color: "var(--t1)", padding: 9, width: "100%", maxWidth: 400, animation: "sp-pop .18s ease" }}
      >
        <div className="cc-brown" style={{ padding: "18px 18px 20px" }}>
          {children}
        </div>
      </div>
    </main>
  );
}

export const h1: React.CSSProperties = {
  margin: "0 0 4px",
  fontFamily: "var(--font-display)",
  fontSize: 26,
  fontWeight: 700,
  letterSpacing: "-.02em",
  color: "var(--t1)",
};

export const lede: React.CSSProperties = {
  margin: "0 0 16px",
  fontSize: 14.5,
  color: "var(--t2)",
  lineHeight: 1.5,
};

export const errorBox: React.CSSProperties = {
  color: "var(--danger)",
  fontSize: 13.5,
  padding: "10px 14px",
  background: "rgba(194,64,42,.07)",
  borderRadius: 10,
  boxShadow: "inset 0 0 0 1px rgba(194,64,42,.25)",
};

export const noticeBox: React.CSSProperties = {
  ...errorBox,
  background: "rgba(13,138,95,.08)",
  boxShadow: "inset 0 0 0 1px rgba(13,138,95,.3)",
  color: "#0d8a5f",
};

export const input: React.CSSProperties = {
  padding: "12px 15px",
  border: "1px solid var(--line)",
  outline: "none",
  borderRadius: 12,
  fontFamily: "var(--font-body)",
  fontSize: 15,
  color: "var(--t1)",
  background: "var(--bg2)",
  width: "100%",
};

export const goldBtn: React.CSSProperties = {
  // The accent, with the ink that flips WITH it. This was `--t1` filled and
  // `#fff` written — white on white once the panel's text token became pure
  // white, and near-white on near-white before that. A primary button is the
  // accent everywhere else in the product; there was no reason for this one to
  // be its own thing.
  background: "var(--accent)",
  border: "none",
  borderRadius: 999,
  color: "var(--accent-ink)",
  padding: "12px 20px",
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 14.5,
};

export const linkBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  color: "var(--gold)",
  fontFamily: "inherit",
  fontSize: "inherit",
  fontWeight: 600,
  textDecoration: "underline",
};

export const footNote: React.CSSProperties = {
  margin: "16px 0 0",
  fontSize: 13.5,
  color: "var(--t2)",
  textAlign: "center",
};
