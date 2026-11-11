"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Flag, Loader2, Plus, Sparkles, Swords, Undo2, X } from "lucide-react";
import type { OpponentOption } from "@/app/api/practice/opponents/route";
import { PrimerMarkdown } from "@/components/deck/DeckPrimer";
import OpponentPicker from "@/components/deck/OpponentPicker";
import { CardArt } from "@/components/mtg";
import { ActionMenu, HandToggle, LifeCounter, Panel, PileZone, PtCard, RotateHint, ScryPanel, ZoomPreview, type MenuState, type Zoom } from "@/components/deck/playtest-parts";
import { bottomCard, draw, mulligan, turnOver, type PlayCard, type Zone } from "@/lib/playtest";
import { aiMulligan, chooseBlocks, fallbackPlan } from "@/lib/practice/ai";
import { clearSaved, loadSaved, storeSaved, type SavedGame } from "@/lib/practice/save";
import { canPlayAsLand, counterOf, edictOf, hasAltCost, infoOf, isBlue, isCreature, isInstantSpeed, isLand, searchAbility, searchOnCast, stats, type Search } from "@/lib/practice/cards";
import { tapTribeOf, untapLandsOf } from "@/lib/practice/abilities";
import { canPayNextTax, declineTax, payTax, playerDraws, concede,
  addCounters,
  adjustLife,
  aiEndStep,
  aiGraveyardCasts,
  aiNinjutsu,
  choiceTargets,
  declineChoice,
  playerEndStep,
  playerTapTribe,
  playerUntapLands,
  spellCost,
  aiRemovalAction,
  aiResponds,
  createTokens,
  finishSearch,
  playerCast,
  playerEdict,
  playerEnters,
  playerFind,
  playerUseSearch,
  resolveChoice,
  type TokenSpec,
  applyAction,
  availableMana,
  canAttack,
  canBlock,
  declareAttackers,
  endTurn,
  findCard,
  moveAnyCard,
  newGame,
  ninjutsu,
  ninjutsuOptions,
  parseCardId,
  playerScry,
  resolveCombat,
  setBlocks,
  startTurn,
  tapToggle,
  withYourSide,
  youPay,
  type DeckCard,
} from "@/lib/practice/game";
import type { CardBook, PlanAction, PracticeGame, Seat, TurnPlan } from "@/lib/practice/types";

/* A practice game against the AI (docs/practice-vs-ai.md): your deck
   against a real one the AI pilots. You play your side by hand, as on the
   solo table; the opponent's turns come from /api/practice/<id>/turn and are
   played out here by the engine, which checks every move. */

interface Setup {
  id: string;
  /** Against the basic bot: its turns are the built-in planner's, no model. */
  bot?: boolean;
  commanderGame: boolean;
  book: CardBook;
  you: { label: string; cards: DeckCard[]; commander: string | null };
  opp: { label: string; detail: string; cards: DeckCard[]; commander: string | null };
}
// "respond": the opponent has cast a spell and waits for your answer.
// "ninjutsu": your attack's blocks are in, and you could ninjutsu a ninja in.
type Mode = "pick" | "loading" | "mulligan" | "main" | "attack" | "combat" | "ai" | "block" | "respond" | "ninjutsu" | "over";
type Answer = { kind: "resolve" | "counter"; g: PracticeGame };
type Step = (g: PracticeGame) => PracticeGame;

