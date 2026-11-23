"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Shapes } from "lucide-react";
import type { DeckToken, DeckTokens } from "@/lib/deck-tokens";
import { CardArt } from "@/components/mtg";
import { ModalShell, ghostBtn } from "./ui";

/* The tokens a deck needs at the table: what its cards make that isn't in
   the deck. Each one with its picture and the cards that make it, so you
   know what to bring, and a list to copy for buying or printing them.
   Emblems and markers (the monarch, a dungeon) are listed after the tokens. */

const SECTIONS: { kind: DeckToken["kind"]; title: string }[] = [
  { kind: "token", title: "Tokens" },
  { kind: "emblem", title: "Emblems" },
  { kind: "marker", title: "Markers" },
];

/** "Soldier 1/1 (white)", for the list that is copied. */
function line(t: DeckToken): string {
  const colours = [...t.colors].map((c) => ({ W: "white", U: "blue", B: "black", R: "red", G: "green" })[c] ?? c).join("/");
  return [t.name, t.stats, t.kind === "token" && colours ? `(${colours})` : ""].filter(Boolean).join(" ");
}

export default function TokensModal({ deckId, onClose }: { deckId: string; onClose: () => void }) {
  const [data, setData] = useState<DeckTokens | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/decks/${deckId}/tokens`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DeckTokens | null) => {
        if (!live) return;
        if (d) setData(d);
        else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [deckId]);

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.tokens.map(line).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }

  return (
    <ModalShell onDismiss={onClose} maxWidth={640} labelledBy="tokens-title">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
        <h2 id="tokens-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: 9, fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--frame-ink)" }}>
          <Shapes size={22} strokeWidth={2} /> Tokens
        </h2>
        <button onClick={onClose} style={{ ...ghostBtn, padding: "6px 12px" }}>Close</button>
      </div>

      {failed ? (
        <p role="alert" style={{ margin: "8px 0 0", fontSize: 14, color: "#ff9c86" }}>Couldn’t work out this deck’s tokens. Close this and try again.</p>
      ) : !data ? (
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--t2)" }}>Reading the deck’s cards… The first time takes a few seconds.</p>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <p data-testid="tokens-summary" style={{ flex: "1 1 220px", margin: 0, fontSize: 13.5, color: "var(--t2)", lineHeight: 1.45 }}>
              {data.tokens.length
                ? `This deck can make ${data.tokens.length} different ${data.tokens.length === 1 ? "thing" : "things"} that ${data.tokens.length === 1 ? "isn’t" : "aren’t"} in the deck. Bring ${data.tokens.length === 1 ? "it" : "them"} to the table.`
                : data.incomplete
                  ? "Nothing found."
                  : "This deck makes no tokens."}
            </p>
            {data.tokens.length > 0 && (
              <button onClick={copy} style={{ ...ghostBtn, flex: "none", padding: "6px 12px", fontSize: 13 }}>
                {copied ? <Check size={14} strokeWidth={3} /> : <Copy size={14} strokeWidth={2.25} />} {copied ? "Copied" : "Copy the list"}
              </button>
            )}
          </div>
          {data.incomplete && (
            <p role="status" style={{ margin: "0 0 14px", padding: "9px 12px", borderRadius: 10, background: "var(--bg2)", fontSize: 13, color: "var(--t2)", lineHeight: 1.45 }}>
              Scryfall didn’t answer for every card, so this list may be short. Open it again in a moment.
            </p>
          )}

          {SECTIONS.map(({ kind, title }) => {
            const list = data.tokens.filter((t) => t.kind === kind);
            if (!list.length) return null;
            return (
              <section key={kind} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span className="id-label" style={{ color: "var(--t2)", fontSize: 11.5 }}>{title}</span>
                  <span className="id-mono" style={{ fontSize: 11.5, color: "var(--t3)" }}>{list.length}</span>
                  <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
                </div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
                  {list.map((t) => (
                    <li key={t.key} style={{ display: "flex", gap: 11, minWidth: 0, padding: 9, borderRadius: 12, background: "var(--bg2)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
                      <div style={{ flex: "none", width: 82, aspectRatio: "5 / 7", borderRadius: "4.8%/3.5%", overflow: "hidden", background: "var(--bg3)" }}>
                        <CardArt name={t.name} src={t.imageUri || undefined} prefer="src" version="normal" loading="lazy" radius={0} style={{ width: "100%", height: "100%" }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--t1)", lineHeight: 1.25 }}>
                          {t.name}
                          {t.stats && <span className="id-mono" style={{ marginLeft: 7, fontWeight: 600, color: "var(--t2)" }}>{t.stats}</span>}
                        </div>
                        <div style={{ marginTop: 1, fontSize: 12.5, color: "var(--t3)" }}>{t.typeLine.replace(/^Token\s+/, "")}</div>
                        <div style={{ marginTop: 7, fontSize: 12.5, color: "var(--t2)", lineHeight: 1.4 }}>
                          <span style={{ color: "var(--t3)" }}>From</span>{" "}
                          {t.by.slice(0, 4).join(", ")}
                          {t.by.length > 4 ? ` and ${t.by.length - 4} more` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {data.unlisted.length > 0 && (
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--t3)", lineHeight: 1.45 }}>
              {data.unlisted.length === 1 ? "This card makes" : "These cards make"} a token there’s no picture for. Check {data.unlisted.length === 1 ? "it" : "them"} by hand: {data.unlisted.join(", ")}.
            </p>
          )}
        </>
      )}
    </ModalShell>
  );
}
