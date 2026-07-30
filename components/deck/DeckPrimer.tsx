"use client";

/* The deck's primer — the document you read to learn how to pilot the deck:
   the plan, what to keep, the lines, the combos, what beats it.

   It is written in the iOS app (by hand or drafted by the assistant) and stored
   on the deck, so this is the same text, rendered. Deliberately not the notes
   field: notes is a scratchpad, a primer is what you hand to someone who asks
   how the deck works.

   Rendering reuses the chat's Markdown tokenizer, so [[Card Name]] links keep
   working here without a second parser. Cards are styled but not clickable —
   a primer is for reading, not for adding cards. */

import { useMemo, useRef, useState } from "react";
import { Block, InlineToken, parseBlocks } from "@/lib/chat-markdown";
import { ghostBtn, goldBtn } from "./ui";

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
            <button
              style={{ ...ghostBtn, padding: "6px 14px", fontSize: 13 }}
              onClick={() => { setDraft(primer); setEditing(true); }}
            >
              {has ? "Edit" : "Write one"}
            </button>
          )}
          {editing && (
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

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"## The plan\nHow the deck wins…\n\n## Opening hands\nWhat to keep…"}
          rows={14}
          style={{ width: "100%", border: "none", outline: "none", resize: "vertical", background: "transparent", fontFamily: "var(--font-body)", fontSize: 14.5, lineHeight: 1.6, color: "var(--text)", minHeight: 220, padding: 0 }}
        />
      ) : has ? (
        <PrimerMarkdown text={primer} />
      ) : (
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--w-3)" }}>
          No primer yet.{" "}
          {canEdit
            ? "Write how this deck is piloted — the plan, what to keep, the combos and the lines. The iOS app can draft one from your decklist."
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
