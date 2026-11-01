// A practice game against the AI: two sides, each the solo playtest's zones
// (lib/playtest), and the bookkeeping that makes it a game — turns, the land
// drop, summoning sickness, mana, damage, combat, commander tax and damage,
// and who has won. Pure: every move returns a new game. See
// docs/practice-vs-ai.md.
//
// Your side is played by hand, as in the solo playtest: nothing you do is
// refused. The AI's moves are checked: a spell it can't pay for, or a target
// that isn't there, is skipped and logged.

import { draw, faceUpType, moveCard, resolvesToGraveyard, type PlayCard, type PlaytestState, type Shuffle, type Zone } from "../playtest";
import { shuffled } from "../probability";
import { canPlayAsLand, counterOf, entersTapped, fetchOf, has, infoOf, isBlue, isCreature, isLand, isSick, manaOutput, shockLife, stats } from "./cards";
import { manaSources, parseCost, payCost, poolSources, type Source } from "./mana";
import { other, type CardBook, type Combat, type Effect, type PlanAction, type PracticeGame, type Seat } from "./types";

export interface DeckCard {
  name: string;
  imageUri: string;
  typeLine: string | null;
  quantity?: number;
}

const ZONES: Zone[] = ["library", "hand", "battlefield", "graveyard", "exile", "command"];
export const OPP_IID_BASE = 10_000;
const TOKEN_IID_BASE = 50_000;
const LOG_CAP = 200;

/** "c123" ↔ 123: how cards are named to the AI. */
export const cardId = (iid: number) => `c${iid}`;
export const parseCardId = (ref: string | null | undefined) => {
  const m = /^c(\d+)$/.exec((ref ?? "").trim());
  return m ? Number(m[1]) : null;
};

function seatSide(cards: DeckCard[], commander: string | null | undefined, life: number, firstIid: number, shuffle: Shuffle): PlaytestState {
  let iid = firstIid;
  const all: PlayCard[] = [];
  for (const c of cards) {
    const n = Math.max(1, Math.floor(c.quantity ?? 1));
    for (let i = 0; i < n; i++) all.push({ iid: iid++, name: c.name, imageUri: c.imageUri, typeLine: c.typeLine, tapped: false, commander: false, flipped: false });
  }
  const command: PlayCard[] = [];
  for (const name of (commander ?? "").split("+").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    const at = all.findIndex((c) => c.name.trim().toLowerCase() === name);
    if (at >= 0) command.push({ ...all.splice(at, 1)[0]!, commander: true });
  }
  return draw(
    { library: shuffle(all), hand: [], battlefield: [], graveyard: [], exile: [], command, turn: 1, life, oppLife: life, mulligans: 0, toBottom: 0 },
    7
  );
}

/** Deal a game: both decks shuffled, seven cards each, commanders seated. */
export function newGame(input: {
  you: { cards: DeckCard[]; commander?: string | null };
  opp: { cards: DeckCard[]; commander?: string | null };
  commanderGame: boolean;
  first: Seat;
  shuffle?: Shuffle;
}): PracticeGame {
  const shuffle = input.shuffle ?? shuffled;
  const life = input.commanderGame ? 40 : 20;
  const g: PracticeGame = {
    sides: {
      you: seatSide(input.you.cards, input.commanderGame ? input.you.commander : null, life, 1, shuffle),
      opp: seatSide(input.opp.cards, input.commanderGame ? input.opp.commander : null, life, OPP_IID_BASE + 1, shuffle),
    },
    turn: 1,
    active: input.first,
    first: input.first,
    landPlayed: false,
    combat: null,
    log: [],
    winner: null,
    cmdDamage: { you: 0, opp: 0 },
    tax: { you: 0, opp: 0 },
    commanderGame: input.commanderGame,
    nextIid: TOKEN_IID_BASE,
  };
  say(g, null, `${input.first === "you" ? "You go" : "The opponent goes"} first.`);
  return g;
}

// ── Internals: these mutate a game that the exported move has cloned. ──

function say(g: PracticeGame, seat: Seat | null, text: string, card?: PlayCard) {
  g.log.push(card ? { seat, text, card: { iid: card.iid, name: card.name, imageUri: card.imageUri } } : { seat, text });
  if (g.log.length > LOG_CAP) g.log.splice(0, g.log.length - LOG_CAP);
}

export function findCard(g: PracticeGame, iid: number): { seat: Seat; zone: Zone; card: PlayCard } | null {
  for (const seat of ["you", "opp"] as Seat[]) {
    for (const zone of ZONES) {
      const card = g.sides[seat][zone].find((c) => c.iid === iid);
      if (card) return { seat, zone, card };
    }
  }
  return null;
}

