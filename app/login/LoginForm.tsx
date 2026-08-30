"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthShell, { errorBox, footNote, goldBtn, h1, input, lede, linkBtn, noticeBox } from "@/components/AuthShell";
import { track } from "@/lib/track";

// The app's own table, not a deck page's ground. `getIdentityTheme(null)`
// returns the indigo felt, which stopped being the table when the home was
// redrawn — it left sign-in as the last indigo screen in the product.

type Mode = "login" | "signup";

export default function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError(params));
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

  function continueWithGoogle() {
    setBusy(true);
    // A full navigation, not fetch: the OAuth flow has to happen in the
    // browser's address bar, and the callback signs us in with a cookie.
    window.location.href = "/api/auth/oauth/google/start";
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setShowResend(false);
  }

  return (
    <AuthShell>
      {pendingEmail ? (
        <>
      <h1 style={h1}>Check your inbox</h1>
      <p style={lede}>
        We sent a verification link to <strong style={{ color: "var(--t1)" }}>{pendingEmail}</strong>.
        Open it to finish creating your account — the link signs you straight in.
      </p>
      {error && <div style={errorBox}>{error}</div>}
      {resent && !error && (
        <div style={noticeBox}>
          Sent — give it a minute, and peek in spam.
        </div>
          )}
          <p style={footNote}>
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

          {googleEnabled && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={continueWithGoogle}
                style={{ ...providerBtn, opacity: busy ? 0.6 : 1 }}
              >
                <GoogleMark />
                Continue with Google
              </button>
              <div style={divider}>
                <span style={dividerRule} />
                <span style={dividerWord}>or</span>
                <span style={dividerRule} />
              </div>
            </>
          )}

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

          {mode === "login" && (
            <p style={footNote}>
              <a href="/reset" style={linkBtn}>
                Forgot password?
              </a>
            </p>
          )}

          <p style={footNote}>
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
    </AuthShell>
  );
}

// Google's four-colour mark. Required by their branding guidelines whenever
// the button says "Continue with Google", and it has to keep its own colours
// on any background — so these hexes are deliberately not theme tokens.
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.500h7.1c4.2-3.8 6.6-9.5 6.6-16.1z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.5 46 24 46z" />
      <path fill="#FBBC05" d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.2-2.9.7-4.2v-5.7H4.5C3 17.1 2.2 20.4 2.2 24s.8 6.9 2.3 9.9l7.3-5.7z" />
      <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.5 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9 12.2-9z" />
    </svg>
  );
}

// The slugs the OAuth callback and the verify route redirect back with.
function initialError(params: URLSearchParams): string | null {
  if (params.get("verify") === "invalid") {
    return "That verification link is invalid or has expired — sign in to get a fresh one.";
  }
  switch (params.get("oauth")) {
    case "cancelled":
      return null; // Backing out of the Google screen is not an error.
    case "expired":
      return "That sign-in took too long. Try again.";
    case "unconfigured":
      return "Google sign-in isn't set up on this server yet.";
    case "throttled":
      return "Too many attempts — try again in a few minutes.";
    case "email-unverified-conflict":
      return "An account already uses that email address. Sign in with your password first.";
    case "email-required":
      return "That account didn't share an email address, so there's nothing to sign in to.";
    case "failed":
      return "That sign-in didn't complete. Try again.";
    default:
      return null;
  }
}

const providerBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  width: "100%",
  padding: "12px 20px",
  borderRadius: 999,
  border: "1px solid var(--line)",
  background: "var(--bg2)",
  color: "var(--t1)",
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 14.5,
};

const divider: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  margin: "14px 0",
};

const dividerRule: React.CSSProperties = { flex: 1, height: 1, background: "var(--line)" };

const dividerWord: React.CSSProperties = { fontSize: 12.5, color: "var(--t2)" };
