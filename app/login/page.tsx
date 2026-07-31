"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import { LIGHT_VARS } from "@/lib/identity-theme";
import { track } from "@/lib/track";

// The app's own table, not a deck page's ground. `getIdentityTheme(null)`
// returns the indigo felt, which stopped being the table when the home was
// redrawn — it left sign-in as the last indigo screen in the product.

type Mode = "login" | "signup";

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary on a prerendered page.
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("verify") === "invalid"
      ? "That verification link is invalid or has expired — sign in to get a fresh one."
      : null
  );
  // Non-null once we're waiting on an inbox: the address we mailed.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [showResend, setShowResend] = useState(false);

  useEffect(() => {
    track("visit");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setShowResend(false);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        if (body?.verifyRequired) {
          setPendingEmail(body.email);
          setResent(false);
          if (body.emailSent === false) {
            setError("Sending the email failed — use “Send it again” below.");
          }
          return;
        }
        router.push("/");
        router.refresh();
        return;
      }
      setError(body?.error ?? "Something went wrong — try again.");
      if (body?.unverified) setShowResend(true);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resend(to: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/auth/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: to }),
      });
      setResent(true);
      setPendingEmail(to);
      setShowResend(false);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setShowResend(false);
  }

  return (
    <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 16px", gap: 26, background: "var(--bg)", color: "var(--t1)", minHeight: "100dvh" }}>
      <Logo />
      <div className="cc-black" style={{ ...LIGHT_VARS, color: "var(--t1)", padding: 9, width: "100%", maxWidth: 400, animation: "sp-pop .18s ease" }}>
        <div className="cc-brown" style={{ padding: "18px 18px 20px" }}>
          {pendingEmail ? (
            <>
              <h1 style={h1}>Check your inbox</h1>
              <p style={lede}>
                We sent a verification link to <strong style={{ color: "var(--t1)" }}>{pendingEmail}</strong>.
                Open it to finish creating your account — the link signs you straight in.
              </p>
              {error && <div style={errorBox}>{error}</div>}
              {resent && !error && (
                <div style={{ ...errorBox, background: "rgba(13,138,95,.08)", boxShadow: "inset 0 0 0 1px rgba(13,138,95,.3)", color: "#0d8a5f" }}>
                  Sent — give it a minute, and peek in spam.
                </div>
              )}
              <p style={{ margin: "16px 0 0", fontSize: 13.5, color: "var(--t2)", textAlign: "center" }}>
                Nothing arrived?{" "}
                <button type="button" disabled={busy} onClick={() => resend(pendingEmail)} style={linkBtn}>
                  Send it again
                </button>
                {" · "}
                <button type="button" onClick={() => { setPendingEmail(null); switchMode("login"); }} style={linkBtn}>
                  Back to sign in
                </button>
              </p>
            </>
          ) : (
            <>
              <h1 style={h1}>{mode === "login" ? "Welcome back" : "Join the guild"}</h1>
              <p style={lede}>
                {mode === "login"
                  ? "Sign in to open your spellbook."
                  : "Create an account to keep your pools safe."}
              </p>

              <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input
                  className="cc-paper"
                  type="email"
                  placeholder="Email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  style={input}
                />
                <input
                  className="cc-paper"
                  type="password"
                  placeholder={mode === "signup" ? "Password (8+ characters)" : "Password"}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={mode === "signup" ? 8 : undefined}
                  style={input}
                />

                {error && (
                  <div style={errorBox}>
                    {error}
                    {showResend && (
                      <>
                        {" "}
                        <button type="button" disabled={busy} onClick={() => resend(email.trim())} style={linkBtn}>
                          Resend the email
                        </button>
                      </>
                    )}
                  </div>
                )}

                <button type="submit" disabled={busy} style={{ ...goldBtn, opacity: busy ? 0.6 : 1, marginTop: 2 }}>
                  {busy
                    ? mode === "login" ? "Unsealing…" : "Scribing…"
                    : mode === "login" ? "Sign in" : "Create account"}
                </button>
              </form>

              <p style={{ margin: "16px 0 0", fontSize: 13.5, color: "var(--t2)", textAlign: "center" }}>
                {mode === "login" ? (
                  <>
                    New here?{" "}
                    <button type="button" onClick={() => switchMode("signup")} style={linkBtn}>
                      Create an account
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button type="button" onClick={() => switchMode("login")} style={linkBtn}>
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

const h1: React.CSSProperties = {
  margin: "0 0 4px",
  fontFamily: "var(--font-display)",
  fontSize: 26,
  fontWeight: 700,
  letterSpacing: "-.02em",
  color: "var(--t1)",
};

const lede: React.CSSProperties = {
  margin: "0 0 16px",
  fontSize: 14.5,
  color: "var(--t2)",
  lineHeight: 1.5,
};

const errorBox: React.CSSProperties = {
  color: "var(--danger)",
  fontSize: 13.5,
  padding: "10px 14px",
  background: "rgba(194,64,42,.07)",
  borderRadius: 10,
  boxShadow: "inset 0 0 0 1px rgba(194,64,42,.25)",
};

const input: React.CSSProperties = {
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

const goldBtn: React.CSSProperties = {
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

const linkBtn: React.CSSProperties = {
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