/** Move a card within its owner's zones; a token leaving play is gone. */
function moveTo(g: PracticeGame, iid: number, to: Zone, opts: { tapped?: boolean; bottom?: boolean } = {}) {
  const at = findCard(g, iid);
  if (!at) return;
  const side = g.sides[at.seat];
  if (at.card.token && to !== "battlefield") {
    g.sides[at.seat] = { ...side, [at.zone]: side[at.zone].filter((c) => c.iid !== iid) };
    return;
  }
  let next = moveCard(side, iid, to, { position: opts.bottom ? "bottom" : "top" });
  if (to === "battlefield") {
    next = { ...next, battlefield: next.battlefield.map((c) => (c.iid === iid ? { ...c, enteredTurn: g.turn, tapped: !!opts.tapped } : c)) };
  }
  g.sides[at.seat] = next;
}

function update(g: PracticeGame, iid: number, fn: (c: PlayCard) => PlayCard) {
  const at = findCard(g, iid);
  if (!at) return;
  const side = g.sides[at.seat];
  g.sides[at.seat] = { ...side, [at.zone]: side[at.zone].map((c) => (c.iid === iid ? fn(c) : c)) };
}

function drawCards(g: PracticeGame, seat: Seat, n: number) {
  const side = g.sides[seat];
  if (side.library.length < n) {
    g.sides[seat] = draw(side, side.library.length);
    if (!g.winner) {
      g.winner = other(seat);
      say(g, seat, `${seat === "you" ? "You" : "The opponent"} drew from an empty library and lost.`);
    }
    return;
  }
  g.sides[seat] = draw(side, n);
}

/** State-based checks: creatures with lethal damage die, then life and
    commander damage settle the game. */
function checkState(g: PracticeGame, book: CardBook) {
  for (const seat of ["you", "opp"] as Seat[]) {
    for (const c of [...g.sides[seat].battlefield]) {
      if (!isCreature(book, c)) continue;
      const { toughness } = stats(book, c);
      const dead = toughness <= 0 || ((c.damage ?? 0) >= toughness && !has(book, c, "Indestructible"));
      if (dead) {
        moveTo(g, c.iid, "graveyard");
        say(g, seat, `${c.name} dies.`);
      }
    }
  }
  if (g.winner) return;
  for (const seat of ["you", "opp"] as Seat[]) {
    if (g.sides[seat].life <= 0) {
      g.winner = other(seat);
      say(g, null, seat === "you" ? "You're out of life. The opponent wins." : "The opponent is out of life. You win!");
      return;
    }
    if (g.commanderGame && g.cmdDamage[seat] >= 21) {
      g.winner = other(seat);
      say(g, null, seat === "you" ? "21 commander damage. The opponent wins." : "21 commander damage. You win!");
      return;
    }
  }
}

const who = (seat: Seat) => (seat === "you" ? "You" : "The opponent");

// ── Mana ───────────────────────────────────────────────────────────────

/** What a seat can pay with now: its floating mana, then its untapped
    sources. */
export function availableMana(g: PracticeGame, seat: Seat, book: CardBook, exclude: number[] = []): Source[] {
  return [...poolSources(g.pool?.[seat]), ...manaSources(g.sides[seat], book, g.turn, exclude)];
}

/** Pay: tap the sources (sacrificing the one-shot ones) and spend the
    floating mana that was used. */
function spend(g: PracticeGame, seat: Seat, tap: number[], sources: Source[]) {
  const floating = new Set(tap.filter((t) => t < 0).map((t) => -t - 1));
  if (floating.size && g.pool) g.pool[seat] = g.pool[seat].filter((_, i) => !floating.has(i));
  for (const t of tap) {
    if (t < 0) continue;
    if (sources.find((x) => x.iid === t)?.sacrifice) {
      const name = findCard(g, t)?.card.name;
      moveTo(g, t, "graveyard");
      say(g, seat, `${who(seat)} sacrifice${seat === "you" ? "" : "s"} ${name} for mana.`);
    } else update(g, t, (c) => ({ ...c, tapped: true }));
  }
}

const emptyPool = (g: PracticeGame, seat?: Seat) => {
  if (!g.pool) g.pool = { you: [], opp: [] };
  if (seat) g.pool[seat] = [];
  else g.pool = { you: [], opp: [] };
};

/** A land the AI plays: a shock land enters untapped for 2 life while
    that's affordable; a fetch land cracks at once for the land that best
    fits the hand. */
