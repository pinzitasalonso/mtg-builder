"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, Shuffle, Swords } from "lucide-react";
import type { CommanderLevel } from "@/app/api/practice/commander/route";
import type { CommanderHit } from "@/app/api/practice/commanders/route";
import type { OpponentOption, OpponentsAnswer } from "@/app/api/practice/opponents/route";
import { ColorPips } from "@/components/mtg";

/* Who to play against. Every opponent is a tile with a card's art and its
   colours, in tabs: a few commanders many people play (for a Commander deck,
   at its bracket), any commander you search for, the format's tournament
   decks, and your own decks. The opponents you played lately are on top.

   Picking a tile doesn't start the game: it goes to the bar at the bottom,
   which says what you'd face (and, for a commander, at which bracket) and has
   the Play button. A free account has one game a day, so the bar says so
   before it's spent. */

type TabId = "suggested" | "search" | "tournament" | "mine";
/** Suggestions shown at a time; "Show others" turns the page. */
const PAGE = 8;

interface LevelsState {
  busy: boolean;
  error: string;
  levels: CommanderLevel[];
  decks: number;
}

const sameOption = (a: OpponentOption | null, b: OpponentOption) =>
  !!a && a.kind === b.kind && a.deck === b.deck && a.archetype === b.archetype && (a.commander ?? "").toLowerCase() === (b.commander ?? "").toLowerCase();

