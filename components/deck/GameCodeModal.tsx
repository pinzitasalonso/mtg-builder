"use client";

import { useCallback, useEffect, useState } from "react";
import { ModalShell, ghostBtn, goldBtn } from "./ui";

/* Mint a "seat me at your table" game code for this deck. A friend types it
   into their Spellpool life tracker's seat editor: this player and deck fill
   the seat (commander art included), and the finished game's result records
   back onto the deck — win or loss. Codes are enterable for 10 minutes;
   minting needs the deck's signed-in owner. */
export default function GameCodeModal({
  deckId,
  commanderImageUri,
  onClose,
}: {
  deckId: string;
  commanderImageUri?: string | null;
  onClose: () => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mint = useCallback(async () => {
    setError(null);
    setCode(null);
    try {
      const res = await fetch("/api/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckPublicId: deckId, commanderImageUri: commanderImageUri ?? null }),
      });
      if (res.status === 401) {
        setError("Game codes live on your account — sign in to mint one.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't mint a code for this deck — only the deck's owner can.");
        return;
      }
      const data = (await res.json()) as { code: string };
      setCode(data.code);
    } catch {
      setError("Couldn't reach the table. Try again.");
    }
  }, [deckId, commanderImageUri]);

  useEffect(() => {
    mint();
  }, [mint]);

  return (
    <ModalShell onDismiss={onClose} maxWidth={460}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 24, color: "var(--w-1)" }}>
          Game code 🎟
        </h2>
        <button onClick={onClose} style={{ ...ghostBtn, padding: "6px 12px" }}>Close</button>
      </div>

      {error ? (
        <div style={{ color: "var(--danger)", fontSize: 14, padding: "12px 14px", background: "rgba(208,86,63,.1)", borderRadius: 10, boxShadow: "inset 0 0 0 1px rgba(208,86,63,.35)", margin: "12px 0" }}>
          {error}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "18px 0 6px" }}>
          {code ? (
            <div className="id-mono" style={{ fontSize: 44, fontWeight: 700, letterSpacing: "0.28em", color: "var(--gold)", textIndent: "0.28em" }}>
              {code}
            </div>
          ) : (
            <div style={{ color: "var(--w-2)", fontSize: 14 }}>Minting your code…</div>
          )}
          {code && (
            <button
              style={{ ...goldBtn, marginTop: 16 }}
              onClick={() => {
                navigator.clipboard?.writeText(code);
                setCopied(true);
              }}
            >
              {copied ? "Copied ✓" : "Copy code"}
            </button>
          )}
        </div>
      )}

      <p style={{ margin: "14px 0 0", fontSize: 13, lineHeight: 1.5, color: "var(--w-3)" }}>
        A friend enters it in their Spellpool app&apos;s game seat editor — your name, deck, and
        commander fill the seat, and the result records on this deck when the game ends. Codes can
        be entered for 10 minutes.
      </p>
    </ModalShell>
  );
}
