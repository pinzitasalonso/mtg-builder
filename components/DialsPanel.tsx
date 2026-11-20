"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DialSummary } from "@/lib/device";

/* The /dial page's working part: pair a dial by the code it shows, rename or
   remove one, and tick the decks each carries. A dial picks changes up at
   its next sync, so nothing here waits for the dial. */

interface MyDeck {
  publicId: string;
  name: string;
  commander: string | null;
}

const CARD: React.CSSProperties = { padding: 20, borderRadius: 16, background: "var(--bg2)", border: "1px solid var(--border)", marginBottom: 16 };
const P: React.CSSProperties = { margin: "0 0 10px", color: "var(--t2)", fontSize: 15, lineHeight: 1.55 };
const BTN: React.CSSProperties = { border: 0, borderRadius: 12, padding: "11px 18px", fontSize: 15, fontWeight: 600, background: "var(--accent)", color: "var(--accent-ink)", cursor: "pointer" };
const QUIET: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 10, padding: "7px 12px", fontSize: 13.5, fontWeight: 600, background: "transparent", color: "var(--t2)", cursor: "pointer" };
const INPUT: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, padding: "11px 14px", fontSize: 16, background: "var(--bg1, transparent)", color: "var(--t1)", minWidth: 0 };

/** "k7m2qf" as the dial shows it: "K7M 2QF". */
const shown = (raw: string) => {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return c.length > 3 ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
};

function seen(iso: string | null): string {
  if (!iso) return "Not seen yet";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 2) return "Seen just now";
  if (mins < 60) return `Seen ${mins} minutes ago`;
  if (mins < 48 * 60) return `Seen ${Math.round(mins / 60)} hours ago`;
  return `Seen ${Math.round(mins / 1440)} days ago`;
}

