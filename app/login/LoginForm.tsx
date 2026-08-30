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
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
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
