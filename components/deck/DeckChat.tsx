"use client";

import { useEffect, useRef, useState } from "react";
import { PoolEntry, deleteCard, poolByName, resolveAndAdd } from "@/lib/pool-client";
import { Block, InlineToken, parseBlocks } from "@/lib/chat-markdown";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const STARTERS = [
  "I'm leaning artifact creatures over Eldrazi — what do you think?",
  "What combos am I close to completing?",
  "Suggest cheap card draw that fits my deck",
  "How can I lower my mana curve?",
];

// Full-card image straight from Scryfall by name — used to preview cards that
// aren't in the pool yet (pool cards reuse their stored image).
function namedImageUrl(name: string): string {
  return `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}&format=image&version=normal`;
}

interface Preview {
  src: string;
  rect: DOMRect;
}

/* Conversational AI deck assistant. The player describes an idea or change and
   gets a streamed, ChatGPT-style Markdown answer (combos woven in). Every card
   the assistant names is an interactive link: hover to preview it, click to add
   it to the pool — or, if it's already in the deck, click to remove it.
   Conversation is multi-turn for the session — it persists while the deck page
   is mounted, including across search-mode tab switches, and resets on reload. */
export default function DeckChat({
  deckId,
  pool,
  commander,
  onPoolChanged,
}: {
  deckId: number;
  pool: PoolEntry[];
  commander: string | null | undefined;
  onPoolChanged: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  // lowercase name → pool row, for membership, dbId (remove) and stored image.
  const poolByLower = new Map(pool.map((c) => [c.name.toLowerCase(), c]));

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Click a card link: add it if it's not in the pool, otherwise remove that row
  // from the deck. Either way the pool reloads so the link's state flips.
  async function toggleCard(name: string) {
    const key = name.toLowerCase();
    if (busy.has(key)) return;
    setPreview(null);
    setError("");
    setBusy((prev) => new Set(prev).add(key));
    try {
      const entry = poolByLower.get(key);
      if (entry) {
        if (await deleteCard(deckId, entry.dbId)) onPoolChanged();
        else setError(`Couldn't remove "${name}".`);
      } else {
        const result = await resolveAndAdd(deckId, name, 1, poolByName(pool));
        if (result === "added") onPoolChanged();
        else setError(result === "notfound" ? `Couldn't find "${name}" on Scryfall.` : `Couldn't add "${name}".`);
      }
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;
    const history = [...messages, { role: "user" as const, content }];
    // Append the user turn and an empty assistant turn we stream into.
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    setError("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          currentDeck: {
            commander: commander ?? null,
            cards: pool.map((c) => ({ name: c.name, manaCost: c.manaCost, typeLine: c.typeLine })),
          },
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "The assistant is unavailable right now.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = prev.slice();
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed");
      // Drop the empty assistant bubble if nothing streamed in.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && !last.content) return prev.slice(0, -1);
        return prev;
      });
    } finally {
      setStreaming(false);
    }
  }

  const empty = messages.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* transcript */}
      {!empty && (
        <div
          ref={scrollRef}
          onScroll={() => setPreview(null)}
          style={{
            maxHeight: 460,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            padding: "4px 2px",
          }}
        >
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
                <div
                  style={{
                    maxWidth: "85%",
                    background: "var(--bg3)",
                    color: "var(--text)",
                    padding: "9px 14px",
                    borderRadius: "16px 16px 4px 16px",
                    fontSize: 14.5,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.content}
                </div>
              </div>
            ) : m.content ? (
              <div key={i}>
                <ChatMarkdown
                  text={m.content}
                  poolByLower={poolByLower}
                  busy={busy}
                  onCard={toggleCard}
                  onPreview={setPreview}
                />
              </div>
            ) : (
              <Thinking key={i} />
            )
          )}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 13.5, color: "var(--danger)", padding: "0 2px" }}>{error}</div>
      )}

      {/* starter prompts (only before the first message) */}
      {empty && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Describe an idea or a change to your deck. I&apos;ll talk it through, suggest cards (and combos).
            Hover any card to preview it, tap to add it to your pool — or tap a card you already run to remove it.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 13.5,
                  textAlign: "left",
                  padding: "7px 12px",
                  borderRadius: 14,
                  border: "none",
                  cursor: "pointer",
                  background: "transparent",
                  color: "var(--accent)",
                  boxShadow: "inset 0 0 0 1px var(--line)",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        style={{ display: "flex", gap: 10, alignItems: "flex-end" }}
      >
        <textarea
          className="cc-paper"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Tell the assistant your idea…"
          rows={2}
          disabled={streaming}
          style={{
            flex: 1,
            resize: "none",
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: "10px 12px",
            fontFamily: "var(--font-body)",
            fontSize: 14.5,
            lineHeight: 1.5,
            background: "var(--surface)",
            color: "var(--text)",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          style={{
            padding: "0 22px",
            height: 44,
            borderRadius: 999,
            border: "none",
            cursor: streaming || !input.trim() ? "default" : "pointer",
            background: "var(--accent)",
            color: "var(--accent-ink)",
            fontFamily: "var(--font-ui)",
            fontWeight: 700,
            fontSize: 14.5,
            whiteSpace: "nowrap",
            opacity: streaming || !input.trim() ? 0.6 : 1,
          }}
        >
          {streaming ? "…" : "Send"}
        </button>
      </form>

      {preview && <CardPreview preview={preview} />}
    </div>
  );
}

function Thinking() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-dim)", fontSize: 14 }}>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "var(--accent)",
          animation: "mn-blink 1.1s infinite",
        }}
      />
      Thinking…
    </div>
  );
}

