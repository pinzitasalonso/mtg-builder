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
  /** A double-faced card showing its back. */
  flipped?: boolean;
  // ── Practice games (lib/practice) only; all cleared when the card leaves
  // the battlefield. ──
  /** The game turn it came onto the battlefield (summoning sickness). */
  enteredTurn?: number;
  /** Damage marked this turn. */
  damage?: number;
  /** +1/+1 counters. */
  counters?: number;
  /** Until end of turn. */
  pump?: { power: number; toughness: number };
  /** A token: its own stats. It ceases to exist off the battlefield. */
  /** A token: its stats, and whether it's an artifact (Treasure, Food,
      Clue) rather than a creature. */
  token?: { power: number; toughness: number; keywords: string[]; kind?: "creature" | "artifact" };
  /** Keywords until end of turn ("gains indestructible until end of turn"). */
  eot?: string[];
  /** What other permanents give it while they're there: lords ("Other Elves
      you control get +1/+1"), the Auras on it, "All creatures have haste".
      Worked out again after every move (lib/practice refreshStatics). */
  boost?: { power: number; toughness: number; keywords: string[] };
  /** An Aura or an Equipment: the permanent it's attached to. */
  attachedTo?: number;
  /** A token that's a copy of a card (Inalla): it ceases to exist off the
      battlefield, like any token. */
  copy?: boolean;
  /** Exiled at the beginning of the next end step (Inalla's copies). */
  exileAtEnd?: boolean;
  /** A planeswalker's loyalty counters. */
  loyalty?: number;
  /** Chrome Mox: the colours of the card exiled with it. */
  imprint?: string[];
  /** Age counters, for a cumulative upkeep (Mystic Remora). */
  age?: number;
  /** In hand for this turn only ("You may play them this turn", Jeska's
      Will): exiled at the end of the turn if it's still there. */
  fleeting?: boolean;
  /** A card that entered as a copy of another (Copy Enchantment, Clone):
      what it is itself, to go back to when it leaves the battlefield. */
  cloneOf?: { name: string; typeLine: string | null; imageUri: string };
  /** Put on top of its owner's library by their own tutor this turn
      (Mystical Tutor): the opponent's Necropotence takes it at the end step. */
  sought?: boolean;
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

/** The kinds a side's nonland permanents are laid out by, in order: its
    creatures first, then planeswalkers, artifacts, enchantments, the rest. */
const KIND_ORDER = ["creature", "planeswalker", "artifact", "enchantment"] as const;

/** A card's kind on the table, from its type line: an artifact creature is
    a creature. */
export function kindOf(typeLine: string | null | undefined): number {
  const type = (typeLine ?? "").split(" // ")[0]!.toLowerCase();
  const i = KIND_ORDER.findIndex((k) => type.includes(k));
  return i < 0 ? KIND_ORDER.length : i;
}

/** A side's nonland permanents in the order the table shows them: grouped
    by kind (a Mana Vault isn't left between two creatures), each group in
    the order its cards arrived, its tokens last and same-named together. */
export function byKind<T extends { name: string; token?: unknown }>(cards: T[], typeOf: (c: T) => string | null | undefined): T[] {
  return cards
    .map((c, i) => ({ c, i, kind: kindOf(typeOf(c)) }))
    .sort((a, b) => a.kind - b.kind || Number(!!a.c.token) - Number(!!b.c.token) || (a.c.token && b.c.token ? a.c.name.localeCompare(b.c.name) : 0) || a.i - b.i)
    .map((x) => x.c);
}

/** Where the creatures end and the rest begins: the table leaves a wider
    gap there (`.pt-kind-gap`), so the two read as two groups. */
export function kindBreak<T>(sorted: T[], i: number, typeOf: (c: T) => string | null | undefined): boolean {
  return i > 0 && kindOf(typeOf(sorted[i]!)) > 0 && kindOf(typeOf(sorted[i - 1]!)) === 0;
}
/** That gap's own width, in px (the styles' `.pt-kind-gap`). */
export const KIND_GAP = 6;
/** Instants and sorceries don't stay: cast from hand, they resolve to the graveyard. */
export const resolvesToGraveyard = (typeLine: string | null) => /\b(Instant|Sorcery)\b/.test(frontFace(typeLine));

/** The type line of the face that's up: a turned-over card shows its back.
    A modal card with a land back (Shatterskull Smashing) is a sorcery face
    up, and a land turned over. */
export const faceUpType = (card: { typeLine: string | null; flipped?: boolean }): string => {
  const faces = (card.typeLine ?? "").split(" // ");
  return (card.flipped && faces[1] ? faces[1] : faces[0]) ?? "";
};

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
      all.push({ iid: iid++, name: c.name, imageUri: c.imageUri, typeLine: c.typeLine, tapped: false, commander: false, flipped: false });
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