type Phase = "main" | "combat" | "main2" | "end";
const PHASES: Phase[] = ["main", "combat", "main2", "end"];
const PHASE_LABEL: Record<Phase, string> = { main: "Main", combat: "Combat", main2: "Main 2", end: "End" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The pause between the opponent's moves, so you can follow them.
const BEAT = 700;
// How long the opponent's spell stays big when you can't answer it.
const SPOTLIGHT = 1400;

export default function PracticeTable({ deckId, onClose, onSolo }: { deckId: string; onClose: () => void; onSolo: () => void }) {
  const [mode, setMode] = useState<Mode>("pick");
  const [error, setError] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [game, setGameState] = useState<PracticeGame | null>(null);
  // The game as it is right now, for the opponent's turn. That turn runs as
  // one long async flow with pauses in it (the model's answer, the beats
  // between its moves), and you can still act meanwhile: change a life
  // total, exile its creature from the ⋯ menu. The flow used to carry its
  // own copy across each pause and write it back, undoing whatever you'd
  // done. Every set goes through here, and the flow picks the latest game
  // up after each pause (`pause`).
  const gameRef = useRef<PracticeGame | null>(null);
  const setGame = (g: PracticeGame | null) => {
    gameRef.current = g;
    setGameState(g);
  };
  /** Wait, then go on from the game as it is by then. */
  const pause = async (ms: number, g: PracticeGame): Promise<PracticeGame> => {
    await sleep(ms);
    return gameRef.current ?? g;
  };
  const [history, setHistory] = useState<PracticeGame[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [blocks, setBlocksState] = useState<Record<number, number[]>>({});
  const [blocker, setBlocker] = useState<number | null>(null);
  const [say, setSay] = useState("");
  const [aiNote, setAiNote] = useState("");
  const [menu, setMenu] = useState<(MenuState & { seat: Seat }) | null>(null);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const [pile, setPile] = useState<{ seat: Seat; zone: "graveyard" | "exile" | "library" | "hand" } | null>(null);
  // The opponent's spell waiting for your answer, and how to give it.
  // What waits for your answer: the opponent's spell, or its end step.
  const [pending, setPending] = useState<{ kind: "spell"; action: PlanAction; card: PlayCard; target?: string } | { kind: "end" } | null>(null);
  // The opponent's spell, shown big while it's cast (as in Arena), and what it targets.
  const [spotlight, setSpotlight] = useState<{ card: PlayCard; target?: string; targetIid?: number } | null>(null);
  const answerRef = useRef<((a: Answer) => void) | null>(null);
  // The opponent's turn waiting on a choice of yours (Kefka's discard, a
  // sacrifice): your pick hands it the game after.
  const choiceRef = useRef<((g: PracticeGame) => void) | null>(null);
  // Your attack waiting on your ninjutsu (or "To damage").
  const ninjaRef = useRef<((g: PracticeGame) => void) | null>(null);
  const [scryOpen, setScryOpen] = useState(false);
  // "Don't ask again": the opponent's spells resolve without a pause, this game.
  const noAsk = useRef(false);
  const [logOpen, setLogOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  // A search of your library under way (a tutor you cast, a fetch you
  // cracked): what it may find, how many found, and what goes on top.
  const [search, setSearch] = useState<{ source: string; spec: Search; found: number; top: number[]; attachTo?: number } | null>(null);
  // A phone held sideways: whether the hand is raised over the board.
  const [handUp, setHandUp] = useState(false);
  const lastOpponent = useRef<OpponentOption | null>(null);
  const lastBot = useRef(false);
  // A game left unfinished (a reload, a closed tab), offered by the picker.
  const [saved, setSaved] = useState<SavedGame<Setup> | null>(null);
  // Picked up at the start of the opponent's turn: it plays once the table is back.
  const [resumeAi, setResumeAi] = useState(false);
  // This deck's finished games against the AI, once this one is counted.
  const [record, setRecord] = useState<{ won: number; lost: number } | null>(null);
  const reported = useRef<string | null>(null);
  // Whether this turn's combat is behind it, for the phase strip.
  const [fought, setFought] = useState(false);
  // The AI's review of the finished game.
  const [review, setReview] = useState<{ open: boolean; busy: boolean; text: string; error: string } | null>(null);
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

  useEffect(() => {
    if (game?.winner) setMode("over");
  }, [game?.winner]);

  // A new turn starts before its combat.
  const turnNow = game?.turn ?? 0;
  useEffect(() => setFought(false), [turnNow]);

  // A game in progress for this deck, from an earlier visit.
  useEffect(() => setSaved(loadSaved<Setup>(deckId)), [deckId]);

  // Keep the game at each steady point: your mulligan, and your turn as it
  // stands. (The opponent's turn is kept once, as it starts: runAi.) A
  // finished game is forgotten.
  useEffect(() => {
    if (!game || !setup) return;
    if (game.winner) clearSaved(deckId);
    else if (mode === "mulligan" || (mode === "main" && game.active === "you")) storeSaved(deckId, { setup, game, as: mode, option: lastOpponent.current });
  }, [game, setup, mode, deckId]);

  // The game is over: it goes on the deck's record, once.
  const winner = game?.winner ?? null;
  const overTurn = game?.turn ?? 0;
  const gameId = setup?.id ?? null;
  useEffect(() => {
    if (!winner || !gameId || reported.current === gameId) return;
    reported.current = gameId;
    fetch(`/api/practice/${gameId}/result`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: winner === "you" ? "won" : "lost", turn: overTurn }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive.current && d?.record && setRecord(d.record))
      .catch(() => {});
  }, [winner, gameId, overTurn]);

  // A game picked up at the start of the opponent's turn: it takes that turn.
  useEffect(() => {
    if (!resumeAi || !game || !setup) return;
    setResumeAi(false);
    void runAi(game);
    // runAi is this render's: it reads the setup just restored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeAi, game, setup]);

  // A discard to choose raises your hand; a sacrifice lowers it, for the board.
  const choiceKind = game?.choice?.kind;
  useEffect(() => {
    if (choiceKind) setHandUp(choiceKind === "discard" || choiceKind === "put");
  }, [choiceKind]);

  // The history beside the board follows the newest line.
  const logLength = game?.log.length ?? 0;
  useEffect(() => {
    const el = sideLog.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logLength]);

  // ── Game flow ─────────────────────────────────────────────────────────

  /** Pick an unfinished game up where it was left. */
  function resume(s: SavedGame<Setup>) {
    lastOpponent.current = s.option;
    lastBot.current = !!s.setup.bot;
    noAsk.current = false;
    setSaved(null);
    setError("");
    setSetup(s.setup);
    setGame(s.game);
    setHistory([]);
    setSay("");
    setAiNote(s.as === "ai" ? "Picked up at the start of the opponent's turn." : "");
    setPicked([]);
    setRecord(null);
    setReview(null);
    if (s.as === "ai") {
      setMode("ai");
      setResumeAi(true);
    } else setMode(s.as);
  }

  async function start(option: OpponentOption, bot = false) {
    setMode("loading");
    setError("");
    const res = await fetch("/api/practice/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deck: deckId, opponent: option, bot }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (!alive.current) return;
    if (!res?.ok || !data?.id) {
      setError(data?.error ?? "Couldn't start the game. Try again.");
      setMode("pick");
      return;
    }
    lastOpponent.current = option;
    lastBot.current = bot;
    noAsk.current = false;
    setSaved(null);
    setRecord(null);
    setReview(null);
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
      const card = findCard(g, iid)?.card;
      // The mana it needs is tapped for you (Undo puts it back).
      const played = playerCast(g, iid, book);
      if (played === g || !card) return g;
      const answered = aiResponds(played, iid, book);
      if (answered !== played) {
        setSay("Not so fast.");
        setAiNote("");
        return answered;
      }
      // A tutor, or a creature that searches as it enters: the search opens.
      const spec = searchOnCast(infoOf(book, card));
      if (spec) setSearch({ source: card.name, spec, found: 0, top: [] });
      // What it does as it enters (Kefka's discard).
      return playerEnters(answered, iid, book);
    };
  const cast = (iid: number) => act(castStep(iid));
  const undo = () => {
    if (!history.length) return;
    setGame(history[history.length - 1]!);
    setHistory((h) => h.slice(0, -1));
  };

  function keep() {
    if (!game || game.sides.you.toBottom > 0) return;
    const g = startTurn(game, book);
    setGame(g);
    setHistory([]);
    if (g.active === "opp") void runAi(g);
    else setMode("main");
  }

  async function endMyTurn() {
    if (!game || !setup) return;
    let g = game;
    // Your end step: Braids asks first.
    const braids = playerEndStep(g, setup.book);
    if (braids !== g) {
      setMode("ai");
      g = await waitChoice(braids);
      if (!alive.current || g.winner) return setMode(g.winner ? "over" : "main");
    }
    // At the end of your turn the AI may answer your biggest threat.
    const removal = aiRemovalAction(g, setup.book, g.sides.you.battlefield.map((c) => c.iid), "end");
    if (removal) {
      setMode("ai");
      setHistory([]);
      g = await aiCast(g, removal, "ai");
      if (!alive.current || g.winner) return setMode(g.winner ? "over" : "main");
    }
    g = endTurn(g, setup.book);
    setGame(g);
    if (!g.winner) void runAi(g);
  }

  /** A choice of yours the game waits on (Kefka's discard, a sacrifice
      the opponent's ability asks for): the opponent's turn, or your
      attack, goes on once you've picked. */
  async function waitChoice(g: PracticeGame): Promise<PracticeGame> {
    if (!g.choice || g.winner) return g;
    setGame(g);
    const next = await new Promise<PracticeGame>((resolve) => (choiceRef.current = resolve));
    choiceRef.current = null;
    return next;
  }
  const choose = (iid: number) => {
    if (!game?.choice) return;
    const choice = game.choice;
    const next = resolveChoice(game, iid, book);
    if (next === game) return;
    // Light-Paws: the Aura you cast is on; now the search for the next one.
    if (choice.kind === "attach" && choice.tutor !== undefined && choice.aura !== undefined) {
      const aura = findCard(next, choice.aura)?.card;
      const lightPaws = findCard(next, choice.tutor)?.card;
      if (aura && lightPaws) {
        const mv = infoOf(book, aura)?.manaValue ?? 0;
        const names = new Set(next.sides.you.battlefield.filter((c) => /\bAura\b/.test(infoOf(book, c)?.typeLine ?? c.typeLine ?? "")).map((c) => c.name));
        setSearch({
          source: lightPaws.name,
          spec: {
            count: 1,
            what: `Aura card with mana value ${mv} or less, and a name none of your Auras has, onto ${lightPaws.name.split(",")[0]}`,
            to: [{ zone: "battlefield" }],
            test: (typeLine, info) => /\bAura\b/.test(info?.typeLine ?? typeLine ?? "") && (info?.manaValue ?? 0) <= mv && !names.has(info?.name ?? ""),
          },
          found: 0,
          top: [],
          attachTo: lightPaws.iid,
        });
      }
    }
    if (choiceRef.current) {
      setMenu(null);
      setZoom(null);
      setGame(next);
      choiceRef.current(next);
    } else act(() => next);
  };

  /** Not doing an optional choice (Braids, The Ur-Dragon's permanent). */
  const decline = () => {
    if (!game?.choice?.decline) return;
    const next = declineChoice(game, book);
    if (choiceRef.current) {
      setGame(next);
      choiceRef.current(next);
    } else act(() => next);
  };

  /** The opponent casts a spell. If you hold something you could answer
      with (an instant, a card with flash), it waits: paid for and on the
      table's log, until you counter it, cast your own instants, or let it
      resolve. Returns the game after. */
  /** Could you cast something now: an instant (or flash) you can pay for
      with your untapped mana, or one with another way to cast it? */
  const canAnswer = (g: PracticeGame) => {
    if (!setup || noAsk.current) return false;
    const mana = availableMana(g, "you", setup.book);
    return g.sides.you.hand.some((c) => {
      if (!isInstantSpeed(setup.book, c)) return false;
      const info = infoOf(setup.book, c);
      return hasAltCost(info) || youPay(g, spellCost(g, "you", c, setup.book, "hand"), mana, setup.book) !== null;
    });
  };

  /** The opponent casts a spell: paid for and shown big, with what it
      targets lit up. If you could answer, it waits until you counter it,
      cast your own instants, or let it resolve; otherwise it resolves after
      a moment, so you can read it. Returns the game after. */
  async function aiCast(g0: PracticeGame, a: PlanAction, back: Mode): Promise<PracticeGame> {
    if (!setup) return g0;
    const card = findCard(g0, parseCardId(a.card) ?? -1)?.card;
    if (!card || isLand(card)) {
      const g = applyAction(g0, "opp", a, setup.book).game;
      setGame(g);
      return pause(BEAT, g);
    }
    const targetIid = a.effects.map((e) => parseCardId(e.target)).find((t) => t !== null) ?? undefined;
    const target = targetIid !== undefined ? findCard(g0, targetIid)?.card.name : undefined;
    const answerable = canAnswer(g0);
    const paid = applyAction(g0, "opp", a, setup.book, { stage: "pay" });
    setGame(paid.game);
    if (!paid.ok) return pause(BEAT, paid.game);
    setSpotlight({ card, target, targetIid });
    let answer: Answer = { kind: "resolve", g: paid.game };
    if (answerable) {
      setPending({ kind: "spell", action: a, card, target });
      setMode("respond");
      answer = await new Promise<Answer>((resolve) => (answerRef.current = resolve));
      answerRef.current = null;
      setPending(null);
      setMode(back);
    } else {
      answer = { kind: "resolve", g: await pause(SPOTLIGHT, paid.game) };
    }
    setSpotlight(null);
    let g = answer.kind === "counter" ? answer.g : applyAction(answer.g, "opp", a, setup.book, { stage: "resolve" }).game;
    setGame(g);
    g = await waitChoice(g);
    return pause(BEAT, g);
  }

  /** The opponent's end step: if you could cast something, it stops for
      you to (card draw, removal you'd rather cast now). */
  async function endStepStop(g: PracticeGame): Promise<PracticeGame> {
    if (!setup || g.winner || !canAnswer(g)) return g;
    setGame(g);
    setPending({ kind: "end" });
    setMode("respond");
    const answer = await new Promise<Answer>((resolve) => (answerRef.current = resolve));
    answerRef.current = null;
    setPending(null);
    setMode("ai");
    return answer.g;
  }

  /** Your answer to the opponent's spell: counter it with a counterspell
      from your hand (cast as any spell, so the AI may counter that), or let
      it resolve. */
  const counterWith = (iid: number) => {
    if (!game || !setup || pending?.kind !== "spell" || !answerRef.current) return;
    const name = findCard(game, iid)?.card.name ?? "A counterspell";
    const cast = playerCast(game, iid, setup.book);
    const answered = aiResponds(cast, iid, setup.book);
    if (answered !== cast) {
      setSay("Not so fast.");
      answerRef.current({ kind: "resolve", g: answered });
      return;
    }
    answerRef.current({ kind: "counter", g: applyAction(answered, "opp", pending.action, setup.book, { stage: "counter", by: name }).game });
  };
  const letResolve = () => game && answerRef.current?.({ kind: "resolve", g: game });

  /** Your ninjutsu: the ninja comes in for that unblocked attacker; with
      no other ninja to bring in, combat goes on. */
  const bringNinja = (ninjaIid: number, attackerIid: number) => {
    if (!game || !setup || !ninjaRef.current) return;
    const next = ninjutsu(game, "you", ninjaIid, attackerIid, setup.book);
    if (next === game) return;
    setMenu(null);
    setZoom(null);
    setGame(next);
    if (!ninjutsuOptions(next, "you", setup.book).length) ninjaRef.current(next);
  };

  async function runAi(g0: PracticeGame) {
    if (!setup) return;
    setMode("ai");
    setHistory([]);
    setSay("");
    setAiNote("");
    let g = g0;
    let plan: TurnPlan;
    // Kept as the turn starts: picked up again, the opponent plays it over.
    storeSaved(deckId, { setup, game: g0, as: "ai", option: lastOpponent.current });
    if (setup.bot) {
      // The basic bot: the built-in planner, here in the browser.
      plan = fallbackPlan(g, setup.book);
      g = await pause(BEAT, g);
    } else
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
    // The plan can take a while to arrive: go on from the game as it is now.
    g = gameRef.current ?? g;
    if (plan.say) setSay(plan.say);
    for (const a of plan.main) {
      if (a.kind === "cast") g = await aiCast(g, a, "ai");
      else {
        g = applyAction(g, "opp", a, setup.book).game;
        setGame(g);
        g = await pause(BEAT, await waitChoice(g));
      }
      if (!alive.current || g.winner) return;
    }
    const attackers = plan.attack.map(parseCardId).filter((n): n is number => n !== null);
    if (attackers.length) {
      let declared = declareAttackers(g, "opp", attackers, setup.book);
      if (declared.combat) {
        // "Whenever Kefka attacks": your discard first.
        declared = await waitChoice(declared);
        if (!alive.current || declared.winner) return;
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
    g = await pause(BEAT, g);
    // Its ninjutsu, for an attacker you left unblocked (Yuriko).
    const ninja = aiNinjutsu(g, setup.book);
    if (ninja !== g) {
      g = ninja;
      setGame(g);
      g = await pause(SPOTLIGHT, g);
      if (!alive.current) return;
    }
    g = resolveCombat(g, setup.book);
    setGame(g);
    if (g.winner) return;
    g = await pause(BEAT, g);
    await afterCombat(g, afterCombatPlan.current);
  }

  async function afterCombat(g0: PracticeGame, actions0: PlanAction[]) {
    if (!setup) return;
    setFought(true);
    let g = g0;
    // What Silas Renn let it cast from its graveyard comes first.
    const actions = [...aiGraveyardCasts(g, setup.book), ...actions0];
    for (const a of actions) {
      if (a.kind === "cast") g = await aiCast(g, a, "ai");
      else {
        g = applyAction(g, "opp", a, setup.book).game;
        setGame(g);
        g = await pause(BEAT, await waitChoice(g));
      }
      if (!alive.current || g.winner) return;
    }
    // Its end step: Inalla's Wizards, Braids (you may have to answer).
    const end = aiEndStep(g, setup.book);
    if (end !== g) {
      g = end;
      setGame(g);
      g = await waitChoice(await pause(BEAT, g));
      if (!alive.current || g.winner) return;
    }
    g = await endStepStop(g);
    if (!alive.current) return;
    g = endTurn(g, setup.book);
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
    setHistory([]);
    // "Whenever Kefka attacks": your discard first.
    if (g.choice) {
      setMode("combat");
      g = await waitChoice(g);
      if (!alive.current || g.winner || !g.combat) return;
    }
    // The AI may answer an attacker with instant removal before it blocks.
    const removal = aiRemovalAction(g, setup.book, g.combat.attackers, "attack");
    if (removal) {
      setGame(g);
      setMode("combat");
      g = await pause(BEAT, g);
      setSay("Not that one.");
      g = await aiCast(g, removal, "combat");
      if (!alive.current || g.winner) return;
      if (!g.combat) return setMode("main");
      g = { ...g, combat: { ...g.combat, attackers: g.combat.attackers.filter((iid) => g.sides.you.battlefield.some((c) => c.iid === iid)) } };
    }
    g = setBlocks(g, chooseBlocks(g, setup.book), setup.book);
    setGame(g);
    setHistory([]);
    // Blocks are in: a ninja you could bring in waits for you.
    if (ninjutsuOptions(g, "you", setup.book).length) {
      setMode("ninjutsu");
      g = await new Promise<PracticeGame>((resolve) => (ninjaRef.current = resolve));
      ninjaRef.current = null;
      if (!alive.current) return;
      setMode("combat");
      g = await pause(BEAT, g);
    } else {
      setMode("combat");
      g = await pause(1400, g);
    }
    if (!alive.current) return;
    g = resolveCombat(g, setup.book);
    setGame(g);
    setFought(true);
    setMode(g.winner ? "over" : "main");
  }

  /** The AI's review of the finished game: asked for once, read as it's written. */
  async function openReview() {
    if (!game?.winner || !setup) return;
    if (review?.text || review?.busy) return setReview({ ...review, open: true });
    setReview({ open: true, busy: true, text: "", error: "" });
    try {
      const res = await fetch(`/api/practice/${setup.id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game }) });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        if (alive.current) setReview((r) => (r ? { ...r, busy: false, error: data?.error ?? "Couldn't write the review. Try again." } : r));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (!alive.current) return void reader.cancel().catch(() => {});
        const soFar = text;
        setReview((r) => (r ? { ...r, text: soFar } : r));
      }
      setReview((r) => (r ? { ...r, busy: false, error: text.trim() ? "" : "Couldn't write the review. Try again." } : r));
    } catch {
      if (alive.current) setReview((r) => (r ? { ...r, busy: false, error: r.text ? "" : "Couldn't write the review. Try again." } : r));
    }
  }

  /** Give the game up: it counts as a loss. */
  const giveUp = () => {
    if (!game || game.winner || !confirm("Concede this game? It counts as a loss.")) return;
    setMenu(null);
    setHistory([]);
    setGame(concede(game));
  };

  // ── Card clicks and menus ─────────────────────────────────────────────

  const yours = (iid: number) => !!game?.sides.you.battlefield.some((c) => c.iid === iid);
  const onPrimary = (card: PlayCard, zone: Zone, anchor: DOMRect) => {
    if (!game || !setup) return;
    const at = findCard(game, card.iid);
    if (!at) return;
    const seat = at.seat;
    // The ninjutsu window: a ninja you click comes in for your weakest
    // unblocked attacker.
    if (mode === "ninjutsu" && seat === "you" && (zone === "hand" || zone === "command")) {
      const o = ninjutsuOptions(game, "you", setup.book).find((x) => x.ninja.iid === card.iid);
      const weakest = o && [...o.unblocked].sort((a, b) => stats(setup.book, a).power - stats(setup.book, b).power)[0];
      if (weakest) {
        setHandUp(false);
        bringNinja(card.iid, weakest.iid);
        return;
      }
    }
    // A discard or a sacrifice to choose: your click picks it.
    if (game.choice && choiceTargets(game, setup.book).includes(card.iid)) {
      setHandUp(false);
      choose(card.iid);
      return;
    }
    if (seat === "you" && zone === "hand") {
      if (mode === "mulligan" && game.sides.you.toBottom > 0) act((g) => withYourSide(g, (s) => bottomCard(s, card.iid)));
      else if (mode === "main" || ((mode === "respond" || mode === "block") && isInstantSpeed(setup.book, card))) {
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
  // The mouse leaving a card closes only a preview the mouse opened.
  const onZoom = (card: PlayCard | null, zone?: Zone, anchor?: DOMRect, hover?: boolean) =>
    setZoom((z) => (card && zone && anchor ? { card, zone, anchor, hover } : hover ? (z?.hover ? null : z) : null));
  const onTurn = (card: PlayCard) => act((g) => (findCard(g, card.iid)?.seat === "you" ? withYourSide(g, (s) => turnOver(s, card.iid)) : g));

  const optionsFor = (card: PlayCard, zone: Zone, seat: Seat): { label: string; step: Step }[] => {
    const to = (z: Zone, bottom = false): Step => (g) => moveAnyCard(g, card.iid, z, { bottom });
    const counters: { label: string; step: Step }[] =
      zone === "battlefield" && isCreature(book, card)
        ? [
            { label: "+1/+1 counter", step: (g) => addCounters(g, card.iid, 1, book) },
            { label: "−1/−1 counter", step: (g) => addCounters(g, card.iid, -1, book) },
          ]
        : [];
    if (seat === "opp") {
      if (zone !== "battlefield") return [];
      return [
        ...counters,
        { label: card.tapped ? "Untap" : "Tap", step: (g) => tapToggle(g, card.iid) },
        { label: "Destroy", step: to("graveyard") },
        { label: "Exile", step: to("exile") },
        { label: "Return to its owner's hand", step: to("hand") },
      ];
    }
    const out: { label: string; step: Step }[] = [];
    if (zone === "hand" || zone === "command") out.push({ label: "Play", step: castStep(card.iid) });
    if (zone === "battlefield") out.push({ label: card.tapped ? "Untap" : "Tap", step: (g) => tapToggle(g, card.iid) });
    out.push(...counters);
    // A search it can do (crack a fetch land, Evolving Wilds, Sakura-Tribe Elder).
    const ability = zone === "battlefield" ? searchAbility(infoOf(book, card)) : null;
    // Inalla: tap five Wizards. Beledros: pay 10 life, untap your lands.
    const tribe = zone === "battlefield" ? tapTribeOf(book, card) : null;
    if (tribe) out.unshift({ label: `Tap ${tribe.count} untapped ${tribe.type}s: the opponent loses ${tribe.life} life`, step: (g) => playerTapTribe(g, card.iid, book) });
    const untap = zone === "battlefield" ? untapLandsOf(book, card) : null;
    if (untap && !game?.once?.includes(card.iid)) out.unshift({ label: `Pay ${untap.life} life: untap your lands`, step: (g) => playerUntapLands(g, card.iid, book) });
    // Silas Renn let you cast it from your graveyard this turn.
    if (zone === "graveyard" && game?.mayCast?.includes(card.iid)) out.unshift({ label: "Cast it (this turn)", step: castStep(card.iid) });
    // An "each opponent sacrifices" ability (Kefka's {8}).
    const edict = zone === "battlefield" ? edictOf(book, card) : null;
    if (edict) {
      out.unshift({
        label: `${edict.mana}: the opponent sacrifices a ${edict.what}${edict.transform ? ", transform" : ""}`,
        step: (g) => playerEdict(g, card.iid, book),
      });
    }
    if (ability && !(ability.tap && card.tapped)) {
      out.unshift({
        label: `Search for ${/^[aeiou]/i.test(ability.what) ? "an" : "a"} ${ability.what}${ability.mana ? ` (pay ${ability.mana})` : ""}`,
        step: (g) => {
          setSearch({ source: card.name, spec: ability, found: 0, top: [] });
          return playerUseSearch(g, card.iid, ability, book);
        },
      });
    }
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
  // What you can do now, lit up as in Arena: on your turn, the cards you can
  // afford (and a land, while your land drop is there); when you're
  // answering or blocking, the instants and flash cards you can afford; when
  // you're choosing attackers, the creatures that can attack.
  const playableNow = (card: PlayCard, zone: Zone): boolean => {
    if (!game || !setup) return false;
    if (mode === "ninjutsu") return ninjutsuOptions(game, "you", setup.book).some((o) => o.ninja.iid === card.iid);
    // A choice waiting: what you may pick glows.
    if (game.choice) return choiceTargets(game, setup.book).includes(card.iid);
    if (zone === "battlefield") return mode === "attack" && !picked.includes(card.iid) && canAttack(game, "you", card, setup.book);
    if (zone !== "hand" && zone !== "command") return false;
    const yourMain = mode === "main" && game.active === "you";
    const answering = (mode === "respond" || mode === "block") && zone === "hand" && isInstantSpeed(setup.book, card);
    if (!yourMain && !answering) return false;
    if (zone === "hand" && canPlayAsLand(card) && yourMain && !game.landPlayed) return true;
    if (isLand(card)) return false;
    const info = infoOf(setup.book, card);
    if (hasAltCost(info)) return true;
    const cost = spellCost(game, "you", card, setup.book, zone);
    return youPay(game, cost, availableMana(game, "you", setup.book), setup.book) !== null;
  };
  const cardProps = (seat: Seat) => (card: PlayCard, zone: Zone) => ({
    playable: seat === "you" && playableNow(card, zone),
    targeted: spotlight?.targetIid === card.iid,
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

  // The step of the turn, for the strip in the bar: your mulligan has none.
  const phaseStep: Phase | null =
    !game || mode === "mulligan" || mode === "over" || mode === "pick" || mode === "loading"
      ? null
      : pending?.kind === "end"
        ? "end"
        : mode === "attack" || mode === "combat" || mode === "block" || mode === "ninjutsu"
          ? "combat"
          : fought
            ? "main2"
            : "main";
  const phaseWho = !game ? "" : mode === "mulligan" ? "Mulligan" : game.active === "you" ? "Your turn" : "Opponent’s turn";

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
            {/* Whose turn, and where in it. */}
            <div className="pt-phase" data-seat={game.active} role="status" aria-label={`Turn ${game.turn}, ${phaseWho}${phaseStep ? `, ${PHASE_LABEL[phaseStep]}` : ""}`}>
              <span className="pt-turn">Turn {game.turn}</span>
              {mode !== "over" && <span className="pt-phase-who">{phaseWho}</span>}
              {phaseStep && (
                <span className="pt-phase-steps" aria-hidden="true">
                  {PHASES.map((p) => (
                    <span key={p} data-on={p === phaseStep || undefined}>
                      {PHASE_LABEL[p]}
                    </span>
                  ))}
                </span>
              )}
            </div>
            {/* Life: here on a phone, beside each side's name where the piles column shows. */}
            <span className="pt-top-life">
              <LifeCounter label="Opp" value={game.sides.opp.life} onDelta={(d) => act((g) => adjustLife(g, "opp", d, book))} />
              <LifeCounter label="You" value={game.sides.you.life} onDelta={(d) => act((g) => adjustLife(g, "you", d, book))} />
            </span>
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
        <OpponentPicker
          deckId={deckId}
          starting={mode === "loading"}
          error={error}
          onStart={(o, bot) => void start(o, bot)}
          onSolo={onSolo}
          saved={saved ? { opponent: saved.setup.opp.label, turn: saved.game.turn, bot: !!saved.setup.bot } : null}
          onResume={() => saved && resume(saved)}
          onDiscard={() => {
            clearSaved(deckId);
            setSaved(null);
          }}
        />
      </div>
    );
  }

  const recordLine = record && record.won + record.lost > 0 ? `This deck against the AI: ${record.won} ${record.won === 1 ? "win" : "wins"}, ${record.lost} ${record.lost === 1 ? "loss" : "losses"}.` : "";
  const you = game.sides.you;
  const opp = game.sides.opp;
  const yourTurn = game.active === "you";
  const row = (cards: PlayCard[], seat: Seat) => cards.map((c) => <PtCard key={c.iid} {...cardProps(seat)(c, "battlefield")} />);
  // A side's lands in one pile, each on top of the one before: the same land
  // together, untapped first. However many there are, they take about one
  // card's width, so the cards beside them keep their size.
  const landRow = (cards: PlayCard[], seat: Seat) =>
    [...cards]
      .sort((a, b) => a.name.localeCompare(b.name) || Number(a.tapped) - Number(b.tapped))
      .map((c, i, all) => (
        <PtCard key={c.iid} {...cardProps(seat)(c, "battlefield")} stack={i === 0 ? undefined : all[i - 1]!.name === c.name ? "same" : "other"} />
      ));
  // How many card widths a side's line needs, so its cards can shrink to fit
  // (CSS: .pt-side-cards). A land on the pile shows 18% of itself over the
  // same land, 30% over another; every card brings an 8px gap, and the lands
  // their divider.
  const lineFit = (cards: PlayCard[]): React.CSSProperties => {
    const perms = cards.filter((c) => !isLand(c));
    const lands = [...cards.filter(isLand)].sort((a, b) => a.name.localeCompare(b.name));
    const landSlots = lands.reduce((n, c, i) => n + (i === 0 ? 1 : lands[i - 1]!.name === c.name ? 0.18 : 0.3), 0);
    const fixed = cards.length * 8 + (perms.length && lands.length ? 30 : 0);
    return { ["--pt-slots" as string]: Math.max(1, perms.length + landSlots), ["--pt-fixed" as string]: `${fixed}px` };
  };
  // A side's command zone in the column of piles: dimmed until it's cast.
  const commandPile = (seat: Seat) =>
    (game.commanderGame || game.sides[seat].command.length > 0) && (
      <div className="pt-zone pt-zone-command">
        <div className="pt-zone-label">
          Command {game.tax[seat] ? <span>+{2 * game.tax[seat]}</span> : null}
        </div>
        {game.sides[seat].command.length ? (
          game.sides[seat].command.map((c) => <PtCard key={c.iid} {...cardProps(seat)(c, "command")} />)
        ) : (
          <div className="pt-pile pt-pile-empty">—</div>
        )}
      </div>
    );
  const lastLines = game.log.slice(-3);
  const recent = game.log.filter((l) => l.card).slice(-4).reverse();
  // A commander waiting in the command zone: small and dimmed beside its
  // side's counts, not a row of the board, until it's cast.
  const commandZone = (seat: Seat) => {
    const cards = game.sides[seat].command;
    if (!cards.length) return null;
    return (
      <div className="pt-cmdzone" title="In the command zone">
        <span className="pt-cmdzone-label">
          Command{game.tax[seat] ? <b> +{2 * game.tax[seat]}</b> : null}
        </span>
        {cards.map((c) => (
          <PtCard key={c.iid} {...cardProps(seat)(c, "command")} />
        ))}
      </div>
    );
  };
  const blockCount = Object.values(blocks).reduce((n, b) => n + b.length, 0);
  const zoomLive = zoom !== null && !!findCard(game, zoom.card.iid);
  const pileCards = pile ? [...game.sides[pile.seat][pile.zone]].reverse() : [];

  const tax = game.taxes?.[0] ?? null;
  const choicePrompt = game.choice
    ? `${game.choice.source}: ${
        game.choice.kind === "discard"
          ? "choose a card from your hand to discard"
          : game.choice.kind === "put"
            ? "choose a permanent card from your hand to put onto the battlefield"
            : game.choice.kind === "attach"
              ? "choose the creature it goes on"
              : game.choice.braids === "yours"
                ? "sacrifice an artifact, creature, enchantment, land or planeswalker? The opponent then sacrifices one that shares a type, or loses 2 life and you draw"
                : game.choice.types
                  ? `sacrifice a ${game.choice.types.join(" or ")}, or lose ${game.choice.life ?? 2} life and the opponent draws`
                  : `choose a ${game.choice.what ?? "permanent"} of yours to sacrifice`
      }.`
    : null;
  const status = choicePrompt
    ? choicePrompt
    : mode === "mulligan"
      ? you.toBottom > 0
        ? `Put ${you.toBottom} card${you.toBottom === 1 ? "" : "s"} from your hand on the bottom.`
        : `${game.first === "you" ? "You're" : "The opponent is"} on the play.`
      : mode === "ninjutsu"
        ? "Blocks are in. Use ninjutsu for an unblocked attacker, or go to damage."
      : mode === "attack"
        ? "Tap the creatures that attack."
        : mode === "block"
          ? blocker === null
            ? "Tap one of your creatures, then the attacker it blocks."
            : "Now tap the attacker it blocks."
          : mode === "respond" && pending
            ? pending.kind === "end"
              ? "The opponent's end step. Cast an instant now, or go on to your turn."
              : `The opponent casts ${pending.card.name}${pending.target ? ` on ${pending.target}` : ""}. Answer with an instant, or let it resolve.`
            : mode === "ai"
            ? "The opponent is playing…"
            : mode === "combat"
              ? "Combat…"
              : mode === "over"
                ? `${game.winner === "you" ? "You win!" : "The opponent wins."}${recordLine ? ` ${recordLine}` : ""}`
                : `Your turn · land drop ${game.landPlayed ? "used" : "available"}`;

  // Your answer, offered where you're looking: under the opponent's spell
  // while it's shown big, or in the bar for its end step.
  const answerButtons = mode === "respond" && pending && (
    <>
      {pending.kind === "spell" &&
        you.hand
          .filter((c, i, all) => {
            // One button per counterspell, however many copies you hold.
            if (all.findIndex((x) => x.name === c.name) !== i) return false;
            const k = counterOf(infoOf(book, c));
            const info = infoOf(book, pending.card);
            return !!k && k.hits({ typeLine: info?.typeLine ?? pending.card.typeLine ?? "", manaValue: info?.manaValue ?? 0, blue: isBlue(info) });
          })
          .map((c) => (
            <button key={c.iid} type="button" className="pt-btn pt-btn-gold" onClick={counterWith.bind(null, c.iid)}>
              Counter with {c.name}
            </button>
          ))}
      <button type="button" className={pending.kind === "end" ? "pt-btn pt-btn-gold" : "pt-btn"} onClick={letResolve}>
        {pending.kind === "end" ? "Go to my turn" : "Let it resolve"}
      </button>
      <button
        type="button"
        className="pt-btn"
        title="No more stops for your answers, for the rest of this game"
        onClick={() => {
          noAsk.current = true;
          letResolve();
        }}
      >
        Don&apos;t ask again
      </button>
    </>
  );

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
              <button
                type="button"
                className="pt-btn pt-btn-gold"
                onClick={() => setMode("attack")}
                disabled={!!game.choice || !you.battlefield.some((c) => canAttack(game, "you", c, book))}
              >
                <Swords size={14} strokeWidth={2.25} /> Attack
              </button>
              <button type="button" className="pt-btn" onClick={() => void endMyTurn()} disabled={!!game.choice}>
                End turn
              </button>
              <button type="button" className="pt-btn" onClick={undo} disabled={!history.length} aria-label="Undo">
                <Undo2 size={14} strokeWidth={2.25} /> <span className="pt-btn-label">Undo</span>
              </button>
              <button type="button" className="pt-btn" onClick={() => act((g) => playerDraws(g, 1, book))} disabled={!you.library.length}>
                Draw
              </button>
              <button type="button" className="pt-btn" onClick={() => setScryOpen(true)} disabled={!you.library.length || !!game.choice}>
                Scry
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
          {/* The end-step stop has no card to show: its buttons stay up here.
              An answer to a spell sits with the spell, under the big card. */}
          {mode === "respond" && pending?.kind === "end" && answerButtons}
          {mode === "over" && (
            <>
              <button type="button" className="pt-btn pt-btn-gold" onClick={() => void openReview()}>
                <Sparkles size={14} strokeWidth={2.25} /> Review the game
              </button>
              <button type="button" className="pt-btn" onClick={() => lastOpponent.current && void start(lastOpponent.current, lastBot.current)}>
                Play again
              </button>
              {opp.hand.length > 0 && (
                <button type="button" className="pt-btn" onClick={() => setPile({ seat: "opp", zone: "hand" })}>
                  Its hand ({opp.hand.length})
                </button>
              )}
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
          {(mode === "main" || mode === "block") && (
            <button type="button" className="pt-btn" onClick={() => setTokenOpen(true)}>
              <Plus size={14} strokeWidth={2.5} /> Token
            </button>
          )}
          <button type="button" className="pt-btn" onClick={() => setLogOpen(true)}>
            Log
          </button>
          {mode === "main" && yourTurn && !game.choice && (
            <button type="button" className="pt-btn" onClick={giveUp} title="Give the game up: it counts as a loss">
              <Flag size={13} strokeWidth={2.25} /> <span className="pt-btn-label">Concede</span>
            </button>
          )}
        </div>
        <span className="pt-status">{status}</span>
      </div>

      {/* The board and the hand; the column beside them where there's room. */}
      <div className="pt-body">
        <div className="pt-play">
          {/* Your ninjutsu, over the board where there's room for it: one
              button per ninja and attacker by name (two copies of either
              are the same choice). */}
          {mode === "ninjutsu" && (
            <div className="pt-ninja" role="group" aria-label="Ninjutsu">
              <span className="pt-ninja-caption">Blocks are in. Ninjutsu?</span>
              {ninjutsuOptions(game, "you", book)
                .flatMap((o) => [...o.unblocked].sort((a, b) => stats(book, a).power - stats(book, b).power).map((a) => ({ o, a })))
                .filter(({ o, a }, i, all) => all.findIndex((x) => x.o.ninja.name === o.ninja.name && x.a.name === a.name) === i)
                .slice(0, 6)
                .map(({ o, a }) => (
                  <button key={`${o.ninja.iid}:${a.iid}`} type="button" className="pt-btn pt-btn-gold" onClick={() => bringNinja(o.ninja.iid, a.iid)}>
                    {o.ninja.name.split(",")[0]} for {a.name.split(",")[0]} <span className="pt-ninja-cost">{o.cost}</span>
                  </button>
                ))}
              <button type="button" className="pt-btn" onClick={() => game && ninjaRef.current?.(game)}>
                To damage
              </button>
            </div>
          )}
          {/* The opponent's card asks you to pay, or it gets something
              (Rhystic Study, Smothering Tithe): yours to decide. */}
          {tax && mode !== "over" && (
            <div className="pt-choice pt-tax" role="group" aria-label={`${tax.source}: pay or not`}>
              <span>
                <b>{tax.source}</b>: pay {`{${tax.cost}}`}
                {tax.count > 1 ? ` (${tax.count} times owed)` : ""}, or the opponent {tax.gives === "draw" ? "draws a card" : "makes a Treasure"}.
              </span>
              <button type="button" className="pt-btn pt-btn-gold" disabled={!canPayNextTax(game, book)} onClick={() => act((g) => payTax(g, book))}>
                Pay {`{${tax.cost}}`}
              </button>
              <button type="button" className="pt-btn" onClick={() => act((g) => declineTax(g, book))}>
                Don&apos;t pay
              </button>
            </div>
          )}
          {/* A choice waiting on you (Kefka's discard, a sacrifice). */}
          {choicePrompt && (
            <div className="pt-choice" role="status">
              {choicePrompt}
              {game.choice?.decline && (
                <button type="button" className="pt-btn" onClick={decline}>
                  {game.choice.decline}
                </button>
              )}
            </div>
          )}
          {/* The opponent's spell, big while it's cast. */}
          {spotlight && (
            <div className="pt-spot" aria-live="polite" data-asking={pending?.kind === "spell" ? "true" : undefined}>
              <div className="pt-spot-card">
                <CardArt name={spotlight.card.name} src={spotlight.card.imageUri || undefined} prefer="src" version="normal" loading="eager" radius={0} style={{ position: "absolute", inset: 0 }} />
              </div>
              <div className="pt-spot-side">
                <div className="pt-spot-caption">
                  The opponent casts {spotlight.card.name.split(" // ")[0]}
                  {spotlight.target ? ` → ${spotlight.target.split(" // ")[0]}` : ""}
                </div>
                {pending?.kind === "spell" && <div className="pt-spot-actions">{answerButtons}</div>}
              </div>
            </div>
          )}
          <div className="pt-main">
            <aside className="pt-zones">
              {/* The opponent's piles and commander, then yours, as each side of the table. */}
              <div className="pt-zones-title pt-zones-title-opp">
                <b>{setup.opp.label}</b>
                <div className="pt-side-life">
                  <LifeCounter label="Opp" value={opp.life} onDelta={(d) => act((g) => adjustLife(g, "opp", d, book))} />
                </div>
                <span>
                  Hand {opp.hand.length} · Library {opp.library.length}
                  {opp.exile.length > 0 && (
                    <>
                      {" · "}
                      <button type="button" className="pt-link" onClick={() => setPile({ seat: "opp", zone: "exile" })}>
                        Exile {opp.exile.length}
                      </button>
                    </>
                  )}
                  {game.commanderGame ? ` · Cmdr → you ${game.cmdDamage.you}` : ""}
                </span>
              </div>
              <PileZone label="Graveyard" cards={opp.graveyard} top={opp.graveyard[opp.graveyard.length - 1]} onOpen={() => setPile({ seat: "opp", zone: "graveyard" })} />
              {commandPile("opp")}
              <div className="pt-zones-title">
                <b>You</b>
                <div className="pt-side-life">
                  <LifeCounter label="You" value={you.life} onDelta={(d) => act((g) => adjustLife(g, "you", d, book))} />
                </div>
                {game.commanderGame && <span>Cmdr → opp {game.cmdDamage.opp}</span>}
              </div>
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
              {commandPile("you")}
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
                    {game.commanderGame && (
                  <span title={`Commander damage to you: ${game.cmdDamage.you}`}>
                    <span className="pt-long">Commander damage to you</span>
                    <span className="pt-short">Cmdr → you</span> {game.cmdDamage.you}
                  </span>
                )}
                  </span>
                  {commandZone("opp")}
                </div>
                {/* Its cards: rows down the board, or one sideways row on a phone held sideways. */}
                <div className="pt-side-cards" style={lineFit(opp.battlefield)}>
                  <div className="pt-row pt-opp-row">{row(opp.battlefield.filter((c) => !isLand(c)), "opp")}</div>
                  {opp.battlefield.some(isLand) && <div className="pt-row pt-opp-row pt-opp-lands">{landRow(opp.battlefield.filter(isLand), "opp")}</div>}
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
                <div className="pt-you-head">
                  <span className="pt-meta">
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
                    {game.commanderGame && (
                    <span title={`Commander damage to the opponent: ${game.cmdDamage.opp}`}>
                      <span className="pt-long">Commander damage to the opponent</span>
                      <span className="pt-short">Cmdr → opp</span> {game.cmdDamage.opp}
                    </span>
                  )}
                  </span>
                  {commandZone("you")}
                </div>
                <div className="pt-side-cards" style={lineFit(you.battlefield)}>
                  <div className="pt-row pt-row-perms">{row(you.battlefield.filter((c) => !isLand(c)), "you")}</div>
                  {you.battlefield.some(isLand) && <div className="pt-row pt-row-lands">{landRow(you.battlefield.filter(isLand), "you")}</div>}
                </div>
              </div>
            </section>

          </div>

          <footer className="pt-hand" style={{ ["--pt-hand" as string]: "var(--pt-hand-max)", ["--pt-n" as string]: Math.max(1, you.hand.length) }} data-up={handUp || mode === "mulligan" ? "true" : undefined}>
            {mode !== "mulligan" && <HandToggle up={handUp} count={you.hand.length} onToggle={setHandUp} />}
            <div className="pt-hand-cards">
              {you.hand.length === 0 ? <div className="pt-empty">No cards in hand.</div> : you.hand.map((c) => <PtCard key={c.iid} {...cardProps("you")(c, "hand")} />)}
            </div>
          </footer>
        </div>
        {/* Beside the board and the hand, full height, where there's room (a
            wide screen, a phone held sideways): the table talk, the last
            spells cast, like the stack, and the game so far. */}
        <aside className="pt-side" aria-label="Last played, and the game so far">
          <div className="pt-side-say" aria-live="polite">
            {(say || aiNote) && (
              <>
                <Bot size={14} strokeWidth={2.25} />
                <span>
                  {say ? `“${say}”` : ""} {aiNote && <em>{aiNote}</em>}
                </span>
              </>
            )}
          </div>
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

      {tokenOpen && (
        <Panel title="Create a token" onClose={() => setTokenOpen(false)}>
          <TokenMaker
            onCreate={(spec, count) => {
              act((g) => createTokens(g, "you", spec, count));
              setTokenOpen(false);
            }}
          />
        </Panel>
      )}

      {scryOpen && (
        <ScryPanel
          library={you.library}
          onZoom={onZoom}
          onClose={() => setScryOpen(false)}
          onDone={(top, bottom) => {
            act((g) => playerScry(g, top, bottom));
            setScryOpen(false);
          }}
        />
      )}
      {search &&
        (() => {
          const { spec } = search;
          const left = spec.count - search.found;
          const dest = spec.to[Math.min(search.found, spec.to.length - 1)]!;
          const where = dest.zone === "hand" ? "into your hand" : dest.zone === "top" ? "on top of your library, after the shuffle" : `onto the battlefield${dest.tapped ? " tapped" : ""}`;
          const matches = you.library
            .filter((c) => !search.top.includes(c.iid) && spec.test(c.typeLine, infoOf(book, c)))
            .sort((a, b) => a.name.localeCompare(b.name));
          const finish = (top = search.top) => {
            act((g) => finishSearch(g, top));
            setSearch(null);
          };
          // One move per pick, the shuffle included when it's the last:
          // two moves from one click would both start from the same game.
          const pick = (c: PlayCard) => {
            const top = dest.zone === "top" ? [...search.top, c.iid] : search.top;
            const last = search.found + 1 >= spec.count;
            act((g) => {
              const found = dest.zone === "top" ? g : playerFind(g, c.iid, dest.zone as "hand" | "battlefield", !!dest.tapped, book, search.attachTo);
              return last ? finishSearch(found, top) : found;
            });
            setSearch(last ? null : { ...search, found: search.found + 1, top });
          };
          return (
            <Panel title={`Search your library · ${search.source}`} onClose={() => finish()}>
              <p className="pt-panel-note">
                {left > 1 ? `Pick up to ${left} more: ` : "Pick "}
                {spec.count === 1 ? (/^[aeiou]/i.test(spec.what) ? "an " : "a ") : ""}
                {spec.what}. {left > 1 ? "This one goes" : "It goes"} {where}. {matches.length} in your library.
                <button type="button" className="pt-btn" style={{ marginLeft: 10 }} onClick={() => finish()}>
                  {search.found ? "Done" : "Find nothing"}
                </button>
              </p>
              {matches.length === 0 ? (
                <div className="pt-empty">Nothing in your library matches.</div>
              ) : (
                <div className="pt-row">
                  {matches.map((c) => (
                    <PtCard key={c.iid} {...cardProps("you")(c, "library")} onPrimary={() => pick(c)} />
                  ))}
                </div>
              )}
            </Panel>
          );
        })()}

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
          {opp.hand.length > 0 && <p className="pt-over-hand">It was holding {opp.hand.map((c) => c.name).join(", ")}.</p>}
          {recordLine && <p className="pt-over-record">{recordLine}</p>}
        </div>
      )}

      {review?.open && (
        <Panel title="The game, reviewed" onClose={() => setReview((r) => (r ? { ...r, open: false } : r))}>
          <div className="pt-review">
            {review.error ? (
              <p className="pt-pick-error" role="alert">
                {review.error}
              </p>
            ) : review.text ? (
              <PrimerMarkdown text={review.text} />
            ) : (
              <p className="pt-pick-wait">
                <Loader2 size={16} className="spin" /> Reading the game…
              </p>
            )}
            {review.busy && review.text && (
              <p className="pt-pick-wait" style={{ marginTop: 10 }}>
                <Loader2 size={14} className="spin" /> Writing…
              </p>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}

/* The tokens players make most, and any other. */
const TOKEN_PRESETS: TokenSpec[] = [
  { name: "Treasure", power: 0, toughness: 0, keywords: [], kind: "artifact" },
  { name: "Food", power: 0, toughness: 0, keywords: [], kind: "artifact" },
  { name: "Clue", power: 0, toughness: 0, keywords: [], kind: "artifact" },
  { name: "Soldier", power: 1, toughness: 1, keywords: [], kind: "creature" },
  { name: "Goblin", power: 1, toughness: 1, keywords: [], kind: "creature" },
  { name: "Spirit", power: 1, toughness: 1, keywords: ["Flying"], kind: "creature" },
  { name: "Zombie", power: 2, toughness: 2, keywords: [], kind: "creature" },
  { name: "Wolf", power: 2, toughness: 2, keywords: [], kind: "creature" },
  { name: "Beast", power: 3, toughness: 3, keywords: [], kind: "creature" },
  { name: "Angel", power: 4, toughness: 4, keywords: ["Flying"], kind: "creature" },
];

function TokenMaker({ onCreate }: { onCreate: (spec: TokenSpec, count: number) => void }) {
  const [count, setCount] = useState(1);
  const [name, setName] = useState("");
  const [power, setPower] = useState(1);
  const [toughness, setToughness] = useState(1);
  const [keywords, setKeywords] = useState("");
  const custom: TokenSpec = {
    name: name.trim() || "Token",
    power,
    toughness,
    keywords: keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .map((k) => k[0]!.toUpperCase() + k.slice(1)),
    kind: "creature",
  };
  return (
    <div className="pt-tokens">
      <label className="pt-tokens-count">
        How many
        <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
      </label>
      <div className="pt-tokens-grid">
        {TOKEN_PRESETS.map((t) => (
          <button key={t.name} type="button" className="pt-pick-option" onClick={() => onCreate(t, count)}>
            <span className="pt-pick-label">{t.name}</span>
            <span className="pt-pick-detail">
              {t.kind === "artifact" ? (t.name === "Treasure" ? "Artifact · pays one mana of any colour" : "Artifact") : `${t.power}/${t.toughness}${t.keywords.length ? ` · ${t.keywords.join(", ")}` : ""}`}
            </span>
          </button>
        ))}
      </div>
      <div className="pt-zone-label" style={{ marginTop: 14 }}>
        Another creature
      </div>
      <div className="pt-tokens-custom">
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Token name" />
        <input type="number" min={0} max={99} value={power} onChange={(e) => setPower(Number(e.target.value) || 0)} aria-label="Power" />
        <span>/</span>
        <input type="number" min={1} max={99} value={toughness} onChange={(e) => setToughness(Math.max(1, Number(e.target.value) || 1))} aria-label="Toughness" />
        <input placeholder="Keywords: flying, haste" value={keywords} onChange={(e) => setKeywords(e.target.value)} aria-label="Keywords" />
        <button type="button" className="pt-btn pt-btn-gold" onClick={() => onCreate(custom, count)}>
          Create
        </button>
      </div>
    </div>
  );
}
