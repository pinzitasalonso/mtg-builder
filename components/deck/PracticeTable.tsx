"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Loader2, Swords, Undo2, X } from "lucide-react";
import CommanderInput from "@/components/CommanderInput";
import { CardArt } from "@/components/mtg";
import { ActionMenu, HandToggle, LifeCounter, Panel, PileZone, PtCard, RotateHint, ZoomPreview, type MenuState, type Zoom } from "@/components/deck/playtest-parts";
import { bottomCard, draw, mulligan, turnOver, type PlayCard, type Zone } from "@/lib/playtest";
import { aiMulligan, chooseBlocks, fallbackPlan } from "@/lib/practice/ai";
import { infoOf, isCreature, isLand, stats } from "@/lib/practice/cards";
import {
  adjustLife,
  aiResponds,
  applyAction,
  canAttack,
  canBlock,
  declareAttackers,
  endTurn,
  findCard,
  moveAnyCard,
  newGame,
  parseCardId,
  playerPlay,
  resolveCombat,
  setBlocks,
  startTurn,
  tapToggle,
  withYourSide,
  type DeckCard,
} from "@/lib/practice/game";
import type { CardBook, PlanAction, PracticeGame, Seat, TurnPlan } from "@/lib/practice/types";

/* A practice game against the AI (docs/practice-vs-ai.md): your deck
   against a real one the AI pilots. You play your side by hand, as on the
   solo table; the opponent's turns come from /api/practice/<id>/turn and are
   played out here by the engine, which checks every move. */

interface OpponentOption {
  kind: "mtgtop8" | "deck" | "edhrec";
  format?: string;
  archetype?: string;
  deck?: string;
  /** edhrec: the commander, and the bracket's page (null: all decks). */
  commander?: string;
  level?: string | null;
  label: string;
  detail: string;
}
/** A commander EDHREC has decks for (/api/practice/commander). */
interface CommanderInfo {
  commander: string;
  decks: number;
  levels: { level: string; bracket: number; label: string; decks: number }[];
}
interface Setup {
  id: string;
  commanderGame: boolean;
  book: CardBook;
  you: { label: string; cards: DeckCard[]; commander: string | null };
  opp: { label: string; detail: string; cards: DeckCard[]; commander: string | null };
}
type Mode = "pick" | "loading" | "mulligan" | "main" | "attack" | "combat" | "ai" | "block" | "over";
type Step = (g: PracticeGame) => PracticeGame;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The pause between the opponent's moves, so you can follow them.
const BEAT = 700;