/** Scry: the cards looked at go back, those in `top` on top of the
    library in that order (the first on top), those in `bottom` at the
    bottom in that order. Unchanged if any of them isn't in the library. */
export function scry(state: PlaytestState, top: number[], bottom: number[]): PlaytestState {
  const seen = new Set([...top, ...bottom]);
  const byId = new Map(state.library.map((c) => [c.iid, c]));
  if (!seen.size || [...seen].some((iid) => !byId.has(iid))) return state;
  const rest = state.library.filter((c) => !seen.has(c.iid));
  return { ...state, library: [...top.map((iid) => byId.get(iid)!), ...rest, ...bottom.map((iid) => byId.get(iid)!)] };
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

/** Move a card to any zone. It arrives untapped; the library takes it on top unless told the bottom.
    A card turned over keeps that face onto the battlefield (the back of a
    modal card is how it's cast); anywhere else it goes back to its front. */
export function moveCard(
  state: PlaytestState,
  iid: number,
  to: Zone,
  opts: { position?: "top" | "bottom" } = {}
): PlaytestState {
  const from = zoneOf(state, iid);
  if (!from) return state;
  const found = state[from].find((c) => c.iid === iid)!;
  const card: PlayCard = { ...found, tapped: false, flipped: to === "battlefield" ? !!found.flipped : false };
  delete card.fleeting;
  delete card.sought;
  if (from === "battlefield" && to !== "battlefield") {
    delete card.enteredTurn;
    delete card.damage;
    delete card.counters;
    delete card.pump;
    delete card.eot;
    delete card.boost;
    delete card.attachedTo;
    delete card.exileAtEnd;
    delete card.loyalty;
    delete card.imprint;
    delete card.age;
    // A copy is itself again.
    if (card.cloneOf) {
      card.name = card.cloneOf.name;
      card.typeLine = card.cloneOf.typeLine;
      card.imageUri = card.cloneOf.imageUri;
      delete card.cloneOf;
    }
  }
  let next = { ...state, [from]: state[from].filter((c) => c.iid !== iid) } as PlaytestState;
  // What was attached to it stays in play, attached to nothing.
  if (from === "battlefield" && to !== "battlefield" && next.battlefield.some((c) => c.attachedTo === iid)) {
    next = { ...next, battlefield: next.battlefield.map((c) => (c.attachedTo === iid ? { ...c, attachedTo: undefined } : c)) };
  }
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
    // The face that's up is what's played: turn a modal card over to play its land.
    return moveCard(state, iid, resolvesToGraveyard(faceUpType(card)) ? "graveyard" : "battlefield");
  }
  if (from === "command") return moveCard(state, iid, "battlefield");
  return state;
}

export function toggleTap(state: PlaytestState, iid: number): PlaytestState {
  if (!state.battlefield.some((c) => c.iid === iid)) return state;
  return { ...state, battlefield: state.battlefield.map((c) => (c.iid === iid ? { ...c, tapped: !c.tapped } : c)) };
}

/** Turn a double-faced card over, in any zone but the library (face down). */
export function turnOver(state: PlaytestState, iid: number): PlaytestState {
  const zone = zoneOf(state, iid);
  if (!zone || zone === "library") return state;
  return { ...state, [zone]: state[zone].map((c) => (c.iid === iid ? { ...c, flipped: !c.flipped } : c)) } as PlaytestState;
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

/** Whether a card attaches to another: an Equipment or an Aura. */
export const attaches = (card: PlayCard) => /\b(Equipment|Aura)\b/.test(card.typeLine ?? "");

/** Put an Equipment or an Aura on another permanent of the battlefield.
    (The solo table leaves the rules to you: any permanent will do.) */
export function attachCard(state: PlaytestState, iid: number, host: number): PlaytestState {
  if (iid === host) return state;
  const card = state.battlefield.find((c) => c.iid === iid);
  if (!card || !state.battlefield.some((c) => c.iid === host)) return state;
  // Not onto something that is itself attached to this card.
  if (state.battlefield.find((c) => c.iid === host)?.attachedTo === iid) return state;
  return { ...state, battlefield: state.battlefield.map((c) => (c.iid === iid ? { ...c, attachedTo: host } : c)) };
}

/** Take a card off what it's attached to. */
export function detachCard(state: PlaytestState, iid: number): PlaytestState {
  if (!state.battlefield.some((c) => c.iid === iid && c.attachedTo !== undefined)) return state;
  return { ...state, battlefield: state.battlefield.map((c) => (c.iid === iid ? { ...c, attachedTo: undefined } : c)) };
}
