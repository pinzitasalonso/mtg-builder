"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { ArrowUp, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { parseBlocks, type Block, type InlineToken } from "@/lib/chat-markdown";
import { GetProButton } from "@/components/GetPro";
import { deckRef, rewriteDeckLinks } from "@/lib/assistant";
import { resolveAndAdd } from "@/lib/pool-client";
import { track } from "@/lib/track";

/* The home assistant, full screen: one conversation across every deck and the
   collection (POST /api/assistant reads them all server-side, and can create
   decks, edit them and save versions). Deck names in a reply open the deck; a
   card name opens a menu to add it to any deck's pool. The conversation
   survives closing the panel, and a reload (sessionStorage). */

interface Msg {
  role: "user" | "assistant";
  content: string;
}
export interface AssistantDeckRef {
  publicId: string;
  name: string;
}

const STORE = "sp-home-assistant";
const STARTERS = [
  "Which of my decks is strongest, and which needs the most work?",
  "Compare my decks by speed and cost.",
  "Build me a new deck from cards I already own.",
  "Which cards am I running in several decks?",
  "What should I buy next that helps more than one deck?",
];

// The server's in-stream signal that a tool changed a deck (see
// /api/assistant). Stripped before anything is shown.
const DECKS_CHANGED = "\u2063decks-changed\u2063";

function namedImageUrl(name: string): string {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
}