function aiLandEnters(g: PracticeGame, seat: Seat, land: PlayCard, book: CardBook) {
  const info = infoOf(book, land);
  const shock = shockLife(info);
  const untappedShock = shock > 0 && g.sides[seat].life > 6;
  moveTo(g, land.iid, "battlefield", { tapped: shock > 0 ? !untappedShock : entersTapped(info) });
  if (untappedShock) {
    g.sides[seat] = { ...g.sides[seat], life: g.sides[seat].life - shock };
    say(g, seat, `${who(seat)} pay${seat === "you" ? "" : "s"} ${shock} life for ${land.name} to enter untapped.`);
  }
  const fetch = fetchOf(info);
  if (!fetch) return;
  const side = g.sides[seat];
  const fits = side.library.filter((c) => {
    if (!isLand(c)) return false;
    const t = (infoOf(book, c)?.typeLine ?? c.typeLine ?? "").toLowerCase();
    if (fetch.basic && !t.includes("basic")) return false;
    return fetch.types.some((w) => w === "land" || t.includes(w));
  });
  if (!fits.length) return;
  const have = new Set(manaSources(side, book, g.turn).flatMap((x) => x.colors));
  const need = new Set(side.hand.filter((c) => !isLand(c)).flatMap((c) => parseCost(infoOf(book, c)?.manaCost ?? null).pips.flat()));
  for (const c of side.command) for (const pip of parseCost(infoOf(book, c)?.manaCost ?? null).pips.flat()) need.add(pip);
  const score = (c: PlayCard) => {
    const colors = manaOutput(infoOf(book, c), c.typeLine)?.colors ?? [];
    return colors.filter((x) => need.has(x) && !have.has(x)).length * 10 + colors.length - (entersTapped(infoOf(book, c)) ? 5 : 0);
  };
  const pick = fits.reduce((a, b) => (score(b) > score(a) ? b : a));
  if (fetch.life) g.sides[seat] = { ...g.sides[seat], life: g.sides[seat].life - fetch.life };
  moveTo(g, land.iid, "graveyard");
  say(g, seat, `${who(seat)} crack${seat === "you" ? "" : "s"} ${land.name} for ${pick.name}.`);
  const pickInfo = infoOf(book, pick);
  const pickShock = shockLife(pickInfo);
  const pickUntapped = !fetch.tapped && (pickShock ? g.sides[seat].life > 6 : !entersTapped(pickInfo));
  moveTo(g, pick.iid, "battlefield", { tapped: !pickUntapped });
  if (pickShock && pickUntapped) {
    g.sides[seat] = { ...g.sides[seat], life: g.sides[seat].life - pickShock };
    say(g, seat, `${who(seat)} pay${seat === "you" ? "" : "s"} ${pickShock} life for ${pick.name} to enter untapped.`);
  }
  g.sides[seat] = { ...g.sides[seat], library: shuffled(g.sides[seat].library) };
}

// ── Turns ──────────────────────────────────────────────────────────────

/** The active player's turn begins: untap, and draw (not the first player
    on turn one). */
export function startTurn(g0: PracticeGame): PracticeGame {
  const g = structuredClone(g0);
  const seat = g.active;
  const side = g.sides[seat];
  g.sides[seat] = { ...side, battlefield: side.battlefield.map((c) => ({ ...c, tapped: false })) };
  g.landPlayed = false;
  say(g, seat, `Turn ${g.turn} — ${seat === "you" ? "your turn" : "the opponent's turn"}.`);
  if (g.turn > 1) drawCards(g, seat, 1);
  return g;
}

/** End the turn: damage and "until end of turn" wear off, and the other
    player's turn starts. */
export function endTurn(g0: PracticeGame): PracticeGame {
  if (g0.winner) return g0;
  const g = structuredClone(g0);
  for (const seat of ["you", "opp"] as Seat[]) {
    const side = g.sides[seat];
    g.sides[seat] = { ...side, battlefield: side.battlefield.map(({ damage: _d, pump: _p, ...c }) => c) };
  }
  g.combat = null;
  emptyPool(g);
  g.active = other(g.active);
  g.turn += 1;
  return startTurn(g);
}

// ── Your side (by hand) ────────────────────────────────────────────────

/** A card from your hand or command zone, played as the solo table would:
    a permanent onto the battlefield, an instant or sorcery to the graveyard.
    Not checked; you're the rules. */
export function playerPlay(g0: PracticeGame, iid: number): PracticeGame {
  const at = findCard(g0, iid);
  if (!at || at.seat !== "you" || (at.zone !== "hand" && at.zone !== "command")) return g0;
  const g = structuredClone(g0);
  const card = at.card;
  if (at.zone === "command") g.tax.you += 1;
  // The face that's up is what's played (turn a modal card over for its land).
  if (isLand(card) && at.zone === "hand") g.landPlayed = true;
  if (resolvesToGraveyard(faceUpType(card))) {
    moveTo(g, iid, "graveyard");
    say(g, "you", `You cast ${card.name}.`, card);
  } else {
    moveTo(g, iid, "battlefield");
    say(g, "you", `You ${isLand(card) ? "play" : "cast"} ${card.name}.`, isLand(card) ? undefined : card);
  }
  return g;
}

/** Any other move of one of your cards (the ⋯ menu), or of the opponent's,
    to resolve your own spells: destroy, exile, return to hand. */