export default function OpponentPicker({
  deckId,
  starting,
  error,
  onStart,
  onSolo,
}: {
  deckId: string;
  /** The game is loading: nothing can be picked. */
  starting: boolean;
  /** Why the last start failed. */
  error: string;
  onStart: (option: OpponentOption) => void;
  onSolo: () => void;
}) {
  const [data, setData] = useState<OpponentsAnswer | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<TabId | null>(null);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<OpponentOption | null>(null);
  const [levels, setLevels] = useState<LevelsState | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  // The opponents. Tournament pictures come in behind the first answer
  // (each needs its list from MTGTop8): ask again while they do.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = (tries: number) => {
      fetch(`/api/practice/opponents?deck=${encodeURIComponent(deckId)}`)
        .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
        .then(({ ok, body }) => {
          if (!live) return;
          if (!ok || !body?.tabs) {
            if (tries === 0) setLoadError(body?.error ?? "Couldn't load the opponents.");
            return;
          }
          const answer = body as OpponentsAnswer;
          setData(answer);
          setTab((t) => t ?? answer.tabs[0]?.id ?? "mine");
          if (answer.more && tries < 8) timer = setTimeout(() => load(tries + 1), 4000);
        })
        .catch(() => live && tries === 0 && setLoadError("Couldn't load the opponents."));
    };
    load(0);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [deckId]);

  /** A tile picked: it goes to the bar. A commander's brackets are looked
      up (which have decks on EDHREC), and the deck's own picked first. */
  async function pick(option: OpponentOption) {
    if (starting) return;
    setPicked(option);
    setLevels(null);
    setLevel(option.level ?? null);
    if (option.kind !== "edhrec" || !option.commander) return;
    setLevels({ busy: true, error: "", levels: [], decks: 0 });
    const res = await fetch(`/api/practice/commander?name=${encodeURIComponent(option.commander)}`).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    if (!alive.current) return;
    // Another tile was picked meanwhile: this answer isn't its.
    let current = true;
    setPicked((p) => ((current = sameOption(p, option)), p));
    if (!current) return;
    if (!res?.ok || !body?.commander) {
      setLevels({ busy: false, error: body?.error ?? "Couldn't look that commander up. Try again.", levels: [], decks: 0 });
      return;
    }
    const found = body as { commander: string; decks: number; levels: CommanderLevel[] };
    setLevels({ busy: false, error: "", levels: found.levels, decks: found.decks });
    setLevel(option.level && found.levels.some((l) => l.level === option.level) ? option.level : (found.levels.find((l) => l.bracket === data?.bracket)?.level ?? null));
    setPicked((p) => (p && sameOption(p, option) ? { ...p, commander: found.commander, label: found.commander } : p));
  }

  const tabs = useMemo(() => {
    if (!data) return [];
    const list: { id: TabId; title: string }[] = data.tabs.map((t) => ({ id: t.id, title: t.title }));
    // Any commander: after the suggestions, before the tournament decks.
    if (data.commanderGame) list.splice(list[0]?.id === "suggested" ? 1 : 0, 0, { id: "search", title: "Any commander" });
    return list;
  }, [data]);
  const current = data?.tabs.find((t) => t.id === tab) ?? null;
  const pages = current?.id === "suggested" ? Math.max(1, Math.ceil(current.options.length / PAGE)) : 1;
  const shown = current ? (current.id === "suggested" ? current.options.slice((page % pages) * PAGE, (page % pages) * PAGE + PAGE) : current.options) : [];

  const free = data?.free ?? null;
  const spent = !!free && free.left <= 0;
  const blocked = starting || spent || (picked?.kind === "edhrec" && (!levels || levels.busy || !!levels.error));
  const play = () => {
    if (!picked || blocked) return;
    onStart(picked.kind === "edhrec" ? { ...picked, level, detail: picked.detail || "EDHREC average deck" } : picked);
  };

  return (
    <div className="pk">
      <div className="pk-scroll">
        <div className="pk-inner">
          <div className="pk-head">
            <h2 className="id-display pk-title">Pick an opponent</h2>
            {free && (
              <span className="pk-free" data-spent={spent || undefined}>
                {spent ? "Today’s free game is used" : `${free.left} free ${free.left === 1 ? "game" : "games"} today`}
              </span>
            )}
          </div>
          <p className="pt-pick-note">The AI pilots a real deck against yours. You play your side by hand; it plays lands, casts what it can pay for, attacks and blocks.</p>
          {spent && <p className="pt-pick-note pk-spent">A free account plays one game against the AI a day. It’s back tomorrow, and unlimited with Spellpool Pro in the iOS app.</p>}
          {(error || loadError) && (
            <p className="pt-pick-error" role="alert">
              {error || loadError}
            </p>
          )}

          {!data && !loadError && (
            <div className="pt-pick-wait">
              <Loader2 size={18} className="spin" /> Finding opponents…
            </div>
          )}

          {data && (
            <>
              {data.recent.length > 0 && (
                <section className="pk-recent" aria-label="Play again">
                  <span className="pt-zone-label">Play again</span>
                  <div className="pk-recent-row">
                    {data.recent.map((o) => (
                      <button key={`${o.kind}:${o.deck ?? o.archetype ?? o.commander}`} type="button" className="pk-chip" aria-pressed={sameOption(picked, o)} disabled={starting} onClick={() => void pick(o)}>
                        <Art src={o.image} className="pk-chip-art" />
                        <span className="pk-chip-label">{o.label}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <div className="pk-tabs" role="tablist" aria-label="Opponents">
                {tabs.map((t) => (
                  <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="pk-tab" onClick={() => setTab(t.id)}>
                    {t.title}
                  </button>
                ))}
              </div>

              {tab === "search" ? (
                <CommanderSearch disabled={starting} picked={picked} onPick={(o) => void pick(o)} />
              ) : current ? (
                <div role="tabpanel">
                  <p className="pk-note">{current.note}</p>
                  <div className="pk-grid">
                    {shown.map((o) => (
                      <Tile key={`${o.kind}:${o.deck ?? o.archetype ?? o.commander}`} option={o} on={sameOption(picked, o)} disabled={starting} onPick={() => void pick(o)} />
                    ))}
                  </div>
                  {current.id === "suggested" && current.options.length > 1 && (
                    <div className="pk-more">
                      {pages > 1 && (
                        <button type="button" className="pt-btn" onClick={() => setPage((p) => (p + 1) % pages)}>
                          Show others
                        </button>
                      )}
                      <button type="button" className="pt-btn" disabled={starting} onClick={() => void pick(current.options[Math.floor(Math.random() * current.options.length)]!)}>
                        <Shuffle size={14} /> Surprise me
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </>
          )}

          <button type="button" className="pt-btn pk-solo" onClick={onSolo}>
            Play alone instead
          </button>
        </div>
      </div>

      {/* The opponent picked, and Play. */}
      {picked && (
        <div className="pk-bar" role="region" aria-label="Your opponent">
          <div className="pk-bar-inner">
            <Art src={picked.image} className="pk-bar-art" />
            <div className="pk-bar-text">
              <div className="pk-bar-name">
                <span>{picked.label}</span>
                {typeof picked.colors === "string" && <ColorPips colors={[...picked.colors]} size={15} />}
              </div>
              <div className="pk-bar-detail">
                {picked.kind === "edhrec"
                  ? levels?.busy
                    ? "Looking it up on EDHREC…"
                    : levels?.error
                      ? levels.error
                      : "Plays EDHREC’s average deck: the cards most of its decks run."
                  : picked.detail}
              </div>
              {picked.kind === "edhrec" && levels && !levels.busy && !levels.error && (
                <div className="pk-levels" role="radiogroup" aria-label="Power level">
                  <button type="button" role="radio" aria-checked={level === null} className="pk-level" onClick={() => setLevel(null)}>
                    Any bracket
                  </button>
                  {levels.levels.map((l) => (
                    <button key={l.level} type="button" role="radio" aria-checked={level === l.level} className="pk-level" onClick={() => setLevel(l.level)} title={`${l.decks.toLocaleString("en-US")} ${l.decks === 1 ? "deck" : "decks"} on EDHREC`}>
                      {l.bracket} · {l.label}
                      {l.bracket === data?.bracket ? " (yours)" : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="pk-bar-go">
              <button type="button" className="pt-btn pt-btn-gold pk-play" disabled={blocked} onClick={play}>
                {starting ? <Loader2 size={16} className="spin" /> : <Swords size={16} />} {starting ? "Shuffling up…" : "Play"}
              </button>
              {free && !spent && <span className="pk-bar-free">Uses today’s free game</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A card's art, or nothing where there's none (or it didn't load). */
function Art({ src, className }: { src?: string | null; className: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={className} aria-hidden="true">
      {src && !failed && <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />}
    </span>
  );
}

function Tile({ option, on, disabled, onPick }: { option: OpponentOption; on: boolean; disabled: boolean; onPick: () => void }) {
  return (
    <button type="button" className="pk-tile" aria-pressed={on} disabled={disabled} onClick={onPick}>
      <Art src={option.image} className="pk-tile-art" />
      {typeof option.colors === "string" && (
        <span className="pk-tile-pips">
          <ColorPips colors={[...option.colors]} size={15} />
        </span>
      )}
      <span className="pk-tile-text">
        <span className="pk-tile-label">{option.label}</span>
        <span className="pk-tile-detail">{option.detail}</span>
      </span>
    </button>
  );
}

/* Any commander: type a name, get the commanders it could be (only cards
   that can be one), the most played first, each with its art. Enter takes
   the first; the arrows move through them. */
function CommanderSearch({ disabled, picked, onPick }: { disabled: boolean; picked: OpponentOption | null; onPick: (o: OpponentOption) => void }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ busy: boolean; error: string; hits: CommanderHit[] | null }>({ busy: false, error: "", hits: null });
  const [active, setActive] = useState(0);

  useEffect(() => {
    const typed = q.trim();
    if (typed.length < 2) {
      setState({ busy: false, error: "", hits: null });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, busy: true, error: "" }));
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/practice/commanders?q=${encodeURIComponent(typed)}`, { signal: ctrl.signal });
        const body = await res.json().catch(() => null);
        if (ctrl.signal.aborted) return;
        if (!res.ok) setState({ busy: false, error: body?.error ?? "Couldn't search right now. Try again.", hits: null });
        else {
          setState({ busy: false, error: "", hits: Array.isArray(body?.hits) ? body.hits : [] });
          setActive(0);
        }
      } catch {
        if (!ctrl.signal.aborted) setState({ busy: false, error: "Couldn't search right now. Try again.", hits: null });
      }
    }, 240);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [q]);

  const asOption = (h: CommanderHit): OpponentOption => ({ kind: "edhrec", commander: h.name, level: null, label: h.name, detail: "EDHREC average deck", image: h.image, colors: h.colors });
  const hits = state.hits ?? [];

  return (
    <div role="tabpanel">
      <p className="pk-note">Any commander, playing EDHREC’s average deck for it. You pick the bracket next.</p>
      <label className="pk-search">
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && hits.length) {
              e.preventDefault();
              setActive((a) => (a + 1) % hits.length);
            } else if (e.key === "ArrowUp" && hits.length) {
              e.preventDefault();
              setActive((a) => (a - 1 + hits.length) % hits.length);
            } else if (e.key === "Enter" && hits[active] && !disabled) {
              e.preventDefault();
              onPick(asOption(hits[active]!));
            }
          }}
          placeholder="Search for a commander…"
          aria-label="Search for a commander"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        {state.busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
      </label>
      {state.error && (
        <p className="pt-pick-error" role="alert" style={{ marginTop: 10 }}>
          {state.error}
        </p>
      )}
      {state.hits && !hits.length && !state.busy && <p className="pk-note" style={{ marginTop: 12 }}>No commander has that in its name.</p>}
      {hits.length > 0 && (
        <ul className="pk-hits" role="listbox" aria-label="Commanders">
          {hits.map((h, i) => {
            const option = asOption(h);
            return (
              <li key={h.name} role="option" aria-selected={sameOption(picked, option)}>
                <button type="button" className="pk-hit" data-active={i === active || undefined} disabled={disabled} onClick={() => onPick(option)} onMouseEnter={() => setActive(i)}>
                  <Art src={h.image} className="pk-hit-art" />
                  <span className="pk-hit-text">
                    <span className="pk-hit-name">{h.name}</span>
                    {h.typeLine && <span className="pk-hit-type">{h.typeLine}</span>}
                  </span>
                  {typeof h.colors === "string" && <ColorPips colors={[...h.colors]} size={15} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