/* Floating card image anchored to the hovered link — placed above it when there's
   room, otherwise below, and clamped to the viewport. Non-interactive. */
function CardPreview({ preview }: { preview: Preview }) {
  const W = 224;
  const H = 312;
  const { rect } = preview;
  const above = rect.top > H + 16;
  const top = above ? rect.top - H - 10 : rect.bottom + 10;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - W - 8));
  return (
    <div
      style={{
        position: "fixed",
        top,
        left,
        width: W,
        zIndex: 80,
        pointerEvents: "none",
        animation: "sp-fade .12s ease",
      }}
    >
      <div className="cc-black" style={{ padding: 6 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={preview.src}
          alt=""
          draggable={false}
          style={{ width: "100%", height: "auto", display: "block", borderRadius: 8 }}
        />
      </div>
    </div>
  );
}

/* Renders the assistant's Markdown answer: headings, bold, bullet/numbered
   lists, paragraphs, and [[Card Name]] tokens as interactive card links. */
function ChatMarkdown({
  text,
  poolByLower,
  busy,
  onCard,
  onPreview,
}: {
  text: string;
  poolByLower: Map<string, PoolEntry>;
  busy: Set<string>;
  onCard: (name: string) => void;
  onPreview: (p: Preview | null) => void;
}) {
  const blocks = parseBlocks(text);
  const renderInline = (tokens: InlineToken[], keyPrefix: string) =>
    tokens.map((t, i) => {
      const key = `${keyPrefix}-${i}`;
      if (t.type === "text") return <span key={key}>{t.value}</span>;
      if (t.type === "bold")
        return (
          <strong key={key} style={{ fontWeight: 700 }}>
            {t.value}
          </strong>
        );
      const entry = poolByLower.get(t.value.toLowerCase());
      return (
        <CardLink
          key={key}
          name={t.value}
          inPool={Boolean(entry)}
          busy={busy.has(t.value.toLowerCase())}
          imageUri={entry?.imageUri || null}
          onClick={() => onCard(t.value)}
          onPreview={onPreview}
        />
      );
    });

  return (
    <div style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--text)" }}>
      {blocks.map((b: Block, bi) => {
        if ("items" in b) {
          const Tag = b.type; // "ul" | "ol"
          return (
            <Tag key={bi} style={{ margin: "6px 0", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 4 }}>
              {b.items.map((item, ii) => (
                <li key={ii} style={{ paddingLeft: 2 }}>
                  {renderInline(item, `${bi}-${ii}`)}
                </li>
              ))}
            </Tag>
          );
        }
        if (b.type === "p") {
          return (
            <p key={bi} style={{ margin: bi === 0 ? "0 0 8px" : "8px 0" }}>
              {renderInline(b.inline, `${bi}`)}
            </p>
          );
        }
        const size = b.type === "h1" ? 19 : b.type === "h2" ? 16.5 : 15;
        return (
          <div
            key={bi}
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: size,
              margin: bi === 0 ? "0 0 6px" : "16px 0 6px",
            }}
          >
            {renderInline(b.inline, `${bi}`)}
          </div>
        );
      })}
    </div>
  );
}

/* Inline card reference. Hover previews the card; click adds it to the pool, or
   removes it if it's already in the deck. In-pool links read green with a ✓ and
   turn red ("remove") on hover. */
function CardLink({
  name,
  inPool,
  busy,
  imageUri,
  onClick,
  onPreview,
}: {
  name: string;
  inPool: boolean;
  busy: boolean;
  imageUri: string | null;
  onClick: () => void;
  onPreview: (p: Preview | null) => void;
}) {
  const [hover, setHover] = useState(false);
  const color = busy
    ? "var(--text-muted)"
    : inPool
      ? hover
        ? "var(--danger)"
        : "#0d8a5f"
      : "var(--accent)";
  const suffix = busy ? " …" : inPool ? (hover ? " ✕" : " ✓") : "";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={inPool ? `Remove ${name} from your deck` : `Add ${name} to your pool`}
      onMouseEnter={(e) => {
        setHover(true);
        onPreview({ src: imageUri || namedImageUrl(name), rect: e.currentTarget.getBoundingClientRect() });
      }}
      onMouseLeave={() => {
        setHover(false);
        onPreview(null);
      }}
      style={{
        display: "inline",
        border: "none",
        background: "transparent",
        padding: 0,
        margin: 0,
        font: "inherit",
        cursor: busy ? "default" : "pointer",
        color,
        fontWeight: 600,
        textDecoration: "underline",
        textDecorationStyle: "dotted",
        textUnderlineOffset: 2,
        opacity: busy ? 0.6 : 1,
      }}
    >
      {name}
      {suffix}
    </button>
  );
}