export function moveAnyCard(g0: PracticeGame, iid: number, to: Zone, opts: { bottom?: boolean } = {}): PracticeGame {
  const at = findCard(g0, iid);
  if (!at || (at.zone === to && to !== "library")) return g0;
  const g = structuredClone(g0);
  moveTo(g, iid, to, opts);
  if (at.seat === "opp") {
    const verb = to === "graveyard" ? "destroy" : to === "exile" ? "exile" : to === "hand" ? "return" : "move";
    say(g, "you", `You ${verb} ${at.card.name}${to === "hand" ? " to its owner's hand" : ""}.`);
  }
  return g;
}

export function tapToggle(g0: PracticeGame, iid: number): PracticeGame {
  const at = findCard(g0, iid);
  if (!at || at.zone !== "battlefield") return g0;
  const g = structuredClone(g0);
  update(g, iid, (c) => ({ ...c, tapped: !c.tapped }));
  return g;
}

export function adjustLife(g0: PracticeGame, seat: Seat, delta: number, book: CardBook): PracticeGame {
  const g = structuredClone(g0);
  g.sides[seat] = { ...g.sides[seat], life: g.sides[seat].life + delta };
  checkState(g, book);
  return g;
}

/** Replace your side (a solo-table move: draw, mulligan, shuffle…). */
export function withYourSide(g0: PracticeGame, fn: (s: PlaytestState) => PlaytestState): PracticeGame {
  const next = fn(g0.sides.you);
  if (next === g0.sides.you) return g0;
  return { ...g0, sides: { ...g0.sides, you: next } };
}

// ── The AI's side (checked) ────────────────────────────────────────────

export interface Step {
  game: PracticeGame;
  ok: boolean;
}

/** Whether a card in the AI's hand (or command zone) can be cast now, and
    what it costs including commander tax. */
export function castable(g: PracticeGame, seat: Seat, card: PlayCard, book: CardBook, zone: Zone): boolean {
  if (isLand(card)) return zone === "hand" && !g.landPlayed && g.active === seat;
  const info = infoOf(book, card);
  const cost = parseCost(info?.manaCost ?? null);
  if (zone === "command") cost.generic += 2 * g.tax[seat];
  return payCost(cost, availableMana(g, seat, book)) !== null;
}

export function applyAction(g0: PracticeGame, seat: Seat, action: PlanAction, book: CardBook): Step {
  if (g0.winner) return { game: g0, ok: false };
  const iid = parseCardId(action.card);
  const at = iid === null ? null : findCard(g0, iid);
  const g = structuredClone(g0);
  const fail = (why: string) => {
    say(g, seat, why);
    return { game: g, ok: false };
  };
  if (!at || at.seat !== seat) return fail(`(The opponent tried to use a card it doesn't have.)`);
  const card = at.card;
  const info = infoOf(book, card);

  if (action.kind === "land") {
    if (at.zone !== "hand" || !canPlayAsLand(card)) return fail(`(The opponent tried to play ${card.name} as a land.)`);
    if (g.landPlayed) return fail(`(The opponent already played a land this turn.)`);
    g.landPlayed = true;
    // A modal card played as a land goes in land side up.
    const turned = !isLand(card);
    if (turned) update(g, card.iid, (c) => ({ ...c, flipped: true }));
    say(g, seat, `${who(seat)} plays ${turned ? `${card.name.split(" // ")[1] ?? card.name} (the land side of ${card.name.split(" // ")[0]})` : card.name}.`);
    aiLandEnters(g, seat, card, book);
    return { game: g, ok: true };
  }

  if (action.kind === "cast") {
    if (at.zone !== "hand" && at.zone !== "command") return fail(`(The opponent tried to cast ${card.name} from its ${at.zone}.)`);
    if (isLand(card)) return fail(`(The opponent tried to cast the land ${card.name}.)`);
    const cost = parseCost(info?.manaCost ?? null);
    if (at.zone === "command") cost.generic += 2 * g.tax[seat];
    const sources = availableMana(g, seat, book);
    const paid = payCost(cost, sources, { x: action.x ?? 0 });
    if (!paid) return fail(`The opponent can't pay for ${card.name} yet.`);
    spend(g, seat, paid.tap, sources);
    if (paid.life) g.sides[seat] = { ...g.sides[seat], life: g.sides[seat].life - paid.life };
    if (at.zone === "command") g.tax[seat] += 1;
    const x = cost.xCount ? ` (X = ${action.x ?? 0})` : "";
    say(g, seat, `${who(seat)} casts ${card.name}${x}.`, card);
    if (resolvesToGraveyard(card.typeLine)) {
      applyEffects(g, seat, action.effects, book, card.name);
      moveTo(g, card.iid, "graveyard");
    } else {
      moveTo(g, card.iid, "battlefield");
      applyEffects(g, seat, action.effects, book, card.name);
    }
    checkState(g, book);
    return { game: g, ok: true };
  }

  // activate
  // A fetch land already cracked itself when it was played.
  if (at.zone === "graveyard" && fetchOf(info)) return { game: g0, ok: true };
  if (at.zone !== "battlefield") return fail(`(The opponent tried to use ${card.name}, which isn't in play.)`);
  if (action.tap_card) {
    if (card.tapped) return fail(`(${card.name} is already tapped.)`);
    if (isCreature(book, card) && isSick(book, card, g.turn)) return fail(`(${card.name} can't tap the turn it arrived.)`);
  }
  const cost = parseCost(action.mana);
  const sources = availableMana(g, seat, book, action.tap_card ? [card.iid] : []);
  const paid = payCost(cost, sources, { life: action.life ?? 0 });
  if (!paid) return fail(`The opponent can't pay for ${card.name}'s ability.`);
  spend(g, seat, paid.tap, sources);
  if (action.tap_card) update(g, card.iid, (c) => ({ ...c, tapped: true }));
  if (paid.life) g.sides[seat] = { ...g.sides[seat], life: g.sides[seat].life - paid.life };
  if (action.sacrifice_card) moveTo(g, card.iid, "graveyard");
  say(g, seat, `${who(seat)} ${action.sacrifice_card ? "sacrifices" : "activates"} ${card.name}.`, card);
  applyEffects(g, seat, action.effects, book, card.name);
  checkState(g, book);
  return { game: g, ok: true };
}

