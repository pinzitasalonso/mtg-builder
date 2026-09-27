"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import DeckChat, { useDeckActions, type ChatMessage, type DeckChatController } from "@/components/deck/DeckChat";
import AssistantScreen from "@/components/assistant/AssistantScreen";
import AddMenu, { type AssistantDeckRef } from "@/components/assistant/AddMenu";
import { resolveAndAdd, type PoolEntry } from "@/lib/pool-client";
import { track } from "@/lib/track";

/* Spellpool's one assistant, for a signed-in player.

   One conversation for the whole app, kept on the server (/api/assistant).
   The reply is written there too, so it keeps going when the chat is closed,
   the player moves to another deck, or the page reloads; this provider
   follows it while the page is open and picks it back up when it returns.

   Mounted once in the root layout, so it survives moving between pages. A
   deck page tells it which deck is on screen (useAssistantFocus); the chat
   then acts on that deck, and each question records it. Signed out, the
   provider stays dormant and the deck page uses its own stateless chat. */

/** The deck on screen, as the deck page reports it. */
export interface AssistantFocus {
  publicId: string;
  name: string;
  pool: PoolEntry[];
  ownedNames: string[];
  onPoolChanged: () => void;
}

interface AssistantApi {
  /** null until the first load says; false when signed out. */
  available: boolean | null;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** Re-read who's signed in and their thread (after signing in or out). */
  refresh: () => void;
  setFocus: (f: AssistantFocus | null) => void;
}

const Ctx = createContext<AssistantApi | null>(null);

export function useAssistant(): AssistantApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAssistant outside AssistantProvider");
  return v;
}

/** A deck page's report of the deck on screen, for as long as it's mounted. */
export function useAssistantFocus(focus: AssistantFocus | null) {
  const { setFocus } = useAssistant();
  useEffect(() => {
    setFocus(focus);
  }, [focus, setFocus]);
  useEffect(() => () => setFocus(null), [setFocus]);
}

/** Tells pages holding deck data that a reply changed a deck. */
export const DECKS_CHANGED_EVENT = "spellpool:decks-changed";

const DECK_STARTERS = [
  {
    label: "Judge my deck",
    featured: true,
    prompt:
      "Judge this deck like a pro deckbuilder: a short verdict first, then what's working well, the weakest cards I should consider cutting, and the key cards I'm missing (suggest specific ones).",
  },
  { label: "Fix my mana base", prompt: "Review this deck's mana base: do I have enough lands and the right color sources? Suggest specific lands to add or swap." },
  { label: "How do I win?", prompt: "How does this deck actually close out games? If the win conditions are thin, suggest specific cards to strengthen them." },
];
const HOME_STARTERS = [
  { label: "Strongest deck?", prompt: "Which of my decks is strongest, and which needs the most work?" },
  { label: "Compare my decks", prompt: "Compare my decks by speed and cost." },
  { label: "Build from my collection", prompt: "Build me a new deck from cards I already own." },
  { label: "What to buy next", prompt: "What should I buy next that helps more than one deck?" },
];

type Msg = ChatMessage & { id: number; status: string; deck: { publicId: string; name: string } | null };