export default function DialsPanel({ send, code: firstCode }: { send: string | null; code: string | null }) {
  const [dials, setDials] = useState<DialSummary[] | null>(null);
  const [decks, setDecks] = useState<MyDeck[]>([]);
  const [code, setCode] = useState(shown(firstCode ?? ""));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sent = useRef(false);

  const load = useCallback(async () => {
    const [d, k] = await Promise.all([
      fetch("/api/dials").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/decks").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (d?.dials) setDials(d.dials);
    else setError("Couldn't load your dials. Check your connection and reload.");
    if (Array.isArray(k)) setDecks(k.filter((x: MyDeck) => x.publicId));
    return (d?.dials ?? null) as DialSummary[] | null;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (dial: DialSummary, deck: string, on: boolean) => {
      setError("");
      // At once on screen; put back if the server says no.
      setDials((ds) => ds?.map((d) => (d.id === dial.id ? { ...d, decks: on ? [...d.decks.filter((x) => x !== deck), deck] : d.decks.filter((x) => x !== deck) } : d)) ?? ds);
      const res = await fetch(`/api/dials/${dial.id}/decks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck, on }) }).catch(() => null);
      if (!res?.ok) {
        const body = await res?.json().catch(() => null);
        setError(body?.error || "Couldn't change that. Try again.");
        void load();
        return false;
      }
      return true;
    },
    [load]
  );

  // From a deck's "Send to dial": with one dial it's sent at once.
  const sendDeck = decks.find((d) => d.publicId === send) ?? null;
  useEffect(() => {
    if (!send || !dials || sent.current || dials.length !== 1 || !sendDeck) return;
    sent.current = true;
    const only = dials[0]!;
    if (only.decks.includes(send)) setNotice(`${sendDeck.name} is already on ${only.name}.`);
    else void toggle(only, send, true).then((ok) => ok && setNotice(`Sent ${sendDeck.name} to ${only.name}. It shows up at the dial's next sync.`));
  }, [send, dials, sendDeck, toggle]);

  async function pair(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const before = dials?.length ?? 0;
    const res = await fetch("/api/device/pair/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name }) }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      setError(body?.error || "Couldn't reach Spellpool. Try again.");
      return;
    }
    setCode("");
    setName("");
    setNotice("Code accepted. Your dial collects it in a few seconds…");
    // The dial becomes yours when it next asks (every few seconds).
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const now = await load();
      if ((now?.length ?? 0) > before) {
        setNotice("Paired. Now tick the decks it should carry.");
        setBusy(false);
        return;
      }
    }
    setNotice("Code accepted, but the dial hasn't collected it yet. Keep it on Wi-Fi, then reload this page.");
    setBusy(false);
  }

  async function rename(dial: DialSummary) {
    const next = prompt("Name this dial", dial.name)?.trim();
    if (!next || next === dial.name) return;
    const res = await fetch(`/api/dials/${dial.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: next }) }).catch(() => null);
    if (!res?.ok) setError("Couldn't rename it. Try again.");
    void load();
  }

  async function remove(dial: DialSummary) {
    if (!confirm(`Remove “${dial.name}”? It stops syncing and shows its pairing screen. Games it hasn't sent yet are lost.`)) return;
    const res = await fetch(`/api/dials/${dial.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) setError("Couldn't remove it. Try again.");
    void load();
  }

  return (
    <>
      {notice && <p role="status" style={{ ...P, color: "var(--t1)", fontWeight: 600 }}>{notice}</p>}
      {error && <p role="alert" style={{ ...P, color: "var(--danger)" }}>{error}</p>}

      {sendDeck && dials && dials.length > 1 && (
        <section style={CARD} aria-label={`Send ${sendDeck.name} to a dial`}>
          <p style={{ ...P, color: "var(--t1)", fontWeight: 600 }}>Send {sendDeck.name} to…</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {dials.map((d) => (
              <button
                key={d.id}
                type="button"
                style={QUIET}
                disabled={d.decks.includes(sendDeck.publicId)}
                onClick={() => void toggle(d, sendDeck.publicId, true).then((ok) => ok && setNotice(`Sent ${sendDeck.name} to ${d.name}.`))}
              >
                {d.name}
                {d.decks.includes(sendDeck.publicId) ? " ✓" : ""}
              </button>
            ))}
          </div>
        </section>
      )}

      {dials?.map((dial) => (
        <section key={dial.id} style={CARD} aria-label={dial.name}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 21, color: "var(--t1)" }}>{dial.name}</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={QUIET} onClick={() => void rename(dial)}>Rename</button>
              <button type="button" style={{ ...QUIET, color: "var(--danger)" }} onClick={() => void remove(dial)}>Remove</button>
            </div>
          </div>
          <p style={{ ...P, fontSize: 13.5, color: "var(--t3)", margin: "4px 0 14px" }}>
            {seen(dial.lastSeenAt)}
            {dial.firmware ? ` · firmware ${dial.firmware}` : ""}
          </p>
          {decks.length === 0 ? (
            <p style={P}>You have no decks yet. Build one, then send it here.</p>
          ) : (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ ...P, padding: 0, fontSize: 13.5, color: "var(--t3)" }}>
                Decks on this dial ({dial.decks.length})
              </legend>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "6px 14px" }}>
                {decks.map((deck) => (
                  <label key={deck.publicId} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 15, color: "var(--t1)", cursor: "pointer", minWidth: 0 }}>
                    <input
                      type="checkbox"
                      checked={dial.decks.includes(deck.publicId)}
                      onChange={(e) => void toggle(dial, deck.publicId, e.target.checked)}
                      style={{ width: 17, height: 17, accentColor: "var(--accent)", flex: "none" }}
                    />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{deck.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </section>
      ))}

      <section style={CARD} aria-label="Pair a dial">
        <h2 style={{ margin: "0 0 6px", fontSize: 21, color: "var(--t1)" }}>{dials?.length ? "Pair another dial" : "Pair a dial"}</h2>
        <p style={P}>Turn the dial on and join it to your Wi-Fi. It shows a six-character code. Type it here.</p>
        <form onSubmit={pair} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            aria-label="Pairing code"
            value={code}
            onChange={(e) => setCode(shown(e.target.value))}
            placeholder="K7M 2QF"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            style={{ ...INPUT, width: 150, letterSpacing: "0.12em", fontWeight: 700, textAlign: "center" }}
          />
          <input aria-label="A name for the dial (optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" maxLength={40} style={{ ...INPUT, flex: "1 1 160px" }} />
          <button type="submit" style={{ ...BTN, opacity: busy || code.replace(/\s/g, "").length < 6 ? 0.55 : 1 }} disabled={busy || code.replace(/\s/g, "").length < 6}>
            {busy ? "Pairing…" : "Pair"}
          </button>
        </form>
      </section>
    </>
  );
}