/** The AI answers a spell the player has just cast: a hard counterspell
    from its hand, paid from its untapped mana (or its free alternative, for
    a big spell), when the spell is worth a card. A countered commander goes
    back to the command zone. Returns the game unchanged when it lets the
    spell be. */
export function aiResponds(g0: PracticeGame, iid: number, book: CardBook): PracticeGame {
  if (g0.winner) return g0;
  const at = findCard(g0, iid);
  if (!at || at.seat !== "you" || isLand(at.card)) return g0;
  const info = infoOf(book, at.card);
  const spell = { typeLine: info?.typeLine ?? at.card.typeLine ?? "", manaValue: info?.manaValue ?? 0, blue: isBlue(info) };
  const opp = g0.sides.opp;
  const options = opp.hand
    .map((c) => ({ c, k: counterOf(infoOf(book, c)) }))
    .filter((o): o is { c: PlayCard; k: NonNullable<typeof o.k> } => !!o.k && o.k.hits(spell))
    .sort((a, b) => (infoOf(book, a.c)?.manaValue ?? 0) - (infoOf(book, b.c)?.manaValue ?? 0));
  if (!options.length) return g0;
  const big = spell.manaValue >= 4 || at.card.commander;
  const commanderOut = opp.battlefield.some((c) => c.commander);
  for (const { c, k } of options) {
    // Worth a card: two mana or more, the commander, or the one spell this
    // counter was made for (Mental Misstep on a one-drop).
    const exact = !k.hits({ ...spell, manaValue: spell.manaValue + 1 });
    if (spell.manaValue < 2 && !at.card.commander && !exact) continue;
    const sources = availableMana(g0, "opp", book);
    const paid = payCost(parseCost(infoOf(book, c)?.manaCost ?? null), sources, { x: k.xIsValue ? spell.manaValue : 0 });
    let free: "commander" | "exile-blue" | null = null;
    let pitched: PlayCard | null = null;
    if (!paid && k.free === "commander" && commanderOut) free = "commander";
    if (!paid && !free && k.free === "exile-blue" && big) {
      pitched = opp.hand.find((x) => x.iid !== c.iid && !isLand(x) && isBlue(infoOf(book, x))) ?? null;
      if (pitched) free = "exile-blue";
    }
    if (!paid && !free) continue;
    const g = structuredClone(g0);
    if (paid) {
      spend(g, "opp", paid.tap, sources);
      if (paid.life) g.sides.opp = { ...g.sides.opp, life: g.sides.opp.life - paid.life };
    }
    if (pitched) {
      moveTo(g, pitched.iid, "exile");
      if (k.freeLife) g.sides.opp = { ...g.sides.opp, life: g.sides.opp.life - k.freeLife };
    }
    moveTo(g, c.iid, "graveyard");
    moveTo(g, iid, at.card.commander ? "command" : "graveyard");
    const how = pitched ? ` (exiling ${pitched.name})` : free === "commander" ? " (free: its commander is out)" : "";
    say(g, "opp", `The opponent counters ${at.card.name} with ${c.name}${how}.`, c);
    if (k.rider) say(g, "opp", `Resolve: ${k.rider}`);
    checkState(g, book);
    return g;
  }
  return g0;
}

const seatOf = (caster: Seat, p: "ai" | "player" | null): Seat => (p === "player" ? "you" : p === "ai" ? "opp" : caster);