export default function PracticeTable({ deckId, onClose, onSolo }: { deckId: string; onClose: () => void; onSolo: () => void }) {
  const [mode, setMode] = useState<Mode>("pick");
  const [groups, setGroups] = useState<{ title: string; options: OpponentOption[] }[] | null>(null);
  // Any commander, from EDHREC: shown for Commander decks.
  const [cmdrPick, setCmdrPick] = useState<{ bracket: number | null } | null>(null);
  const [cmdrName, setCmdrName] = useState("");
  const [cmdr, setCmdr] = useState<CommanderInfo | null>(null);
  const [cmdrLevel, setCmdrLevel] = useState<string | null>(null);
  const [cmdrState, setCmdrState] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });
  const [error, setError] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [game, setGame] = useState<PracticeGame | null>(null);
  const [history, setHistory] = useState<PracticeGame[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [blocks, setBlocksState] = useState<Record<number, number[]>>({});
  const [blocker, setBlocker] = useState<number | null>(null);
  const [say, setSay] = useState("");
  const [aiNote, setAiNote] = useState("");
  const [menu, setMenu] = useState<(MenuState & { seat: Seat }) | null>(null);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const [pile, setPile] = useState<{ seat: Seat; zone: "graveyard" | "exile" | "library" } | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  // A phone held sideways: whether the hand is raised over the board.
  const [handUp, setHandUp] = useState(false);
  const lastOpponent = useRef<OpponentOption | null>(null);
  const afterCombatPlan = useRef<PlanAction[]>([]);
  const sideLog = useRef<HTMLOListElement>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  const book = setup?.book ?? {};

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => void (document.body.style.overflow = prev);
  }, []);

  // Who can we play? Tournament decks and your own.
  useEffect(() => {
    let live = true;
    fetch(`/api/practice/opponents?deck=${encodeURIComponent(deckId)}`)
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => null) }))
      .then(({ ok, data }) => {
        if (!live) return;
        if (!ok) setError(data?.error ?? "Couldn't load the opponents.");
        else {
          setGroups(data.groups);
          if (data.commanderGame) setCmdrPick({ bracket: typeof data.bracket === "number" ? data.bracket : null });
        }
      })
      .catch(() => live && setError("Couldn't load the opponents."));
    return () => void (live = false);
  }, [deckId]);

  useEffect(() => {
    if (game?.winner) setMode("over");
  }, [game?.winner]);

  // The history beside the board follows the newest line.
  const logLength = game?.log.length ?? 0;
  useEffect(() => {
    const el = sideLog.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logLength]);

  /** Does EDHREC have decks for this commander, and at which brackets?
      The one matching your deck's Score bracket is picked first. */
  async function findCommander(name: string) {
    const q = name.trim();
    if (!q) return;
    setCmdr(null);
    setCmdrState({ busy: true, error: "" });
    const res = await fetch(`/api/practice/commander?name=${encodeURIComponent(q)}`).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (!alive.current) return;
    if (!res?.ok || !data?.commander) {
      setCmdrState({ busy: false, error: data?.error ?? "Couldn't look that commander up. Try again." });
      return;
    }
    const info = data as CommanderInfo;
    setCmdr(info);
    setCmdrLevel(info.levels.find((l) => l.bracket === cmdrPick?.bracket)?.level ?? null);
    setCmdrState({ busy: false, error: "" });
  }

  // ── Game flow ─────────────────────────────────────────────────────────

  async function start(option: OpponentOption) {
    setMode("loading");
    setError("");
    const res = await fetch("/api/practice/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deck: deckId, opponent: option }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (!alive.current) return;
    if (!res?.ok || !data?.id) {
      setError(data?.error ?? "Couldn't start the game. Try again.");
      setMode("pick");
      return;
    }
    lastOpponent.current = option;
    const s = data as Setup;
    let g = newGame({
      you: { cards: s.you.cards, commander: s.you.commander },
      opp: { cards: s.opp.cards, commander: s.opp.commander },
      commanderGame: s.commanderGame,
      first: Math.random() < 0.5 ? "you" : "opp",
    });
    const opp = aiMulligan(g.sides.opp, s.book);
    g = { ...g, sides: { ...g.sides, opp }, log: opp.mulligans ? [...g.log, { seat: "opp", text: "The opponent mulligans to six." }] : g.log };
    setSetup(s);
    setGame(g);
    setHistory([]);
    setSay("");
    setAiNote("");
    setPicked([]);
    setMode("mulligan");
  }

  const act = (step: Step) => {
    if (!game) return;
    setMenu(null);
    setZoom(null);
    const next = step(game);
    if (next === game) return;
    setHistory((h) => [...h.slice(-49), game]);
    setGame(next);
  };
  /** You cast a card: the AI may counter it on the spot. */
  const castStep =
    (iid: number): Step =>
    (g) => {
      const played = playerPlay(g, iid);
      if (played === g) return g;
      const answered = aiResponds(played, iid, book);
      if (answered !== played) {
        setSay("Not so fast.");
        setAiNote("");
      }
      return answered;
    };
  const cast = (iid: number) => act(castStep(iid));
  const undo = () => {
    if (!history.length) return;
    setGame(history[history.length - 1]!);
    setHistory((h) => h.slice(0, -1));
  };

  function keep() {
    if (!game || game.sides.you.toBottom > 0) return;
    const g = startTurn(game);
    setGame(g);
    setHistory([]);
    if (g.active === "opp") void runAi(g);
    else setMode("main");
  }

  function endMyTurn() {
    if (!game) return;
    const g = endTurn(game);
    setGame(g);
    if (!g.winner) void runAi(g);
  }

  async function runAi(g0: PracticeGame) {
    if (!setup) return;
    setMode("ai");
    setHistory([]);
    setSay("");
    setAiNote("");
    let g = g0;
    let plan: TurnPlan;
    try {
      const res = await fetch(`/api/practice/${setup.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: g }),
        signal: AbortSignal.timeout(115_000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.plan) throw new Error(`server ${res.status}`);
      plan = data.plan as TurnPlan;
      if (data.note) setAiNote(data.note);
    } catch (e) {
      plan = fallbackPlan(g, setup.book);
      const why = e instanceof DOMException && e.name === "TimeoutError" ? "no answer in time" : e instanceof Error && e.message.startsWith("server") ? e.message : "offline";
      setAiNote(`The opponent played on instinct this turn (${why}).`);
    }
    if (!alive.current) return;
    if (plan.say) setSay(plan.say);
    for (const a of plan.main) {
      g = applyAction(g, "opp", a, setup.book).game;
      setGame(g);
      await sleep(BEAT);
      if (!alive.current || g.winner) return;
    }
    const attackers = plan.attack.map(parseCardId).filter((n): n is number => n !== null);
    if (attackers.length) {
      const declared = declareAttackers(g, "opp", attackers, setup.book);
      if (declared.combat) {
        setGame(declared);
        afterCombatPlan.current = plan.after_combat;
        setBlocksState({});
        setBlocker(null);
        setMode("block");
        return;
      }
    }
    await afterCombat(g, plan.after_combat);
  }

  async function confirmBlocks(chosen: Record<number, number[]>) {
    if (!game || !setup) return;
    let g = setBlocks(game, chosen, setup.book);
    setGame(g);
    setMode("ai");
    await sleep(BEAT);
    g = resolveCombat(g, setup.book);
    setGame(g);
    if (g.winner) return;
    await sleep(BEAT);
    await afterCombat(g, afterCombatPlan.current);
  }

  async function afterCombat(g0: PracticeGame, actions: PlanAction[]) {
    if (!setup) return;
    let g = g0;
    for (const a of actions) {
      g = applyAction(g, "opp", a, setup.book).game;
      setGame(g);
      await sleep(BEAT);
      if (!alive.current || g.winner) return;
    }
    g = endTurn(g);
    setGame(g);
    setHistory([]);
    setMode(g.winner ? "over" : "main");
  }

  async function attack() {
    if (!game || !setup || !picked.length) {
      setMode("main");
      return;
    }
    let g = declareAttackers(game, "you", picked, setup.book);
    setPicked([]);
    if (!g.combat) {
      setMode("main");
      return;
    }
    g = setBlocks(g, chooseBlocks(g, setup.book), setup.book);
    setGame(g);
    setHistory([]);
    setMode("combat");
    await sleep(1400);
    if (!alive.current) return;
    g = resolveCombat(g, setup.book);
    setGame(g);
    setMode(g.winner ? "over" : "main");
  }

  // ── Card clicks and menus ─────────────────────────────────────────────

  const yours = (iid: number) => !!game?.sides.you.battlefield.some((c) => c.iid === iid);
  const onPrimary = (card: PlayCard, zone: Zone, anchor: DOMRect) => {
    if (!game || !setup) return;
    const at = findCard(game, card.iid);
    if (!at) return;
    const seat = at.seat;
    if (seat === "you" && zone === "hand") {
      if (mode === "mulligan" && game.sides.you.toBottom > 0) act((g) => withYourSide(g, (s) => bottomCard(s, card.iid)));
      else if (mode === "main") {
        setHandUp(false);
        cast(card.iid);
      }
      return;
    }
    if (seat === "you" && zone === "command" && mode === "main") return cast(card.iid);
    if (seat === "you" && zone === "battlefield") {
      if (mode === "attack") {
        if (canAttack(game, "you", card, setup.book)) setPicked((p) => (p.includes(card.iid) ? p.filter((x) => x !== card.iid) : [...p, card.iid]));
        return;
      }
      if (mode === "block") {
        if (isCreature(setup.book, card) && !card.tapped) setBlocker((b) => (b === card.iid ? null : card.iid));
        return;
      }
      if (mode === "main") act((g) => tapToggle(g, card.iid));
      return;
    }
    if (seat === "opp" && zone === "battlefield" && mode === "block" && game.combat?.attackers.includes(card.iid)) {
      if (blocker === null) return;
      const b = game.sides.you.battlefield.find((c) => c.iid === blocker);
      if (!b || !canBlock(setup.book, b, card)) return;
      setBlocksState((prev) => {
        const next: Record<number, number[]> = {};
        for (const [a, bs] of Object.entries(prev)) next[Number(a)] = bs.filter((x) => x !== blocker);
        next[card.iid] = [...(next[card.iid] ?? []), blocker];
        return next;
      });
      setBlocker(null);
      return;
    }
    setMenu({ card, zone, anchor, seat });
  };
  const openMenu = (anchor: DOMRect, card: PlayCard, zone: Zone) => {
    const at = game && findCard(game, card.iid);
    if (at) setMenu({ card, zone, anchor, seat: at.seat });
  };
  const onZoom = (card: PlayCard | null, zone?: Zone, anchor?: DOMRect) => setZoom(card && zone && anchor ? { card, zone, anchor } : null);
  const onTurn = (card: PlayCard) => act((g) => (findCard(g, card.iid)?.seat === "you" ? withYourSide(g, (s) => turnOver(s, card.iid)) : g));

  const optionsFor = (card: PlayCard, zone: Zone, seat: Seat): { label: string; step: Step }[] => {
    const to = (z: Zone, bottom = false): Step => (g) => moveAnyCard(g, card.iid, z, { bottom });
    if (seat === "opp") {
      if (zone !== "battlefield") return [];
      return [
        { label: card.tapped ? "Untap" : "Tap", step: (g) => tapToggle(g, card.iid) },
        { label: "Destroy", step: to("graveyard") },
        { label: "Exile", step: to("exile") },
        { label: "Return to its owner's hand", step: to("hand") },
      ];
    }
    const out: { label: string; step: Step }[] = [];
    if (zone === "hand" || zone === "command") out.push({ label: "Play", step: castStep(card.iid) });
    if (zone === "battlefield") out.push({ label: card.tapped ? "Untap" : "Tap", step: (g) => tapToggle(g, card.iid) });
    if (zone !== "battlefield" && zone !== "hand") out.push({ label: "Put onto battlefield", step: to("battlefield") });
    if (zone !== "hand") out.push({ label: "Return to hand", step: to("hand") });
    if (zone !== "graveyard") out.push({ label: zone === "hand" ? "Discard" : "Graveyard", step: to("graveyard") });
    if (zone !== "exile") out.push({ label: "Exile", step: to("exile") });
    out.push({ label: "Top of library", step: to("library") });
    out.push({ label: "Bottom of library", step: to("library", true) });
    if (card.commander && zone !== "command") out.push({ label: "Command zone", step: to("command") });
    return out;
  };

  // ── What a card shows ─────────────────────────────────────────────────

  const badgeOf = (card: PlayCard): string | undefined => {
    if (!game) return undefined;
    const c = game.combat;
    if (c?.attackers.includes(card.iid)) return "Attacking";
    if (c) {
      for (const [a, bs] of Object.entries(c.blocks)) if (bs.includes(card.iid)) return `Blocks ${findCard(game, Number(a))?.card.name ?? ""}`;
    }
    if (mode === "block") {
      for (const [a, bs] of Object.entries(blocks)) if (bs.includes(card.iid)) return `Blocks ${findCard(game, Number(a))?.card.name ?? ""}`;
    }
    return undefined;
  };
  const statOf = (card: PlayCard): string | null => {
    if (!isCreature(book, card)) return null;
    const s = stats(book, card);
    const info = infoOf(book, card);
    const changed = card.token || card.counters || card.pump || info?.power !== s.power || info?.toughness !== s.toughness;
    if (!changed && !card.damage) return null;
    return `${s.power}/${s.toughness}${card.damage ? ` · ${card.damage} dmg` : ""}`;
  };
  const cardProps = (seat: Seat) => (card: PlayCard, zone: Zone) => ({
    card,
    zone,
    onPrimary,
    onMenu: openMenu,
    onZoom,
    onTurn,
    badge: zone === "battlefield" ? badgeOf(card) : undefined,
    stat: zone === "battlefield" ? statOf(card) : null,
    selected:
      (seat === "you" && mode === "attack" && picked.includes(card.iid)) ||
      (seat === "you" && mode === "block" && blocker === card.iid) ||
      (seat === "opp" && mode === "block" && blocker !== null && !!game?.combat?.attackers.includes(card.iid)),
  });

  // ── Screens ───────────────────────────────────────────────────────────

  const header = (
    <header className="pt-top">
      <div className="pt-title">
        <span className="id-display" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 22, color: "#fff" }}>
          <Bot size={21} strokeWidth={2} /> vs AI
        </span>
        {setup && <span className="pt-sub">against {setup.opp.label}</span>}
      </div>
      <div className="pt-top-right">
        {game && (
          <>
            <span className="pt-turn">Turn {game.turn}</span>
            <LifeCounter label="Opp" value={game.sides.opp.life} onDelta={(d) => act((g) => adjustLife(g, "opp", d, book))} />
            <LifeCounter label="You" value={game.sides.you.life} onDelta={(d) => act((g) => adjustLife(g, "you", d, book))} />
          </>
        )}
        <button type="button" className="pt-btn pt-wide-only" onClick={onSolo}>
          Solo
        </button>
        <button type="button" className="pt-btn" onClick={onClose} aria-label="Close playtest">
          <X size={14} strokeWidth={2.5} /> <span className="pt-btn-label">Close</span>
        </button>
      </div>
    </header>
  );

  if (mode === "pick" || mode === "loading" || !game || !setup) {
    return (
      <div className="pt-root" role="dialog" aria-label="Play against the AI">
        {header}
        <div className="pt-pick">
          <h2 className="id-display" style={{ margin: "0 0 6px", fontSize: 26, color: "#fff" }}>Pick an opponent</h2>
          <p className="pt-pick-note">
            The AI pilots a real deck against yours. You play your side by hand; it plays lands, casts what it can pay for, attacks and blocks.
          </p>
          {error && <p className="pt-pick-error">{error}</p>}
          {mode === "loading" ? (
            <div className="pt-pick-wait">
              <Loader2 size={18} className="spin" /> Shuffling up…
            </div>
          ) : !groups && !error ? (
            <div className="pt-pick-wait">
              <Loader2 size={18} className="spin" /> Finding opponents…
            </div>
          ) : (
            <>
              {cmdrPick && (
                <section className="pt-pick-group">
                  <div className="pt-zone-label">Any commander (EDHREC)</div>
                  <div className="pt-foe">
                    <CommanderInput
                      value={cmdrName}
                      onChange={(v) => {
                        setCmdrName(v);
                        if (cmdr) setCmdr(null);
                      }}
                      onPick={(v) => void findCommander(v)}
                      placeholder="Search for a commander…"
                      className="pt-foe-input"
                    />
                    <button type="button" className="pt-btn" disabled={!cmdrName.trim() || cmdrState.busy} onClick={() => void findCommander(cmdrName)}>
                      {cmdrState.busy ? <Loader2 size={15} className="spin" /> : "Find"}
                    </button>
                  </div>
                  {cmdrState.error && <p className="pt-pick-error" style={{ margin: "8px 0 0" }}>{cmdrState.error}</p>}
                  {cmdr && (
                    <div className="pt-foe-found">
                      <p className="pt-pick-detail" style={{ margin: 0 }}>
                        The AI plays EDHREC&apos;s average {cmdr.commander} deck: the cards most of its decks run. Pick a power level.
                      </p>
                      <div className="pt-foe-levels" role="radiogroup" aria-label="Power level">
                        <button type="button" role="radio" aria-checked={cmdrLevel === null} className="pt-foe-level" onClick={() => setCmdrLevel(null)}>
                          <b>Any bracket</b>
                          {cmdr.decks > 0 && <span>{cmdr.decks.toLocaleString("en-US")} decks</span>}
                        </button>
                        {cmdr.levels.map((l) => (
                          <button
                            key={l.level}
                            type="button"
                            role="radio"
                            aria-checked={cmdrLevel === l.level}
                            className="pt-foe-level"
                            onClick={() => setCmdrLevel(l.level)}
                          >
                            <b>
                              {l.bracket} · {l.label}
                            </b>
                            <span>
                              {l.decks.toLocaleString("en-US")} {l.decks === 1 ? "deck" : "decks"}
                              {l.bracket === cmdrPick.bracket ? " · yours" : ""}
                            </span>
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="pt-btn pt-btn-gold"
                        onClick={() =>
                          void start({ kind: "edhrec", commander: cmdr.commander, level: cmdrLevel, label: cmdr.commander, detail: "EDHREC average deck" })
                        }
                      >
                        <Swords size={15} /> Play against {cmdr.commander}
                      </button>
                    </div>
                  )}
                </section>
              )}
              {(groups ?? []).map((grp) => (
              <section key={grp.title} className="pt-pick-group">
                <div className="pt-zone-label">{grp.title}</div>
                <div className="pt-pick-list">
                  {grp.options.map((o) => (
                    <button key={`${o.kind}:${o.archetype ?? o.deck}`} type="button" className="pt-pick-option" onClick={() => void start(o)}>
                      <span className="pt-pick-label">{o.label}</span>
                      <span className="pt-pick-detail">{o.detail}</span>
                    </button>
                  ))}
                </div>
              </section>
              ))}
            </>
          )}
          <button type="button" className="pt-btn" style={{ marginTop: 18 }} onClick={onSolo}>
            Back to the solo table
          </button>
        </div>
      </div>
    );
  }

  const you = game.sides.you;
  const opp = game.sides.opp;
  const yourTurn = game.active === "you";
  const row = (cards: PlayCard[], seat: Seat) => cards.map((c) => <PtCard key={c.iid} {...cardProps(seat)(c, "battlefield")} />);
  const lastLines = game.log.slice(-3);
  const recent = game.log.filter((l) => l.card).slice(-4).reverse();
  const blockCount = Object.values(blocks).reduce((n, b) => n + b.length, 0);
  const zoomLive = zoom !== null && !!findCard(game, zoom.card.iid);
  const pileCards = pile ? [...game.sides[pile.seat][pile.zone]].reverse() : [];

  const status =
    mode === "mulligan"
      ? you.toBottom > 0
        ? `Put ${you.toBottom} card${you.toBottom === 1 ? "" : "s"} from your hand on the bottom.`
        : `${game.first === "you" ? "You're" : "The opponent is"} on the play.`
      : mode === "attack"
        ? "Tap the creatures that attack."
        : mode === "block"
          ? blocker === null
            ? "Tap one of your creatures, then the attacker it blocks."
            : "Now tap the attacker it blocks."
          : mode === "ai"
            ? "The opponent is playing…"
            : mode === "combat"
              ? "Combat…"
              : mode === "over"
                ? game.winner === "you"
                  ? "You win!"
                  : "The opponent wins."
                : `Your turn · land drop ${game.landPlayed ? "used" : "available"}`;

  return (
    <div className="pt-root pt-vs pt-table" role="dialog" aria-label="Practice game against the AI">
      <RotateHint onClose={onClose} />
      {header}

      <div className="pt-tools">
        <div className="pt-tools-row">
          {mode === "mulligan" && (
            <>
              <button type="button" className="pt-btn pt-btn-gold" onClick={keep} disabled={you.toBottom > 0}>
                Keep
              </button>
              <button type="button" className="pt-btn" onClick={() => act((g) => withYourSide(g, (s) => mulligan(s)))} disabled={you.mulligans >= 6}>
                Mulligan{you.mulligans ? ` (${you.mulligans})` : ""}
              </button>
            </>
          )}
          {mode === "main" && yourTurn && (
            <>
              <button type="button" className="pt-btn pt-btn-gold" onClick={() => setMode("attack")} disabled={!you.battlefield.some((c) => canAttack(game, "you", c, book))}>
                <Swords size={14} strokeWidth={2.25} /> Attack
              </button>
              <button type="button" className="pt-btn" onClick={endMyTurn}>
                End turn
              </button>
              <button type="button" className="pt-btn" onClick={undo} disabled={!history.length} aria-label="Undo">
                <Undo2 size={14} strokeWidth={2.25} /> <span className="pt-btn-label">Undo</span>
              </button>
              <button type="button" className="pt-btn" onClick={() => act((g) => withYourSide(g, (s) => draw(s, 1)))} disabled={!you.library.length}>
                Draw
              </button>
            </>
          )}
          {mode === "attack" && (
            <>
              <button type="button" className="pt-btn pt-btn-gold" onClick={() => void attack()} disabled={!picked.length}>
                Attack with {picked.length}
              </button>
              <button type="button" className="pt-btn" onClick={() => (setPicked([]), setMode("main"))}>
                Cancel
              </button>
            </>
          )}
          {mode === "block" && (
            <>
              <button type="button" className="pt-btn pt-btn-gold" onClick={() => void confirmBlocks(blocks)}>
                {blockCount ? `Block with ${blockCount}` : "No blocks"}
              </button>
              {blockCount > 0 && (
                <button type="button" className="pt-btn" onClick={() => (setBlocksState({}), setBlocker(null))}>
                  Clear
                </button>
              )}
            </>
          )}
          {mode === "over" && (
            <>
              <button type="button" className="pt-btn pt-btn-gold" onClick={() => lastOpponent.current && void start(lastOpponent.current)}>
                Play again
              </button>
              <button type="button" className="pt-btn" onClick={() => (setGame(null), setSetup(null), setMode("pick"))}>
                Another opponent
              </button>
            </>
          )}
          {(mode === "ai" || mode === "combat") && (
            <span className="pt-thinking">
              <Loader2 size={14} className="spin" /> {mode === "ai" ? "Opponent's turn" : "Combat"}
            </span>
          )}
          <button type="button" className="pt-btn" onClick={() => setLogOpen(true)}>
            Log
          </button>
        </div>
        <span className="pt-status">{status}</span>
      </div>

      <div className="pt-main">
        <aside className="pt-zones">
          <div className="pt-zone">
            <div className="pt-zone-label">
              Library <span>{you.library.length}</span>
            </div>
            <div className="pt-pile pt-pile-library" role="button" tabIndex={0} onClick={() => setPile({ seat: "you", zone: "library" })}>
              <span className="pt-pile-count">{you.library.length}</span>
            </div>
          </div>
          <PileZone label="Graveyard" cards={you.graveyard} top={you.graveyard[you.graveyard.length - 1]} onOpen={() => setPile({ seat: "you", zone: "graveyard" })} />
          <PileZone label="Exile" cards={you.exile} top={you.exile[you.exile.length - 1]} onOpen={() => setPile({ seat: "you", zone: "exile" })} />
          {(game.commanderGame || you.command.length > 0) && (
            <div className="pt-zone">
              <div className="pt-zone-label">Command</div>
              {you.command.length ? you.command.map((c) => <PtCard key={c.iid} {...cardProps("you")(c, "command")} />) : <div className="pt-pile pt-pile-empty">—</div>}
            </div>
          )}
        </aside>

        <section className="pt-field pt-field-vs" onClick={() => setMenu(null)}>
          <div className="pt-opp">
            <div className="pt-opp-head">
              <span className="pt-opp-name">{setup.opp.label}</span>
              <span className="pt-opp-meta pt-meta">
                <span>Hand {opp.hand.length}</span>
                <span>Library {opp.library.length}</span>
                <span>
                  <button type="button" className="pt-link" onClick={() => setPile({ seat: "opp", zone: "graveyard" })}>
                    Graveyard {opp.graveyard.length}
                  </button>
                </span>
                {opp.exile.length > 0 && (
                  <span>
                    <button type="button" className="pt-link" onClick={() => setPile({ seat: "opp", zone: "exile" })}>
                      Exile {opp.exile.length}
                    </button>
                  </span>
                )}
                {game.commanderGame && <span>Commander damage to you {game.cmdDamage.you}</span>}
              </span>
            </div>
            {/* Its cards: rows down the board, or one sideways row on a phone held sideways. */}
            <div className="pt-side-cards">
              {opp.command.length > 0 && <div className="pt-row pt-opp-row">{opp.command.map((c) => <PtCard key={c.iid} {...cardProps("opp")(c, "command")} />)}</div>}
              <div className="pt-row pt-opp-row">{row(opp.battlefield.filter((c) => !isLand(c)), "opp")}</div>
              {opp.battlefield.some(isLand) && <div className="pt-row pt-opp-row pt-opp-lands">{row(opp.battlefield.filter(isLand), "opp")}</div>}
            </div>
          </div>

          <div className="pt-mid" aria-live="polite">
            {(say || aiNote) && (
              <div className="pt-say">
                <Bot size={14} strokeWidth={2.25} /> {say ? `“${say}”` : ""} {aiNote && <em>{aiNote}</em>}
              </div>
            )}
            {lastLines.map((l, i) => (
              <div key={`${game.log.length}-${i}`} className={`pt-logline${l.seat === "opp" ? " pt-logline-opp" : ""}`}>
                {l.text}
              </div>
            ))}
          </div>

          <div className="pt-mine">
            {/* On a phone the piles beside the board give way to this line. */}
            <div className="pt-you-head pt-meta">
              <span>
                <button type="button" className="pt-link" onClick={() => setPile({ seat: "you", zone: "library" })}>
                  Library {you.library.length}
                </button>
              </span>
              <span>
                <button type="button" className="pt-link" onClick={() => setPile({ seat: "you", zone: "graveyard" })}>
                  Graveyard {you.graveyard.length}
                </button>
              </span>
              <span>
                <button type="button" className="pt-link" onClick={() => setPile({ seat: "you", zone: "exile" })}>
                  Exile {you.exile.length}
                </button>
              </span>
              {game.commanderGame && <span>Commander damage to the opponent {game.cmdDamage.opp}</span>}
            </div>
            <div className="pt-side-cards">
              {you.command.length > 0 && <div className="pt-row pt-you-command">{you.command.map((c) => <PtCard key={c.iid} {...cardProps("you")(c, "command")} />)}</div>}
              <div className="pt-row pt-row-perms">{row(you.battlefield.filter((c) => !isLand(c)), "you")}</div>
              {you.battlefield.some(isLand) && <div className="pt-row pt-row-lands">{row(you.battlefield.filter(isLand), "you")}</div>}
            </div>
          </div>
        </section>

        {/* Beside the board, where there's room (a wide screen, a phone held
            sideways): the last spells cast, like the stack, and the game so far. */}
        <aside className="pt-side" aria-label="Last played, and the game so far">
          <div className="pt-zone-label">Last played</div>
          {recent.length ? (
            <div className="pt-side-stack">
              {recent.map((l, i) => {
                const at = findCard(game, l.card!.iid);
                return (
                  <button
                    key={`${game.log.length}-${i}`}
                    type="button"
                    className="pt-side-card"
                    data-seat={l.seat ?? undefined}
                    data-new={i === 0 ? "true" : undefined}
                    title={l.text}
                    aria-label={l.text}
                    onClick={(e) => at && onZoom(at.card, at.zone, e.currentTarget.getBoundingClientRect())}
                  >
                    <CardArt name={l.card!.name} src={l.card!.imageUri || undefined} prefer="src" version="normal" loading="lazy" radius={0} style={{ position: "absolute", inset: 0 }} />
                    <span className="pt-side-who">{/counters/.test(l.text) ? "Counter" : l.seat === "you" ? "You" : "Opp"}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="pt-side-empty">Spells show here as they&apos;re cast.</p>
          )}
          <div className="pt-zone-label">History</div>
          <ol className="pt-side-log" ref={sideLog}>
            {game.log.slice(-40).map((l, i) => (
              <li key={`${game.log.length}-${i}`} className={l.seat === "opp" ? "pt-logline-opp" : undefined}>
                {l.text}
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <footer className="pt-hand" style={{ ["--pt-hand" as string]: "var(--pt-hand-max)" }} data-up={handUp || mode === "mulligan" ? "true" : undefined}>
        {mode !== "mulligan" && <HandToggle up={handUp} count={you.hand.length} onToggle={setHandUp} />}
        <div className="pt-hand-cards">
          {you.hand.length === 0 ? <div className="pt-empty">No cards in hand.</div> : you.hand.map((c) => <PtCard key={c.iid} {...cardProps("you")(c, "hand")} />)}
        </div>
      </footer>

      {menu &&
        createPortal(
          <ActionMenu menu={menu} options={optionsFor(menu.card, menu.zone, menu.seat)} onPick={act} onClose={() => setMenu(null)} />,
          document.body
        )}
      {zoom && zoomLive && createPortal(<ZoomPreview zoom={zoom} onDismiss={() => setZoom(null)} />, document.body)}

      {pile && (
        <Panel
          title={`${pile.seat === "you" ? "Your" : "The opponent's"} ${pile.zone} · ${pileCards.length}`}
          onClose={() => setPile(null)}
        >
          {pileCards.length === 0 ? (
            <div className="pt-empty">Nothing here.</div>
          ) : (
            <div className="pt-row">
              {(pile.zone === "library" ? [...pileCards].sort((a, b) => a.name.localeCompare(b.name)) : pileCards).map((c) => (
                <PtCard key={c.iid} {...cardProps(pile.seat)(c, pile.zone)} />
              ))}
            </div>
          )}
        </Panel>
      )}

      {logOpen && (
        <Panel title="Game log" onClose={() => setLogOpen(false)}>
          <ol className="pt-log">
            {game.log.map((l, i) => (
              <li key={i} className={l.seat === "opp" ? "pt-logline-opp" : undefined}>
                {l.text}
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {mode === "over" && (
        <div className="pt-over">
          <div className="id-display">{game.winner === "you" ? "You win!" : "The opponent wins"}</div>
          <p>{game.log.at(-1)?.text}</p>
        </div>
      )}
    </div>
  );
}
