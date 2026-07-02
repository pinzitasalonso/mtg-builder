"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PoolEntry, addManyByName, deleteCard, poolByName, resolveAndAdd } from "@/lib/pool-client";
import { Block, InlineToken, boldNamesIn, cardNamesIn, flattenInline, normalizeCardKey, parseBlocks } from "@/lib/chat-markdown";
import { collectionByName } from "@/lib/scryfall";
import { track } from "@/lib/track";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

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
  ownedNames,
  onPoolChanged,
  onEngaged,
}: {
  deckId: string;
  pool: PoolEntry[];
  commander: string | null | undefined;
  /** Card names from the player's collection — marks suggestions they own. */
  ownedNames: string[];
  onPoolChanged: () => void;
  /** Reports when the user engages the chat (focus / conversation started). */
  onEngaged?: (engaged: boolean) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Live progress for the bulk add/remove bar so it never looks frozen.
  const [bulkProgress, setBulkProgress] = useState<{ mode: "add" | "remove"; done: number; total: number } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  // lowercase name → exists-on-Scryfall. Drives two things: hallucinated bracket
  // names render as plain text (notFound), and bold names that ARE real cards
  // get linked even when the model forgot to bracket them (valid).
  const [checked, setChecked] = useState<Map<string, boolean>>(new Map());
  const notFound = useMemo(
    () => new Set([...checked].filter(([, ok]) => !ok).map(([k]) => k)),
    [checked]
  );
  const validCards = useMemo(
    () => new Set([...checked].filter(([, ok]) => ok).map(([k]) => k)),
    [checked]
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether the transcript is pinned to the bottom. While streaming we only
  // auto-scroll when it's true, so scrolling up to read isn't yanked back down.
  const pinnedRef = useRef(true);
  // Normalized name → pool row, for membership, dbId (remove) and stored image.
  // Memoized so message components don't see a fresh map on every keystroke.
  const poolByLower = useMemo(() => new Map(pool.map((c) => [normalizeCardKey(c.name), c])), [pool]);
  // Normalized names the player owns, for the "owned" hint on suggestions.
  const ownedLower = useMemo(() => new Set(ownedNames.map(normalizeCardKey)), [ownedNames]);

  useEffect(() => {
    if (!pinnedRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Once a reply finishes, verify the cards it named against Scryfall (cards in
  // the pool already exist, so skip those). Names Scryfall can't resolve are
  // marked not-found and shown as plain text.
  useEffect(() => {
    if (streaming) return;
    const names = new Set<string>();
    for (const m of messages) {
      if (m.role !== "assistant" || !m.content) continue;
      // Bracketed names, plus bold spans (which may be unbracketed card names).
      for (const n of [...cardNamesIn(m.content), ...boldNamesIn(m.content)]) {
        const key = normalizeCardKey(n);
        if (!checked.has(key) && !poolByLower.has(key)) names.add(n);
      }
    }
    if (names.size === 0) return;
    let cancelled = false;
    collectionByName([...names])
      .then((found) => {
        if (cancelled) return;
        setChecked((prev) => {
          const next = new Map(prev);
          for (const n of names) next.set(normalizeCardKey(n), found.has(normalizeCardKey(n)));
          return next;
        });
      })
      // A failed lookup just leaves the names unverified: bracketed cards stay
      // clickable (they're trusted unless proven not-found) and bold spans stay
      // plain text. The next reply retriggers the effect and retries them.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, streaming]);

  // Click a card link: add it if it's not in the pool, otherwise remove that row
  // from the deck. Either way the pool reloads so the link's state flips.
  async function toggleCard(name: string) {
    const key = normalizeCardKey(name);
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

  // Add every suggested card not already in the pool — resolved in one batched
  // Scryfall lookup and inserted in a single request (fast, no per-card hammering).
  async function bulkAdd(names: string[]) {
    if (bulkBusy) return;
    const todo = names.filter((n) => !poolByLower.has(normalizeCardKey(n)) && !notFound.has(normalizeCardKey(n)));
    if (todo.length === 0) return;
    setBulkBusy(true);
    setBulkProgress({ mode: "add", done: 0, total: todo.length });
    setError("");
    const { failed } = await addManyByName(deckId, todo, poolByName(pool));
    onPoolChanged();
    if (failed.length) setError(`Couldn't add: ${failed.join(", ")}.`);
    setBulkBusy(false);
    setBulkProgress(null);
  }

  // Remove every suggested card that's currently in the deck (the cuts).
  async function bulkRemove(names: string[]) {
    if (bulkBusy) return;
    const rows = names
      .map((n) => poolByLower.get(normalizeCardKey(n)))
      .filter((r): r is PoolEntry => Boolean(r));
    if (rows.length === 0) return;
    setBulkBusy(true);
    setBulkProgress({ mode: "remove", done: 0, total: rows.length });
    setError("");
    let failed = 0;
    for (let i = 0; i < rows.length; i++) {
      if (!(await deleteCard(deckId, rows[i].dbId))) failed++;
      setBulkProgress({ mode: "remove", done: i + 1, total: rows.length });
    }
    onPoolChanged();
    if (failed) setError(`Couldn't remove ${failed} card${failed === 1 ? "" : "s"}.`);
    setBulkBusy(false);
    setBulkProgress(null);
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;
    track("ai_message");
    // A started conversation keeps the chat engaged (and the pool wide).
    onEngaged?.(true);
    // Sending re-pins to the bottom so the new turn (and its reply) scroll in.
    pinnedRef.current = true;
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
          collection: ownedNames,
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
          onScroll={(e) => {
            setPreview(null);
            const el = e.currentTarget;
            // Pinned when within ~80px of the bottom.
            pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
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
              <AssistantMessage
                key={i}
                content={m.content}
                poolByLower={poolByLower}
                ownedLower={ownedLower}
                notFound={notFound}
                validCards={validCards}
                busy={busy}
                bulkBusy={bulkBusy}
                bulkProgress={bulkProgress}
                showActions={!(streaming && i === messages.length - 1)}
                onCard={toggleCard}
                onPreview={setPreview}
                onAddAll={bulkAdd}
                onRemoveAll={bulkRemove}
              />
            ) : (
              <Thinking key={i} />
            )
          )}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 13.5, color: "var(--danger)", padding: "0 2px" }}>{error}</div>
      )}

      {/* intro line (only before the first message) */}
      {empty && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
          <span style={{ color: "var(--gold)", fontSize: 14, lineHeight: 1.5 }}>✦</span>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--w-2, var(--text-muted))", lineHeight: 1.5 }}>
            Describe what the deck needs — Spellpool pulls <b style={{ color: "var(--w-1, var(--text))" }}>real cards</b> in your color identity.
          </p>
        </div>
      )}

      {/* composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        style={{ display: "flex", gap: 10, alignItems: "center" }}
      >
        <textarea
          className="cc-paper"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => onEngaged?.(true)}
          onBlur={() => { if (messages.length === 0) onEngaged?.(false); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Tell the assistant your idea…"
          rows={1}
          disabled={streaming}
          style={{
            flex: 1,
            height: 46,
            resize: "none",
            overflow: "auto",
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: "12px 14px",
            fontFamily: "var(--font-body)",
            fontSize: 14.5,
            lineHeight: 1.4,
            background: "var(--surface)",
            color: "var(--text)",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          style={{
            padding: "0 22px",
            height: 46,
            borderRadius: 12,
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

/* The cards a reply makes clickable — the single source of truth shared by the
   bulk-action bar and the inline render, so they can't disagree. Bracketed
   names are trusted (linked unless Scryfall said not-found: the model marked
   them as cards explicitly), while bold spans only count once verified as real
   cards. */
function linkableNames(
  content: string,
  poolByLower: Map<string, PoolEntry>,
  validCards: Set<string>,
  notFound: Set<string>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (n: string, linkable: boolean) => {
    const key = normalizeCardKey(n);
    if (linkable && !seen.has(key)) {
      seen.add(key);
      out.push(n);
    }
  };
  for (const n of cardNamesIn(content)) push(n, !notFound.has(normalizeCardKey(n)));
  for (const n of boldNamesIn(content)) {
    const key = normalizeCardKey(n);
    push(n, poolByLower.has(key) || validCards.has(key));
  }
  return out;
}

/* One assistant turn: the rendered answer plus, when it names several cards, a
   bulk action bar to add every suggested card or remove every suggested cut in
   one tap. */
function AssistantMessage({
  content,
  poolByLower,
  ownedLower,
  notFound,
  validCards,
  busy,
  bulkBusy,
  bulkProgress,
  showActions,
  onCard,
  onPreview,
  onAddAll,
  onRemoveAll,
}: {
  content: string;
  poolByLower: Map<string, PoolEntry>;
  ownedLower: Set<string>;
  notFound: Set<string>;
  validCards: Set<string>;
  busy: Set<string>;
  bulkBusy: boolean;
  bulkProgress: { mode: "add" | "remove"; done: number; total: number } | null;
  showActions: boolean;
  onCard: (name: string) => void;
  onPreview: (p: Preview | null) => void;
  onAddAll: (names: string[]) => void;
  onRemoveAll: (names: string[]) => void;
}) {
  // Every clickable card in the reply, so "Add all" matches what's linked.
  // Memoized: streaming re-renders every bubble per chunk, and this scans the
  // whole reply text.
  const names = useMemo(
    () => linkableNames(content, poolByLower, validCards, notFound),
    [content, poolByLower, validCards, notFound]
  );
  const toAdd = names.filter((n) => !poolByLower.has(normalizeCardKey(n)));
  const toRemove = names.filter((n) => poolByLower.has(normalizeCardKey(n)));
  // Only worth a bulk bar when the answer suggests more than one card.
  const showBar = showActions && names.length > 1 && (toAdd.length > 0 || toRemove.length > 0);
  return (
    <div>
      <ChatMarkdown
        text={content}
        poolByLower={poolByLower}
        ownedLower={ownedLower}
        notFound={notFound}
        validCards={validCards}
        busy={busy}
        onCard={onCard}
        onPreview={onPreview}
      />
      {showBar && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 }}>
          {toAdd.length > 0 && (
            <button type="button" onClick={() => onAddAll(toAdd)} disabled={bulkBusy} style={bulkBtn(false)}>
              {bulkProgress?.mode === "add" ? "Adding…" : `＋ Add all ${toAdd.length}`}
            </button>
          )}
          {toRemove.length > 0 && (
            <button type="button" onClick={() => onRemoveAll(toRemove)} disabled={bulkBusy} style={bulkBtn(true)}>
              {bulkProgress?.mode === "remove"
                ? `Removing ${bulkProgress.done}/${bulkProgress.total}…`
                : `✕ Remove all ${toRemove.length}`}
            </button>
          )}
          {bulkProgress?.mode === "remove" && (
            <span style={{ flexBasis: "100%", height: 3, borderRadius: 99, background: "var(--line)", overflow: "hidden" }}>
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${Math.round((bulkProgress.done / Math.max(1, bulkProgress.total)) * 100)}%`,
                  background: "var(--danger)",
                  transition: "width .2s ease",
                }}
              />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function bulkBtn(danger: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 12px",
    borderRadius: 999,
    border: `1px solid ${danger ? "color-mix(in srgb, var(--danger) 45%, transparent)" : "var(--line)"}`,
    cursor: "pointer",
    background: "transparent",
    color: danger ? "var(--danger)" : "var(--accent)",
    fontFamily: "var(--font-ui)",
    fontSize: 12.5,
    fontWeight: 600,
  };
}

/* Renders the assistant's Markdown answer: headings, bold, bullet/numbered
   lists, paragraphs, and [[Card Name]] tokens as interactive card links. */
function ChatMarkdown({
  text,
  poolByLower,
  ownedLower,
  notFound,
  busy,
  onCard,
  onPreview,
  validCards,
}: {
  text: string;
  poolByLower: Map<string, PoolEntry>;
  ownedLower: Set<string>;
  notFound: Set<string>;
  busy: Set<string>;
  onCard: (name: string) => void;
  onPreview: (p: Preview | null) => void;
  validCards: Set<string>;
}) {
  // Re-parsing the whole reply on every streamed chunk (for every bubble) adds
  // up; the parse only depends on the text.
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const linkFor = (name: string, key: string) => {
    const nameKey = normalizeCardKey(name);
    const entry = poolByLower.get(nameKey);
    return (
      <CardLink
        key={key}
        name={name}
        inPool={Boolean(entry)}
        owned={ownedLower.has(nameKey)}
        busy={busy.has(nameKey)}
        imageUri={entry?.imageUri || null}
        onClick={() => onCard(name)}
        onPreview={onPreview}
      />
    );
  };
  const renderInline = (tokens: InlineToken[], keyPrefix: string) =>
    tokens.map((t, i) => {
      const key = `${keyPrefix}-${i}`;
      if (t.type === "text") return <span key={key}>{t.value}</span>;
      if (t.type === "bold") {
        // Guardrail: a bold span that's actually a real card name (the model
        // forgot the brackets) still becomes a clickable link.
        const flat = flattenInline(t.tokens).trim();
        const k = normalizeCardKey(flat);
        const hasCardChild = t.tokens.some((x) => x.type === "card");
        if (!hasCardChild && flat && (poolByLower.has(k) || validCards.has(k))) {
          return linkFor(flat, key);
        }
        return (
          <strong key={key} style={{ fontWeight: 700 }}>
            {renderInline(t.tokens, key)}
          </strong>
        );
      }
      // A name Scryfall couldn't resolve (an AI slip) — show it plainly, not as
      // a clickable card that would only fail to add.
      if (notFound.has(normalizeCardKey(t.value))) {
        return (
          <span key={key} title="Not a real card on Scryfall" style={{ fontWeight: 600, color: "var(--text-muted)" }}>
            {t.value}
          </span>
        );
      }
      return linkFor(t.value, key);
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
  owned,
  busy,
  imageUri,
  onClick,
  onPreview,
}: {
  name: string;
  inPool: boolean;
  owned: boolean;
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
  // Owned but not yet in the pool — flag that it's a free add from their collection.
  const showOwned = owned && !inPool && !busy;
  const title = inPool
    ? `Remove ${name} from your deck`
    : owned
      ? `Add ${name} — you own a copy`
      : `Add ${name} to your pool`;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title}
      onPointerEnter={(e) => {
        // Mouse only — on touch the first tap would otherwise reveal the preview
        // instead of registering the click, making cards feel unclickable.
        if (e.pointerType !== "mouse") return;
        setHover(true);
        onPreview({ src: imageUri || namedImageUrl(name), rect: e.currentTarget.getBoundingClientRect() });
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
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
      {showOwned && (
        <span
          style={{ color: "#0d8a5f", fontSize: "0.82em", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
        >
          {" "}· owned
        </span>
      )}
    </button>
  );
}
