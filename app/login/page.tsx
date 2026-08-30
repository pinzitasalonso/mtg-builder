"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthShell, { errorBox, footNote, goldBtn, h1, input, lede, linkBtn, noticeBox } from "@/components/AuthShell";
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