export default function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [focus, setFocusState] = useState<AssistantFocus | null>(null);
  const [sendError, setSendError] = useState("");
  // The send error is the free plan's daily AI budget: offer Pro beside it.
  const [aiLimited, setAiLimited] = useState(false);
  // A reply finished while the chat was closed: the pill says so.
  const [unseen, setUnseen] = useState(false);
  const [menu, setMenu] = useState<{ name: string; rect: DOMRect } | null>(null);
  const [decks, setDecks] = useState<AssistantDeckRef[]>([]);
  const [toast, setToast] = useState("");

  const focusRef = useRef(focus);
  focusRef.current = focus;
  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  const running = messages.some((m) => m.role === "assistant" && m.status === "running");

  // ── Following a running reply. One follower at a time; it reconnects from
  // where it got to if the connection drops, until the reply ends.
  const followRef = useRef<{ id: number; abort: AbortController } | null>(null);
  // `from` is how much of the reply this page already shows. A new follower
  // replaces any old one; the old one's late chunks are dropped (see `live`),
  // so a reply can't be written twice.
  const follow = useCallback((id: number, from: number) => {
    followRef.current?.abort.abort();
    const abort = new AbortController();
    followRef.current = { id, abort };
    const setMsg = (fn: (m: Msg) => Msg) => {
      if (!abort.signal.aborted) setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
    };
    let got = from;

    void (async () => {
      let tries = 0;
      while (!abort.signal.aborted) {
        try {
          const res = await fetch(`/api/assistant/${id}/stream?from=${got}`, { signal: abort.signal, cache: "no-store" });
          if (!res.ok || !res.body) throw new Error(String(res.status));
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          let ended = false;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            tries = 0;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const raw = buf.slice(0, nl);
              buf = buf.slice(nl + 1);
              if (!raw.trim()) continue;
              if (abort.signal.aborted) break;
              const ev = JSON.parse(raw) as { t?: string; decks?: number; end?: string };
              if (ev.t) {
                got += ev.t.length;
                const t = ev.t;
                setMsg((m) => ({ ...m, content: m.content + t }));
              }
              if (ev.decks) {
                focusRef.current?.onPoolChanged();
                window.dispatchEvent(new Event(DECKS_CHANGED_EVENT));
              }
              if (ev.end) {
                const end = ev.end;
                ended = true;
                setMsg((m) => ({ ...m, status: end }));
                if (!openRef.current) setUnseen(true);
              }
            }
          }
          if (ended) break;
          throw new Error("stream closed early");
        } catch {
          if (abort.signal.aborted) break;
          // Dropped (a network blip, the phone sleeping): try again, backing
          // off, from what arrived. The reply carries on on the server.
          tries++;
          await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * 2 ** Math.min(tries, 4))));
        }
      }
      if (followRef.current?.abort === abort) followRef.current = null;
    })();
  }, []);

  // ── Loading the thread: on first mount, and again when the tab comes back
  // (a phone may have frozen it mid-reply).
  const load = useCallback(async () => {
    const res = await fetch("/api/assistant", { cache: "no-store" }).catch(() => null);
    if (!res) return;
    if (res.status === 401) {
      followRef.current?.abort.abort();
      followRef.current = null;
      setAvailable(false);
      setMessages([]);
      setIsOpen(false);
      return;
    }
    if (!res.ok) return;
    const data = (await res.json()) as { messages: Msg[] };
    setAvailable(true);
    // The server's copy wins, and a running reply is followed afresh from the
    // end of it (replacing any follower, whose offset no longer matches).
    followRef.current?.abort.abort();
    followRef.current = null;
    setMessages(data.messages);
    const live = data.messages.find((m) => m.role === "assistant" && m.status === "running");
    if (live) follow(live.id, live.content.length);
  }, [follow]);

  useEffect(() => {
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      followRef.current?.abort.abort();
    };
  }, [load]);

  // ── Asking, stopping, starting over.
  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || running) return;
      track("ai_message");
      setSendError("");
      setAiLimited(false);
      setInput("");
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, deckId: focusRef.current?.publicId ?? null }),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        setSendError(data.error || "The assistant is unavailable right now.");
        setAiLimited(data.code === "ai_limit");
        setInput((cur) => cur || content);
        return;
      }
      setMessages((prev) => [...prev, data.user as Msg, data.assistant as Msg]);
      follow((data.assistant as Msg).id, 0);
    },
    [running, follow]
  );

  const stop = useCallback(() => {
    const live = messages.find((m) => m.role === "assistant" && m.status === "running");
    if (live) void fetch(`/api/assistant/${live.id}/stop`, { method: "POST" });
  }, [messages]);

  const reset = useCallback(async () => {
    followRef.current?.abort.abort();
    followRef.current = null;
    const res = await fetch("/api/assistant", { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      setMessages([]);
      setSendError("");
      setAiLimited(false);
    }
  }, []);

  // ── The deck side: act on the deck on screen, or ask which deck.
  const noPool = useMemo<PoolEntry[]>(() => [], []);
  const noOwned = useMemo<string[]>(() => [], []);
  const onPoolChanged = useCallback(() => focusRef.current?.onPoolChanged(), []);
  const onPickDeck = useCallback((name: string, rect: DOMRect) => {
    setMenu({ name, rect });
    // The deck list, fresh: a reply may just have made one.
    void fetch("/api/decks", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { publicId: string; name: string }[]) => setDecks(list.map((d) => ({ publicId: d.publicId, name: d.name }))))
      .catch(() => {});
  }, []);
  const actions = useDeckActions({
    deckId: focus?.publicId ?? null,
    pool: focus?.pool ?? noPool,
    ownedNames: focus?.ownedNames ?? noOwned,
    onPoolChanged,
    messages,
    streaming: running,
    onPickDeck,
  });

  async function addTo(deck: AssistantDeckRef, name: string) {
    setMenu(null);
    setToast(`Adding ${name} to ${deck.name}…`);
    const r = await resolveAndAdd(deck.publicId, name, 1, new Map());
    setToast(r === "added" ? `Added ${name} to ${deck.name}’s pool.` : r === "notfound" ? `Scryfall doesn’t know “${name}”.` : `Couldn’t add ${name}.`);
    if (r === "added") window.dispatchEvent(new Event(DECKS_CHANGED_EVENT));
    setTimeout(() => setToast(""), 2600);
  }

  const chat: DeckChatController = {
    ...actions,
    error: sendError || actions.error,
    aiLimited: aiLimited && Boolean(sendError),
    dismissError: () => {
      setSendError("");
      setAiLimited(false);
      actions.setError("");
    },
    messages,
    input,
    setInput,
    streaming: running,
    send: (t) => void send(t),
    stop,
  };

  const setFocus = useCallback((f: AssistantFocus | null) => setFocusState(f), []);
  const availableRef = useRef(available);
  availableRef.current = available;
  const open = useCallback(() => {
    // Signed in since the page loaded: find out first.
    if (availableRef.current !== true) void load();
    setIsOpen(true);
    setUnseen(false);
  }, [load]);
  const refresh = useCallback(() => void load(), [load]);
  const close = useCallback(() => {
    setIsOpen(false);
    setMenu(null);
  }, []);
  const api = useMemo(() => ({ available, isOpen, open, close, refresh, setFocus }), [available, isOpen, open, close, refresh, setFocus]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {available && isOpen && (
        <AssistantScreen
          title={focus ? `Ask the AI · ${focus.name}` : "Ask the AI"}
          subtitle={focus ? "This deck, and all your others." : "Sees all your decks and your collection."}
          onClose={close}
          onNew={messages.length ? () => void reset() : undefined}
          newDisabled={running}
        >
          <DeckChat
            chat={chat}
            fill
            starters={focus ? DECK_STARTERS : HOME_STARTERS}
            intro={
              focus ? undefined : (
                <>Ask across <b style={{ color: "var(--text)" }}>all your decks</b> and your collection. It can build decks, edit them and save versions.</>
              )
            }
          />
        </AssistantScreen>
      )}
      {available && isOpen && menu &&
        createPortal(<AddMenu name={menu.name} rect={menu.rect} decks={decks} onPick={(d) => void addTo(d, menu.name)} onClose={() => setMenu(null)} />, document.body)}
      {available && isOpen && toast && (
        <div role="status" style={{ position: "fixed", left: "50%", bottom: "max(84px, calc(env(safe-area-inset-bottom) + 76px))", transform: "translateX(-50%)", zIndex: 92, background: "var(--text)", color: "var(--bg)", padding: "9px 16px", borderRadius: 999, fontSize: 13.5, fontWeight: 600, boxShadow: "0 10px 24px -8px rgba(0,0,0,.4)" }}>
          {toast}
        </div>
      )}
      {/* Closed, but the assistant is working (or has finished): a way back. */}
      {available && !isOpen && (running || unseen) && (
        <button
          type="button"
          onClick={open}
          style={{
            position: "fixed",
            right: 16,
            bottom: "max(16px, env(safe-area-inset-bottom))",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 999,
            border: "none",
            background: "var(--accent)",
            color: "var(--accent-ink)",
            fontFamily: "var(--font-ui)",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 12px 28px -10px rgba(0,0,0,.5)",
            animation: "sp-fade .15s ease",
          }}
        >
          <Sparkles size={16} strokeWidth={2.25} style={running ? { animation: "mn-blink 1.1s infinite" } : undefined} />
          {running ? "AI is answering…" : "AI answer ready"}
        </button>
      )}
    </Ctx.Provider>
  );
}