export default function HomeAssistant({
  decks,
  onClose,
  onDecksChanged,
}: {
  decks: AssistantDeckRef[];
  onClose: () => void;
  /** A reply created or changed a deck: refresh the list behind the panel. */
  onDecksChanged?: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>(() => {
    try {
      const saved = sessionStorage.getItem(STORE);
      return saved ? (JSON.parse(saved) as Msg[]) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  // The error is the free plan's daily AI budget: offer Pro beside it.
  const [aiLimited, setAiLimited] = useState(false);
  const [menu, setMenu] = useState<{ name: string; rect: DOMRect } | null>(null);
  const [toast, setToast] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    if (streaming) return; // save settled turns, not every streamed chunk
    try {
      sessionStorage.setItem(STORE, JSON.stringify(messages));
    } catch {
      /* private mode — the conversation just won't survive a reload */
    }
  }, [messages, streaming]);

  useEffect(() => {
    if (pinned.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;
    track("ai_message");
    const history = [...messages, { role: "user" as const, content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError("");
    setAiLimited(false);
    setStreaming(true);
    pinned.current = true;
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        if (data.code === "ai_limit") setAiLimited(true);
        throw new Error(data.error || "The assistant is unavailable right now.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        if (acc.includes(DECKS_CHANGED)) {
          acc = acc.split(DECKS_CHANGED).join("");
          onDecksChanged?.();
        }
        const shown = acc;
        setMessages((prev) => [...prev.slice(0, -1), { role: "assistant", content: shown }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The assistant is unavailable right now.");
      // Drop the empty reply bubble, and put the question back to retry.
      setMessages((prev) => (prev[prev.length - 1]?.content ? prev : prev.slice(0, -2)));
      setInput(content);
    } finally {
      setStreaming(false);
    }
  }

  async function addTo(deck: AssistantDeckRef, name: string) {
    setMenu(null);
    setToast(`Adding ${name} to ${deck.name}…`);
    const r = await resolveAndAdd(deck.publicId, name, 1, new Map());
    setToast(
      r === "added"
        ? `Added ${name} to ${deck.name}’s pool.`
        : r === "notfound"
          ? `Scryfall doesn’t know “${name}”.`
          : `Couldn’t add ${name}. Try again.`
    );
    setTimeout(() => setToast(""), 3500);
  }

  function reset() {
    if (streaming) return;
    setMessages([]);
    setError("");
  }

  // Full screen: Esc closes (unless the card menu is open, which it closes
  // first), and the page behind stops scrolling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) setMenu(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, onClose]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const empty = messages.length === 0;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="home-assistant-title"
      style={{ position: "fixed", inset: 0, zIndex: 75, background: "var(--bg)", display: "flex", flexDirection: "column", animation: "sp-fade .15s ease" }}
    >
      {/* header: full width, with the column below centred under it */}
      <div style={{ borderBottom: "1px solid var(--line)", padding: "12px clamp(16px, 4vw, 32px)" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", alignItems: "center", gap: 10 }}>
          <Sparkles size={20} strokeWidth={2} color="var(--gold)" style={{ flex: "none" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="home-assistant-title" style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "clamp(17px, 4.6vw, 22px)", fontWeight: 700, color: "var(--frame-ink, var(--text))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Ask about all your decks
            </h2>
            <div style={{ fontSize: 13, color: "var(--t3, var(--text-muted))", marginTop: 2 }}>
              Sees your {decks.length} deck{decks.length === 1 ? "" : "s"} and your collection.
            </div>
          </div>
          {!empty && (
            <button type="button" onClick={reset} disabled={streaming} className="id-ghost" style={{ padding: "7px 12px", fontSize: 13 }} title="Start a new conversation">
              <RotateCcw size={14} strokeWidth={2.25} /> New
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 36, height: 36, flex: "none", borderRadius: 999, border: "none", background: "var(--bg3)", color: "var(--t2, var(--text-muted))", display: "grid", placeItems: "center", cursor: "pointer" }}>
            <X size={18} strokeWidth={2.25} />
          </button>
        </div>
      </div>

      {/* transcript: the page's own scroll area */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          setMenu(null);
        }}
        style={{ flex: 1, overflowY: "auto", padding: "20px clamp(16px, 4vw, 32px)" }}
        aria-live="polite"
      >
        <div style={{ maxWidth: 860, margin: "0 auto", minHeight: "100%", display: "flex", flexDirection: "column", gap: 18 }}>
        {empty ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, justifyContent: "flex-end" }}>
            <p style={{ margin: "0 0 8px", fontSize: 14.5, color: "var(--t2, var(--text-muted))", lineHeight: 1.5 }}>
              It reads every deck with its cards’ costs, prices and Deck Score, and your collection. It can look cards up,
              build a new deck, change one (saving a version first), or save a version.
            </p>
            {STARTERS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="id-ghost" style={{ justifyContent: "flex-start", textAlign: "left", whiteSpace: "normal", padding: "11px 16px", borderRadius: 14, fontSize: 14 }}>
                {s}
              </button>
            ))}
          </div>
        ) : (
          <>
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} style={{ alignSelf: "flex-end", maxWidth: "85%", background: "var(--bg3)", color: "var(--t1, var(--text))", padding: "9px 14px", borderRadius: "16px 16px 4px 16px", fontSize: 14.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {m.content}
                </div>
              ) : m.content.trim() ? (
                <Reply key={i} text={m.content} onCard={(name, rect) => setMenu({ name, rect })} onDeck={onClose} />
              ) : (
                <div key={i} style={{ fontSize: 14, color: "var(--t3, var(--text-muted))" }}>Reading your decks…</div>
              )
            )}
          </>
        )}
        </div>
      </div>

      {/* composer, docked at the bottom */}
      <div style={{ borderTop: "1px solid var(--line)", padding: "12px clamp(16px, 4vw, 32px) max(12px, env(safe-area-inset-bottom))" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {error && (
          <div role="alert" style={{ fontSize: 13.5, color: "var(--danger)" }}>
            {error}
            {aiLimited && (
              <>
                {" "}
                <GetProButton
                  onUpgraded={() => {
                    setError("");
                    setAiLimited(false);
                  }}
                />
              </>
            )}
          </div>
        )}
        {toast && <div role="status" style={{ fontSize: 13.5, color: "var(--t2, var(--text-muted))" }}>{toast}</div>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          style={{ display: "flex", gap: 8, alignItems: "flex-end" }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={2}
            placeholder="Ask across your decks and collection…"
            aria-label="Your question"
            style={{ flex: 1, resize: "none", border: "1px solid var(--line)", borderRadius: 14, padding: "10px 14px", fontFamily: "var(--font-ui)", fontSize: 16, lineHeight: 1.4, background: "var(--bg2, var(--bg))", color: "var(--t1, var(--text))", outline: "none" }}
          />
          <button type="submit" disabled={streaming || !input.trim()} aria-label="Send" className="id-btn" style={{ width: 44, height: 44, padding: 0, justifyContent: "center", flex: "none", opacity: streaming || !input.trim() ? 0.5 : 1 }}>
            <ArrowUp size={19} strokeWidth={2.5} />
          </button>
        </form>
        </div>
      </div>

      {/* Portalled, so no ancestor's transform can offset the fixed menu. */}
      {menu && createPortal(<AddMenu name={menu.name} rect={menu.rect} decks={decks} onPick={(d) => addTo(d, menu.name)} onClose={() => setMenu(null)} />, document.body)}
    </div>
  );
}

/* One reply: the shared Markdown parse, with deck links and card buttons. */
function Reply({ text, onCard, onDeck }: { text: string; onCard: (name: string, rect: DOMRect) => void; onDeck: () => void }) {
  const blocks = useMemo(() => parseBlocks(rewriteDeckLinks(text)), [text]);
  const inline = (tokens: InlineToken[], k: string): React.ReactNode[] =>
    tokens.map((t, i) => {
      const key = `${k}-${i}`;
      if (t.type === "text") return <span key={key}>{t.value}</span>;
      if (t.type === "bold") return <strong key={key}>{inline(t.tokens, key)}</strong>;
      const deck = deckRef(t.value);
      if (deck) {
        return (
          <Link key={key} href={`/deck/${deck.id}`} onClick={onDeck} style={{ color: "var(--gold)", fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 2 }}>
            {deck.label}
          </Link>
        );
      }
      return (
        <button
          key={key}
          type="button"
          onClick={(e) => onCard(t.value, e.currentTarget.getBoundingClientRect())}
          title={`Add ${t.value} to a deck`}
          style={{ display: "inline", border: "none", background: "transparent", padding: 0, font: "inherit", fontWeight: 600, color: "var(--gold)", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2, cursor: "pointer" }}
        >
          {t.value}
        </button>
      );
    });
  return (
    <div style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--t1, var(--text))" }}>
      {blocks.map((b: Block, bi) => {
        if ("items" in b) {
          const Tag = b.type;
          return (
            <Tag key={bi} style={{ margin: "6px 0", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 4 }}>
              {b.items.map((it, ii) => <li key={ii}>{inline(it, `${bi}-${ii}`)}</li>)}
            </Tag>
          );
        }
        if (b.type === "p") return <p key={bi} style={{ margin: bi === 0 ? "0 0 8px" : "8px 0" }}>{inline(b.inline, `${bi}`)}</p>;
        return (
          <div key={bi} style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: b.type === "h1" ? 19 : b.type === "h2" ? 16.5 : 15, margin: bi === 0 ? "0 0 6px" : "16px 0 6px" }}>
            {inline(b.inline, `${bi}`)}
          </div>
        );
      })}
    </div>
  );
}

/* A card's menu: its image, and every deck to add it to. */
function AddMenu({
  name,
  rect,
  decks,
  onPick,
  onClose,
}: {
  name: string;
  rect: DOMRect;
  decks: AssistantDeckRef[];
  onPick: (d: AssistantDeckRef) => void;
  onClose: () => void;
}) {
  const width = 240;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  const below = rect.bottom + 8;
  const top = below + 380 > window.innerHeight ? Math.max(8, rect.top - 388) : below;
  const sorted = [...decks].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90 }} />
      <div role="menu" aria-label={`Add ${name} to a deck`} className="id-card" style={{ position: "fixed", top, left, width, zIndex: 91, padding: 8, display: "flex", flexDirection: "column", gap: 6, maxHeight: 380, background: "var(--bg)", borderRadius: 14, boxShadow: "0 18px 40px -12px rgba(0,0,0,.45), inset 0 0 0 1px var(--line)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={namedImageUrl(name)} alt={name} style={{ width: 120, alignSelf: "center", borderRadius: "4.8% / 3.5%", aspectRatio: "5 / 7", objectFit: "cover", background: "rgba(0,0,0,.1)" }} />
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--t3, var(--text-muted))", padding: "2px 6px" }}>Add to a deck’s pool</div>
        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {sorted.length === 0 ? (
            <div style={{ fontSize: 13, padding: 6, color: "var(--t3, var(--text-muted))" }}>No decks yet.</div>
          ) : (
            sorted.map((d) => (
              <button key={d.publicId} role="menuitem" type="button" onClick={() => onPick(d)} className="tools-item" style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left", padding: "8px 8px", borderRadius: 8, border: "none", background: "transparent", color: "var(--t1, var(--text))", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
                <Plus size={14} strokeWidth={2.5} style={{ flex: "none", opacity: 0.7 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