function applyEffects(g: PracticeGame, caster: Seat, effects: Effect[], book: CardBook, source: string) {
  for (const e of effects.slice(0, 20)) {
    const amount = Math.max(0, Math.min(99, Math.floor(e.amount ?? 0)));
    const targetIid = parseCardId(e.target);
    const target = targetIid === null ? null : findCard(g, targetIid);
    const onField = target && target.zone === "battlefield" ? target : null;
    switch (e.type) {
      case "damage": {
        if (e.target === "player" || e.target === "ai") {
          const s = e.target === "player" ? "you" : "opp";
          g.sides[s] = { ...g.sides[s], life: g.sides[s].life - amount };
          say(g, caster, `${source} deals ${amount} damage to ${s === "you" ? "you" : "the opponent"}.`);
        } else if (onField && isCreature(book, onField.card)) {
          update(g, onField.card.iid, (c) => ({ ...c, damage: (c.damage ?? 0) + amount }));
          say(g, caster, `${source} deals ${amount} damage to ${onField.card.name}.`);
        }
        break;
      }
      case "life": {
        const s = seatOf(caster, e.player);
        const delta = Math.max(-99, Math.min(99, Math.floor(e.amount ?? 0)));
        g.sides[s] = { ...g.sides[s], life: g.sides[s].life + delta };
        say(g, caster, `${s === "you" ? "You" : "The opponent"} ${delta >= 0 ? "gains" : "loses"} ${Math.abs(delta)} life.`);
        break;
      }
      case "destroy":
      case "exile":
      case "bounce": {
        if (!onField) break;
        if (e.type === "destroy" && has(book, onField.card, "Indestructible")) {
          say(g, caster, `${onField.card.name} is indestructible.`);
          break;
        }
        moveTo(g, onField.card.iid, e.type === "destroy" ? "graveyard" : e.type === "exile" ? "exile" : "hand");
        const verb = e.type === "destroy" ? "destroys" : e.type === "exile" ? "exiles" : "returns";
        say(g, caster, `${source} ${verb} ${onField.card.name}${e.type === "bounce" ? " to its owner's hand" : ""}.`);
        break;
      }
      case "tap":
      case "untap": {
        if (!onField) break;
        update(g, onField.card.iid, (c) => ({ ...c, tapped: e.type === "tap" }));
        say(g, caster, `${source} ${e.type}s ${onField.card.name}.`);
        break;
      }
      case "draw": {
        const s = seatOf(caster, e.player);
        drawCards(g, s, amount);
        say(g, caster, `${s === "you" ? "You draw" : "The opponent draws"} ${amount}.`);
        break;
      }
      case "mill": {
        const s = seatOf(caster, e.player);
        for (const c of g.sides[s].library.slice(0, amount)) moveTo(g, c.iid, "graveyard");
        say(g, caster, `${s === "you" ? "You mill" : "The opponent mills"} ${amount}.`);
        break;
      }
      case "discard": {
        const s = seatOf(caster, e.player);
        if (s === "you") {
          say(g, caster, `Resolve: discard ${amount} card${amount === 1 ? "" : "s"} (${source}).`);
        } else {
          // The AI discards its most expensive cards it can't use yet.
          const hand = [...g.sides.opp.hand].sort((a, b) => (infoOf(book, b)?.manaValue ?? 0) - (infoOf(book, a)?.manaValue ?? 0));
          for (const c of hand.slice(0, amount)) {
            moveTo(g, c.iid, "graveyard");
            say(g, caster, `The opponent discards ${c.name}.`);
          }
        }
        break;
      }
      case "token": {
        const s = seatOf(caster, e.player);
        const count = Math.max(1, Math.min(10, Math.floor(e.amount ?? 1)));
        const name = (e.name ?? "Token").slice(0, 40);
        for (let i = 0; i < count; i++) {
          const token: PlayCard = {
            iid: g.nextIid++,
            name,
            imageUri: "",
            typeLine: "Token Creature",
            tapped: !!e.tapped,
            commander: false,
            enteredTurn: g.turn,
            token: { power: Math.max(0, e.power ?? 1), toughness: Math.max(1, e.toughness ?? 1), keywords: e.keywords.slice(0, 6) },
          };
          g.sides[s] = { ...g.sides[s], battlefield: [...g.sides[s].battlefield, token] };
        }
        say(g, caster, `${source} makes ${count} ${name} token${count === 1 ? "" : "s"} (${e.power ?? 1}/${e.toughness ?? 1}).`);
        break;
      }
      case "counters": {
        if (!onField || !isCreature(book, onField.card)) break;
        const n = Math.max(-20, Math.min(20, Math.floor(e.amount ?? 1)));
        update(g, onField.card.iid, (c) => ({ ...c, counters: (c.counters ?? 0) + n }));
        say(g, caster, `${onField.card.name} gets ${n >= 0 ? "+" : ""}${n} counter${Math.abs(n) === 1 ? "" : "s"}.`);
        break;
      }
      case "pump": {
        if (!onField || !isCreature(book, onField.card)) break;
        const p = Math.max(-20, Math.min(20, e.power ?? 0));
        const t = Math.max(-20, Math.min(20, e.toughness ?? 0));
        update(g, onField.card.iid, (c) => ({ ...c, pump: { power: (c.pump?.power ?? 0) + p, toughness: (c.pump?.toughness ?? 0) + t } }));
        say(g, caster, `${onField.card.name} gets ${p >= 0 ? "+" : ""}${p}/${t >= 0 ? "+" : ""}${t} until end of turn.`);
        break;
      }
      case "search": {
        const s = caster;
        const want = (e.name ?? "").trim().toLowerCase();
        const found = g.sides[s].library.find((c) => c.name.toLowerCase() === want || c.name.toLowerCase().split(" // ")[0] === want);
        if (!found) {
          say(g, caster, `${source} finds nothing called ${e.name ?? "that"}.`);
          break;
        }
        moveTo(g, found.iid, e.to === "hand" ? "hand" : "battlefield", { tapped: !!e.tapped });
        g.sides[s] = { ...g.sides[s], library: shuffled(g.sides[s].library) };
        say(g, caster, `${source} finds ${found.name}${e.to === "hand" ? " (to hand)" : ""}.`);
        break;
      }
      case "mana": {
        // "{R}{R}{R}" (or "RRR"): floating until the end of the phase.
        const units = [...(e.text ?? "").toUpperCase().matchAll(/[WUBRGC]/g)].map((m) => m[0]).slice(0, 20);
        if (!units.length) break;
        if (!g.pool) g.pool = { you: [], opp: [] };
        g.pool[caster] = [...g.pool[caster], ...units];
        say(g, caster, `${source} adds ${units.map((u) => `{${u}}`).join("")}.`);
        break;
      }
      case "note": {
        if (e.text) say(g, caster, `Resolve: ${e.text.slice(0, 200)}`);
        break;
      }
    }
  }
}

