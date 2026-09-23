// The playtest table: the zones of a solo ("goldfish") game and the moves
// between them. Pure and non-mutating, so the UI is a thin layer over it and
// the rules that matter — the London mulligan, the turn structure, where a
// cast spell ends up — are testable without a browser.

import { shuffled } from "./probability";

export type Zone = "library" | "hand" | "battlefield" | "graveyard" | "exile" | "command";

export interface CardLike {
  name: string;
  imageUri: string;
  typeLine: string | null;
  quantity?: number;
}

/** One physical card. A playset is four PlayCards with four iids. */
export interface PlayCard {
  iid: number;
  name: string;
  imageUri: string;
  typeLine: string | null;
  tapped: boolean;
  commander: boolean;
}

export interface PlaytestState {
  /** Index 0 is the top of the library. */
  library: PlayCard[];
  hand: PlayCard[];
  battlefield: PlayCard[];
  /** The last element is the top (most recent) card. */
  graveyard: PlayCard[];
  exile: PlayCard[];
  command: PlayCard[];
  turn: number;
  life: number;
  oppLife: number;
  /** Mulligans taken this game. */
  mulligans: number;
  /** London mulligan: cards still owed to the bottom of the library. */
  toBottom: number;
}

export type Shuffle = <T>(items: T[]) => T[];

const ZONES: Zone[] = ["library", "hand", "battlefield", "graveyard", "exile", "command"];

const frontFace = (typeLine: string | null) => (typeLine ?? "").split(" // ")[0]!;
export const isLandCard = (typeLine: string | null) => /\bLand\b/.test(typeLine ?? "");
/** Instants and sorceries don't stay: cast from hand, they resolve to the graveyard. */
export const resolvesToGraveyard = (typeLine: string | null) => /\b(Instant|Sorcery)\b/.test(frontFace(typeLine));

/**
 * Deal a new game: expand quantities into individual cards, seat the commander
 * (or each partner of an "A + B" pair) in the command zone, shuffle, draw seven.
 */
export function startGame(
  cards: CardLike[],
  opts: { commander?: string | null; startingLife?: number; shuffle?: Shuffle } = {}
): PlaytestState {
  const shuffle = opts.shuffle ?? shuffled;
  let iid = 1;
  const all: PlayCard[] = [];
  for (const c of cards) {
    const n = Math.max(1, Math.floor(c.quantity ?? 1));
    for (let i = 0; i < n; i++) {
      all.push({ iid: iid++, name: c.name, imageUri: c.imageUri, typeLine: c.typeLine, tapped: false, commander: false });
    }
  }
  const command: PlayCard[] = [];
  const names = (opts.commander ?? "")
    .split("+")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const name of names) {
    const idx = all.findIndex((c) => c.name.trim().toLowerCase() === name);
    if (idx >= 0) command.push({ ...all.splice(idx, 1)[0]!, commander: true });
  }
  const life = opts.startingLife ?? 20;
  const state: PlaytestState = {
    library: shuffle(all),
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    command,
    turn: 1,
    life,
    oppLife: life,
    mulligans: 0,
    toBottom: 0,
  };
  return draw(state, 7);
}

export function draw(state: PlaytestState, n = 1): PlaytestState {
  if (n <= 0 || state.library.length === 0) return state;
  const taken = state.library.slice(0, n);
  return { ...state, library: state.library.slice(taken.length), hand: [...state.hand, ...taken] };
}

/** London mulligan: shuffle the hand back, draw seven, then owe N cards to the bottom. */
export function mulligan(state: PlaytestState, shuffle: Shuffle = shuffled): PlaytestState {
  if (state.mulligans >= 6) return state;
  const mulligans = state.mulligans + 1;
  const library = shuffle([...state.library, ...state.hand.map((c) => ({ ...c, tapped: false }))]);
  return draw({ ...state, library, hand: [], mulligans, toBottom: mulligans }, 7);
}

/** Pay one card of the mulligan debt: hand → bottom of the library. */
export function bottomCard(state: PlaytestState, iid: number): PlaytestState {
  if (state.toBottom <= 0 || !state.hand.some((c) => c.iid === iid)) return state;
  return moveCard(state, iid, "library", { position: "bottom" });
}

export function zoneOf(state: PlaytestState, iid: number): Zone | null {
  for (const z of ZONES) if (state[z].some((c) => c.iid === iid)) return z;
  return null;
}

/** Move a card to any zone. It arrives untapped; the library takes it on top unless told the bottom. */
export function moveCard(
  state: PlaytestState,
  iid: number,
  to: Zone,
  opts: { position?: "top" | "bottom" } = {}
): PlaytestState {
  const from = zoneOf(state, iid);
  if (!from) return state;
  const card = { ...state[from].find((c) => c.iid === iid)!, tapped: false };
  const next = { ...state, [from]: state[from].filter((c) => c.iid !== iid) } as PlaytestState;
  const target = [...next[to]];
  if (to === "library" && opts.position !== "bottom") target.unshift(card);
  else target.push(card);
  // Hand → bottom of library while a mulligan debt is owed pays the debt,
  // whichever control did it.
  const toBottom = from === "hand" && to === "library" && opts.position === "bottom" && state.toBottom > 0 ? state.toBottom - 1 : state.toBottom;
  return { ...next, [to]: target, toBottom } as PlaytestState;
}

/** The natural play of a card: from hand, a permanent goes to the battlefield
    and an instant or sorcery resolves to the graveyard; a commander is cast
    from the command zone. Anything else is not a play. */
export function play(state: PlaytestState, iid: number): PlaytestState {
  const from = zoneOf(state, iid);
  if (from === "hand") {
    const card = state.hand.find((c) => c.iid === iid)!;
    return moveCard(state, iid, resolvesToGraveyard(card.typeLine) ? "graveyard" : "battlefield");
  }
  if (from === "command") return moveCard(state, iid, "battlefield");
  return state;
}

export function toggleTap(state: PlaytestState, iid: number): PlaytestState {
  if (!state.battlefield.some((c) => c.iid === iid)) return state;
  return { ...state, battlefield: state.battlefield.map((c) => (c.iid === iid ? { ...c, tapped: !c.tapped } : c)) };
}

export function untapAll(state: PlaytestState): PlaytestState {
  if (!state.battlefield.some((c) => c.tapped)) return state;
  return { ...state, battlefield: state.battlefield.map((c) => (c.tapped ? { ...c, tapped: false } : c)) };
}

/** Untap, draw, next turn. */
export function nextTurn(state: PlaytestState): PlaytestState {
  return { ...draw(untapAll(state), 1), turn: state.turn + 1 };
}

export function shuffleLibrary(state: PlaytestState, shuffle: Shuffle = shuffled): PlaytestState {
  return { ...state, library: shuffle(state.library) };
}

export function adjustLife(state: PlaytestState, who: "you" | "opp", delta: number): PlaytestState {
  return who === "you" ? { ...state, life: state.life + delta } : { ...state, oppLife: state.oppLife + delta };
}
