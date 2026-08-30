"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthShell, {
  errorBox,
  footNote,
  goldBtn,
  h1,
  input,
  lede,
  linkBtn,
  noticeBox,
} from "@/components/AuthShell";

// Both halves of the reset flow live here: no ?token= is the "email me a
// link" form, a token is the "choose a new password" form. Keeping them
// together is what stopped /login growing a third and fourth mode.
export default function ResetPage() {
  // useSearchParams needs a Suspense boundary on a prerendered page.
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  );
}

function ResetInner() {
  const token = useSearchParams().get("token");
  return token ? <ChooseNew token={token} /> : <AskForLink />;
}

function AskForLink() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      // The server answers the same way whether or not the address exists, so
      // there is nothing here worth telling the user apart from "sent".
    }
    setBusy(false);
    setSent(true);
  }

  return (
    <AuthShell>
      {sent ? (
        <>
          <h1 style={h1}>Check your inbox</h1>
          <p style={lede}>
            If an account uses <strong style={{ color: "var(--t1)" }}>{email.trim()}</strong>, a
            reset link is on its way. It expires in an hour and works once.
          </p>
          <div style={noticeBox}>Nothing yet? Give it a minute, and peek in spam.</div>
          <p style={footNote}>
            <a href="/login" style={linkBtn}>
              Back to sign in
            </a>
          </p>
        </>
      ) : (
        <>
          <h1 style={h1}>Reset your password</h1>
          <p style={lede}>
            Tell us the address on your account and we&apos;ll send a link to choose a new
            password.
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
            <button type="submit" disabled={busy} style={{ ...goldBtn, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Sending…" : "Send the link"}
            </button>
          </form>
          <p style={footNote}>
            <a href="/login" style={linkBtn}>
              Back to sign in
            </a>
          </p>
        </>
      )}
    </AuthShell>
  );
}

function ChooseNew({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "That didn't work. Ask for a fresh link.");
        setBusy(false);
        return;
      }
      // Confirm signs you in, so there is nowhere to go but the decks.
      router.push("/");
      router.refresh();
    } catch {
      setError("Couldn't reach spellpool.com. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 style={h1}>Choose a new password</h1>
      <p style={lede}>
        Every other signed-in device gets signed out, so anyone who knew the old password
        loses their way in.
      </p>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          className="cc-paper"
          type="password"
          placeholder="New password (8+ characters)"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoFocus
          style={input}
        />
        {error && <div style={errorBox}>{error}</div>}
        <button type="submit" disabled={busy} style={{ ...goldBtn, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Setting…" : "Set password and sign in"}
        </button>
      </form>
      <p style={footNote}>
        <a href="/reset" style={linkBtn}>
          Ask for a fresh link
        </a>
      </p>
    </AuthShell>
  );
}