// ── Combat ─────────────────────────────────────────────────────────────

/** Can this creature attack now? */
export function canAttack(g: PracticeGame, seat: Seat, card: PlayCard, book: CardBook): boolean {
  return (
    g.sides[seat].battlefield.some((c) => c.iid === card.iid) &&
    isCreature(book, card) &&
    !card.tapped &&
    !isSick(book, card, g.turn) &&
    !has(book, card, "Defender")
  );
}

export function canBlock(book: CardBook, blocker: PlayCard, attacker: PlayCard): boolean {
  if (blocker.tapped || !isCreature(book, blocker)) return false;
  if (has(book, attacker, "unblockable")) return false;
  if (has(book, attacker, "Flying") && !has(book, blocker, "Flying") && !has(book, blocker, "Reach")) return false;
  return true;
}

export function declareAttackers(g0: PracticeGame, seat: Seat, iids: number[], book: CardBook): PracticeGame {
  if (g0.winner || g0.active !== seat) return g0;
  const g = structuredClone(g0);
  // Mana empties between phases.
  if (g.pool) g.pool[seat] = [];
  const attackers: number[] = [];
  for (const iid of [...new Set(iids)]) {
    const card = g.sides[seat].battlefield.find((c) => c.iid === iid);
    if (!card || !canAttack(g, seat, card, book)) continue;
    attackers.push(iid);
    if (!has(book, card, "Vigilance")) update(g, iid, (c) => ({ ...c, tapped: true }));
  }
  if (!attackers.length) return g0;
  const names = attackers.map((i) => findCard(g, i)!.card.name);
  say(g, seat, `${who(seat)} attack${seat === "you" ? "" : "s"} with ${names.join(", ")}.`);
  const combat: Combat = { attacker: seat, attackers, blocks: {}, stage: "attack" };
  g.combat = combat;
  return g;
}

/** Set blocks (attacker → blockers). Illegal ones are dropped: a blocker
    that can't block that attacker, one blocking twice, or a menace attacker
    with a single blocker. */
