"use client";

/* The deck's primer — the document you read to learn how to pilot the deck:
   the plan, what to keep, the lines, the combos, what beats it.

   It is written in the iOS app (by hand or drafted by the assistant) and stored
   on the deck, so this is the same text, rendered. It replaced the old notes
   scratchpad: two boxes for "how does this deck play" was one too many, and
   the primer is the one you'd hand to someone who asks.

   Rendering reuses the chat's Markdown tokenizer, so [[Card Name]] links keep
   working here without a second parser. Cards are styled but not clickable —
   a primer is for reading, not for adding cards. */

import { useMemo, useRef, useState } from "react";
import { Sparkles, Square } from "lucide-react";
import { Block, InlineToken, parseBlocks } from "@/lib/chat-markdown";
import { ghostBtn, goldBtn } from "./ui";
import { GetProButton } from "@/components/GetPro";

export default function DeckPrimer({
  deckId,
  primer,
  canEdit,
  onSaved,
}: {
  deckId: string;
  /** The saved primer, or "" when the deck has none yet. */
  primer: string;
  canEdit: boolean;
  onSaved: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(primer);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // Which text the server currently holds, so re-saving an unchanged primer
  // doesn't fire a PATCH.
  const saved = useRef(primer);
  // Drafting with the AI: the draft streams in (shown rendered), then opens in
  // the editor to change and save. Nothing is saved until Save.
  const [drafting, setDrafting] = useState(false);
  const [aiError, setAiError] = useState("");
  // The error is the free plan's daily AI budget: offer Pro beside it.
  const [aiLimited, setAiLimited] = useState(false);
  const [fromAi, setFromAi] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const writeWithAi = async () => {
    setAiError("");
    setAiLimited(false);
    setFailed(false);
    setDraft("");
    setEditing(true);
    setDrafting(true);
    setFromAi(true);
    const abort = new AbortController();
    abortRef.current = abort;
    let text = "";
    try {
      const res = await fetch(`/api/decks/${deckId}/primer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setAiLimited(data.code === "ai_limit");
        throw new Error(data.error || "Couldn’t write a draft right now.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setDraft(text);
      }
    } catch (e) {
      if (!abort.signal.aborted) setAiError(e instanceof Error ? e.message : "Couldn’t write a draft right now.");
      // Nothing came: back to what was there.
      if (!text.trim()) {
        setDraft(primer);
        setEditing(false);
      }
    } finally {
      abortRef.current = null;
      setDrafting(false);
    }
  };

  const save = async (text: string) => {
    if (text === saved.current) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setFailed(false);
    const res = await fetch(`/api/decks/${deckId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ primer: text }),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) {
      setFailed(true);
      return;
    }
    saved.current = text;
    onSaved(text);
    setEditing(false);
  };

  const has = primer.trim().length > 0;

  return (
    <div className="id-panel" style={{ padding: 16, marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <span className="id-label" style={{ color: "var(--w-2)" }}>Primer</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {failed && <span className="id-label" style={{ fontSize: 10, color: "var(--danger)" }}>Didn’t save</span>}
          {canEdit && !editing && (
            <>
              <button
                style={{ ...ghostBtn, padding: "6px 14px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}
                onClick={() => void writeWithAi()}
                title={has ? "Draft a new primer from the deck (you review it before it replaces this one)" : "Draft a primer from the deck"}
              >
                <Sparkles size={14} strokeWidth={2.25} /> {has ? "Rewrite with AI" : "Write with AI"}
              </button>
              <button
                style={{ ...ghostBtn, padding: "6px 14px", fontSize: 13 }}
                onClick={() => { setDraft(primer); setFromAi(false); setEditing(true); }}
              >
                {has ? "Edit" : "Write one"}
              </button>
            </>
          )}
          {drafting && (
            <button
              key="stop"
              style={{ ...ghostBtn, padding: "6px 14px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}
              onClick={(e) => { e.preventDefault(); abortRef.current?.abort(); }}
            >
              <Square size={11} strokeWidth={0} fill="currentColor" /> Stop
            </button>
          )}
          {editing && !drafting && (
            <>
              <button style={{ ...ghostBtn, padding: "6px 14px", fontSize: 13 }} onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button style={{ ...goldBtn, padding: "6px 16px", fontSize: 13 }} onClick={() => save(draft)} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>
      </div>

      {aiError && (
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--danger)" }}>
          {aiError}
          {aiLimited && (
            <>
              {" "}
              <GetProButton onUpgraded={() => { setAiError(""); setAiLimited(false); }} />
            </>
          )}
        </p>
      )}
      {drafting ? (
        draft ? (
          <PrimerMarkdown text={draft} />
        ) : (
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--w-3)", display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={14} strokeWidth={2.25} style={{ animation: "mn-blink 1.1s infinite" }} /> Reading the deck and writing a draft…
          </p>
        )
      ) : editing ? (
        <>
        {fromAi && (
          <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--w-3)" }}>
            AI draft — change anything you like, then Save. {has ? "Cancel keeps the primer you had." : "Cancel throws it away."}
          </p>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"## The plan\nHow the deck wins…\n\n## Opening hands\nWhat to keep…"}
          rows={14}
          style={{ width: "100%", border: "none", outline: "none", resize: "vertical", background: "transparent", fontFamily: "var(--font-body)", fontSize: 14.5, lineHeight: 1.6, color: "var(--text)", minHeight: 220, padding: 0 }}
        />
        </>
      ) : has ? (
        <PrimerMarkdown text={primer} />
      ) : (
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--w-3)" }}>
          No primer yet.{" "}
          {canEdit
            ? "Write how this deck is piloted — the plan, what to keep, the combos and the lines."
            : "The owner hasn’t written one."}
        </p>
      )}
    </div>
  );
}

/* Headings, bullets, paragraphs and bold, with [[Card Name]] tokens picked out
   in the accent colour. The same tokenizer the AI chat uses. */
function PrimerMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);

  const renderInline = (tokens: InlineToken[], keyPrefix: string): React.ReactNode =>
    tokens.map((t, i) => {
      const key = `${keyPrefix}-${i}`;
      if (t.type === "text") return <span key={key}>{t.value}</span>;
      if (t.type === "italic") return <em key={key}>{renderInline(t.tokens, key)}</em>;
      if (t.type === "bold") {
        return (
          <strong key={key} style={{ fontWeight: 700 }}>
            {renderInline(t.tokens, key)}
          </strong>
        );
      }
      return (
        <span key={key} style={{ color: "var(--gold)", fontWeight: 600 }}>
          {t.value}
        </span>
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
        // h1/h2/h3 — the primer's own section headings ("## The plan").
        const size = b.type === "h1" ? 20 : b.type === "h2" ? 17 : 15;
        return (
          <p
            key={bi}
            className="id-display"
            style={{ fontSize: size, color: "var(--w-1)", margin: bi === 0 ? "0 0 6px" : "14px 0 6px" }}
          >
            {renderInline(b.inline, `${bi}`)}
          </p>
        );
      })}
    </div>
  );
}
