"use client";

import { useEffect, useRef, useState } from "react";
import { PoolEntry } from "@/lib/pool-client";
import { ModalShell, ghostBtn, goldBtn } from "./ui";

interface AddedLine {
  name: string;
  quantity: number;
  priceCents: number;
  currency: string;
  seller: string | null;
}

interface OrderResult {
  added: AddedLine[];
  notFound: string[];
  noZero: string[];
  failed: string[];
  totalCents: number | null;
  currency: string | null;
  cartUrl: string;
}

const SHOP_OPTIMIZER = "https://www.cardtrader.com/en/wishlists/new";

const money = (cents: number, currency: string | null) =>
  `${(cents / 100).toFixed(2)} ${currency ?? ""}`.trim();

const dimList: React.CSSProperties = { fontSize: 13.5, color: "rgba(236,225,198,.85)", lineHeight: 1.5 };

/* Orders the deck on CardTrader: fills the Zero cart via the API when a
   token is configured, otherwise falls back to copy-the-list + Shop
   Optimizer. */
export default function OrderModal({ cards, onClose }: { cards: PoolEntry[]; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(true);
  const [result, setResult] = useState<OrderResult | null>(null);
  const [copied, setCopied] = useState(false);
  const ran = useRef(false);

  const listText = cards.map((c) => `${c.quantity} ${c.name}`).join("\n");

  useEffect(() => {
    if (ran.current) return; // the cart is shared state — never order twice
    ran.current = true;
    (async () => {
      try {
        const res = await fetch("/api/cardtrader/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cards: cards.map((c) => ({ name: c.name, quantity: c.quantity })) }),
        });
        const data = await res.json();
        if (res.status === 501) setConfigured(false);
        else if (!res.ok) setError(data.error ?? "Order failed");
        else setResult(data as OrderResult);
      } catch {
        setError("Network error");
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Fallback — same flow as before the API: copy first (the new tab steals
     focus and an unfocused page can't write to the clipboard), then open. */
  async function copyAndOpen() {
    try {
      await navigator.clipboard.writeText(listText);
      setCopied(true);
    } catch {
      // clipboard blocked — the tab still opens; export sheet has the list
    }
    window.open(SHOP_OPTIMIZER, "_blank", "noopener");
  }

  return (
    <ModalShell onDismiss={onClose} maxWidth={520}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--frame-ink)", textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>
          Order on CardTrader 🛒
        </h2>
        <button onClick={onClose} style={{ ...ghostBtn, padding: "6px 12px" }}>Close</button>
      </div>

      {loading && (
        <p style={{ margin: 0, fontStyle: "italic", color: "rgba(236,225,198,.85)", fontSize: 15 }}>
          Filling your CardTrader Zero cart… {cards.length} card{cards.length === 1 ? "" : "s"}.
        </p>
      )}

      {!loading && !configured && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, ...dimList, fontStyle: "italic" }}>
            No CardTrader API token is configured, so the cart can&apos;t be filled automatically.
            Add <code>CARDTRADER_API_TOKEN</code> to <code>.env</code> (cardtrader.com → Settings → API) and restart —
            or use the manual route:
          </p>
          <button onClick={copyAndOpen} style={goldBtn}>
            {copied ? "✓ List copied — paste it there" : "Copy list & open Shop Optimizer"}
          </button>
        </div>
      )}

      {!loading && error && configured && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ color: "#f4dccd", fontSize: 14, fontStyle: "italic", padding: "10px 14px", background: "rgba(207,125,94,.18)", borderRadius: 8 }}>
            {error}
          </div>
          <button onClick={copyAndOpen} style={ghostBtn}>
            {copied ? "✓ List copied — paste it there" : "Copy list & open Shop Optimizer instead"}
          </button>
        </div>
      )}

      {!loading && result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {result.added.length > 0 ? (
            <>
              <div className="label-sc" style={{ fontSize: 12, color: "#9bbf6e", letterSpacing: ".1em" }}>
                Added to your Zero cart · {result.added.length}
              </div>
              <div style={{ background: "rgba(0,0,0,.2)", borderRadius: 8, padding: "8px 13px", maxHeight: 220, overflowY: "auto" }}>
                {result.added.map((a) => (
                  <div key={a.name} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13.5, color: "var(--frame-ink)", padding: "2px 0" }}>
                    <span>
                      {a.quantity} {a.name}
                      {a.seller && <span style={{ color: "rgba(236,225,198,.55)", fontStyle: "italic" }}> · {a.seller}</span>}
                    </span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(a.priceCents, a.currency)}</span>
                  </div>
                ))}
              </div>
              {result.totalCents !== null && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, color: "var(--frame-ink)", fontFamily: "var(--font-display)" }}>
                  <span>Cart total (these cards)</span>
                  <span>{money(result.totalCents, result.currency)}</span>
                </div>
              )}
            </>
          ) : (
            <p style={{ margin: 0, ...dimList, fontStyle: "italic" }}>
              Nothing could be added — see below.
            </p>
          )}

          {result.noZero.length > 0 && (
            <div style={dimList}>
              <b style={{ color: "var(--gold)" }}>No CardTrader Zero listing:</b> {result.noZero.join(", ")}
            </div>
          )}
          {result.notFound.length > 0 && (
            <div style={dimList}>
              <b style={{ color: "#e0805f" }}>Not found on CardTrader:</b> {result.notFound.join(", ")}
            </div>
          )}
          {result.failed.length > 0 && (
            <div style={dimList}>
              <b style={{ color: "#e0805f" }}>Failed to add:</b> {result.failed.join(", ")}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={ghostBtn}>Close</button>
            <a href={result.cartUrl} target="_blank" rel="noopener noreferrer" style={{ ...goldBtn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Open cart ↗
            </a>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