export function setBlocks(g0: PracticeGame, blocks: Record<number, number[]>, book: CardBook): PracticeGame {
  if (!g0.combat || g0.combat.stage !== "attack") return g0;
  const g = structuredClone(g0);
  const combat = g.combat!;
  const defender = other(combat.attacker);
  const used = new Set<number>();
  const clean: Record<number, number[]> = {};
  for (const a of combat.attackers) {
    const attacker = g.sides[combat.attacker].battlefield.find((c) => c.iid === a);
    if (!attacker) continue;
    const list = (blocks[a] ?? []).filter((b) => {
      const blocker = g.sides[defender].battlefield.find((c) => c.iid === b);
      if (!blocker || used.has(b) || !canBlock(book, blocker, attacker)) return false;
      used.add(b);
      return true;
    });
    if (list.length === 1 && has(book, attacker, "Menace")) {
      used.delete(list[0]!);
      continue;
    }
    if (list.length) clean[a] = list;
  }
  combat.blocks = clean;
  combat.stage = "blocked";
  for (const [a, bs] of Object.entries(clean)) {
    const an = findCard(g, Number(a))!.card.name;
    say(g, defender, `${bs.map((b) => findCard(g, b)!.card.name).join(" and ")} block${bs.length === 1 ? "s" : ""} ${an}.`);
  }
  if (!Object.keys(clean).length) say(g, defender, `No blocks.`);
  return g;
}

/** Combat damage: a first-strike step, then the regular one. */
export function resolveCombat(g0: PracticeGame, book: CardBook): PracticeGame {
  if (!g0.combat || g0.winner) return g0;
  let g = g0.combat.stage === "attack" ? setBlocks(g0, {}, book) : g0;
  g = structuredClone(g);
  const combat = g.combat!;
  const atk = combat.attacker;
  const def = other(atk);
  const alive = (iid: number) => g.sides.you.battlefield.some((c) => c.iid === iid) || g.sides.opp.battlefield.some((c) => c.iid === iid);
  const card = (iid: number) => findCard(g, iid)!.card;
  const strikesIn = (c: PlayCard, first: boolean) => {
    const fs = has(book, c, "First strike");
    const ds = has(book, c, "Double strike");
    return first ? fs || ds : !fs || ds;
  };
  for (const first of [true, false]) {
    const marks = new Map<number, number>();
    const deathtouched = new Set<number>();
    let toPlayer = 0;
    let cmdToPlayer = 0;
    const gain: Record<Seat, number> = { you: 0, opp: 0 };
    const mark = (iid: number, n: number, from: PlayCard) => {
      if (n <= 0) return;
      marks.set(iid, (marks.get(iid) ?? 0) + n);
      if (has(book, from, "Deathtouch")) deathtouched.add(iid);
    };
    for (const a of combat.attackers) {
      if (!alive(a)) continue;
      const attacker = card(a);
      const blockers = (combat.blocks[a] ?? []).filter(alive);
      const wasBlocked = (combat.blocks[a] ?? []).length > 0;
      if (strikesIn(attacker, first)) {
        let left = stats(book, attacker).power;
        const dealt = left;
        if (!wasBlocked) {
          toPlayer += left;
          if (attacker.commander) cmdToPlayer += left;
          left = 0;
        } else {
          blockers.forEach((b, i) => {
            const blocker = card(b);
            const need = has(book, attacker, "Deathtouch") ? 1 : Math.max(0, stats(book, blocker).toughness - (blocker.damage ?? 0) - (marks.get(b) ?? 0));
            const last = i === blockers.length - 1;
            const give = last && !has(book, attacker, "Trample") ? left : Math.min(left, need);
            mark(b, give, attacker);
            left -= give;
          });
          if (left > 0 && (has(book, attacker, "Trample") || !blockers.length)) {
            if (has(book, attacker, "Trample")) {
              toPlayer += left;
              if (attacker.commander) cmdToPlayer += left;
            }
          }
        }
        if (has(book, attacker, "Lifelink") && dealt > 0) gain[atk] += dealt;
      }
      for (const b of blockers) {
        const blocker = card(b);
        if (!strikesIn(blocker, first)) continue;
        const p = stats(book, blocker).power;
        mark(a, p, blocker);
        if (has(book, blocker, "Lifelink") && p > 0) gain[def] += p;
      }
    }
    for (const [iid, n] of marks) update(g, iid, (c) => ({ ...c, damage: (c.damage ?? 0) + n }));
    if (toPlayer) {
      g.sides[def] = { ...g.sides[def], life: g.sides[def].life - toPlayer };
      say(g, atk, `${def === "you" ? "You take" : "The opponent takes"} ${toPlayer} combat damage.`);
    }
    if (cmdToPlayer && g.commanderGame) g.cmdDamage[def] += cmdToPlayer;
    for (const s of ["you", "opp"] as Seat[]) {
      if (gain[s]) {
        g.sides[s] = { ...g.sides[s], life: g.sides[s].life + gain[s] };
        say(g, s, `${s === "you" ? "You gain" : "The opponent gains"} ${gain[s]} life (lifelink).`);
      }
    }
    for (const iid of deathtouched) {
      const c = findCard(g, iid);
      if (c && c.zone === "battlefield" && !has(book, c.card, "Indestructible")) {
        moveTo(g, iid, "graveyard");
        say(g, c.seat, `${c.card.name} dies (deathtouch).`);
      }
    }
    checkState(g, book);
    if (g.winner) break;
  }
  g.combat = null;
  return g;
}
