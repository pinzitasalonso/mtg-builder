// A practice game against the AI: two sides, each the solo playtest's zones
// (lib/playtest), and the bookkeeping that makes it a game — turns, the land
// drop, summoning sickness, mana, damage, combat, commander tax and damage,
// and who has won. Pure: every move returns a new game. See
// docs/practice-vs-ai.md.
//
// Your side is played by hand, as in the solo playtest: nothing you do is
// refused. The AI's moves are checked: a spell it can't pay for, or a target
// that isn't there, is skipped and logged.

import { draw, faceUpType, moveCard, resolvesToGraveyard, scry, type PlayCard, type PlaytestState, type Shuffle, type Zone } from "../playtest";
import { shuffled } from "../probability";
import {
  canPlayAsLand,
  cardTypes,
  castTriggerOf,
  counterOf,
  discardTriggerOf,
  drawsOnLifeLoss,
  edictOf,
  entersTapped,
  faceText,
  fetchOf,
  has,
  hasAltCost,
  hitTriggersOf,
  indestructibleOnYourTurn,
  infoOf,
  isBlue,
  isCreature,
  isLand,
  isNinja,
  isSick,
  lifeForMana,
  manaOutput,
  ninjutsuOf,
  removalOf,
  shockLife,
  stats,
  type Edict,
  type SearchAbility,
} from "./cards";
import {
  affinityHits,
  affinityOf,
  auraBonusOf,
  auraTutorOf,
  braidsOf,
  castFromGraveyardOnHitOf,
  copyOnEnterOf,
  drawsForBiggest,
  globalKeywordsOf,
  grantedAffinityOf,
  grantedManaOf,
  greatestPowerManaOf,
  isType,
  landfallTokenOf,
  lootOnEnterOf,
  lordsOf,
  powerManaOf,
  punishesIdleOf,
  reducerHits,
  reducersOf,
  tapTribeOf,
  tribeAttackOf,
  untapLandsOf,
  upkeepTokenOf,
  winotaOf,
} from "./abilities";
import { manaSources, parseCost, payCost, poolSources, totalOf, type Cost, type Payment, type Source } from "./mana";
import { other, type CardBook, type Choice, type Combat, type Effect, type PlanAction, type PracticeGame, type Seat } from "./types";

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
    // "Kefka, Court Mage" finds "Kefka, Court Mage // Kefka, Ruler of Ruin".
    const at = all.findIndex((c) => c.name.trim().toLowerCase() === name || c.name.trim().toLowerCase().split(" // ")[0] === name.split(" // ")[0]);
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
  // The Auras on a permanent that leaves go to the graveyard.
  if (at.zone === "battlefield" && to !== "battlefield") {
    for (const s of ["you", "opp"] as Seat[]) for (const a of g.sides[s].battlefield.filter((c) => c.attachedTo === iid)) moveTo(g, a.iid, "graveyard");
  }
  const side = g.sides[at.seat];
  // A token, or a token that's a copy (Inalla), ceases to exist off the battlefield.
  if ((at.card.token || at.card.copy) && to !== "battlefield") {
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
  // A lord that dies takes its bonus with it, which can kill more: again
  // until nothing dies.
  for (let pass = 0; pass < 5; pass++) {
    refreshStatics(g, book);
    let died = false;
    for (const seat of ["you", "opp"] as Seat[]) {
      for (const c of [...g.sides[seat].battlefield]) {
        if (!isCreature(book, c) || !findCard(g, c.iid)) continue;
        const { toughness } = stats(book, c);
        const dead = toughness <= 0 || ((c.damage ?? 0) >= toughness && !indestructible(g, seat, c, book));
        if (dead) {
          moveTo(g, c.iid, "graveyard");
          say(g, seat, `${c.name} dies.`);
          died = true;
        }
      }
    }
    if (!died) break;
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
/** "draw" / "draws", and so on: you, or the opponent. */
const verb = (seat: Seat, v: string) => (seat === "you" ? v : `${v}s`);
/** The name of the face that's up. */
const faceName = (c: PlayCard) => (c.flipped ? c.name.split(" // ")[1] : c.name.split(" // ")[0])?.trim() || c.name;

/** Indestructible now: by keyword, or "during your turn" on its
    controller's turn (Kefka, Dancing Mad). */
export const indestructible = (g: PracticeGame, seat: Seat, card: PlayCard, book: CardBook) =>
  has(book, card, "Indestructible") || (g.active === seat && indestructibleOnYourTurn(book, card));

/** What permanents give each other, worked out again from the board:
    lords ("Other Elves you control get +1/+1"), the Auras on a creature,
    and "All creatures have haste" (Kratos). Kept on each card as `boost`. */
function refreshStatics(g: PracticeGame, book: CardBook) {
  const field = (["you", "opp"] as Seat[]).flatMap((seat) => g.sides[seat].battlefield.map((c) => ({ c, seat })));
  const lords = field.flatMap(({ c, seat }) => lordsOf(book, c).map((l) => ({ ...l, seat, from: c.iid })));
  const everyone = [...new Set(field.flatMap(({ c }) => globalKeywordsOf(book, c)))];
  const auras = field.flatMap(({ c }) => (c.attachedTo !== undefined ? [{ on: c.attachedTo, bonus: auraBonusOf(book, c) }] : []));
  if (!lords.length && !everyone.length && !auras.length && !field.some(({ c }) => c.boost)) return;
  for (const seat of ["you", "opp"] as Seat[]) {
    const side = g.sides[seat];
    g.sides[seat] = {
      ...side,
      battlefield: side.battlefield.map((card) => {
        const { boost: _old, ...bare } = card;
        if (!isCreature(book, bare)) return bare;
        let power = 0;
        let toughness = 0;
        const keywords = [...everyone];
        for (const l of lords) {
          if (l.seat !== seat || (l.other && l.from === card.iid) || (l.type !== null && !isType(book, bare, l.type))) continue;
          power += l.power;
          toughness += l.toughness;
          keywords.push(...l.keywords);
        }
        for (const a of auras) {
          if (a.on !== card.iid || !a.bonus) continue;
          power += a.bonus.power;
          toughness += a.bonus.toughness;
          keywords.push(...a.bonus.keywords);
        }
        return power || toughness || keywords.length ? { ...bare, boost: { power, toughness, keywords: [...new Set(keywords)] } } : bare;
      }),
    };
  }
}

const frontLine = (book: CardBook, c: PlayCard) => (c.token ? (c.typeLine ?? "") : (infoOf(book, c)?.typeLine ?? c.typeLine ?? "").split(" // ")[0]!);

/** What a spell costs a seat now: its mana cost, commander tax from the
    command zone, less affinity ("for creatures": Witherbloom, and the
    instants and sorceries it gives it to) and "<kind> spells you cast cost
    {1} less" (The Ur-Dragon, from the command zone too). */
export function spellCost(g: PracticeGame, seat: Seat, card: PlayCard, book: CardBook, zone: Zone): Cost {
  const info = infoOf(book, card);
  const cost = parseCost(info?.manaCost ?? null);
  if (zone === "command") cost.generic += 2 * g.tax[seat];
  const side = g.sides[seat];
  const spell = { typeLine: info?.typeLine ?? card.typeLine ?? "" };
  let off = 0;
  const granted = side.battlefield.map((c) => grantedAffinityOf(book, c)).find((a) => a && affinityHits(a.words, spell, book, card));
  const affinity = affinityOf(book, card) ?? granted?.kind ?? null;
  if (affinity) off += side.battlefield.filter((c) => (affinity === "creature" ? isCreature(book, c) : /\bArtifact\b/.test(frontLine(book, c)))).length;
  for (const [zoneOf, cards] of [
    ["battlefield", side.battlefield],
    ["command", side.command],
  ] as const) {
    for (const c of cards) {
      if (c.iid === card.iid) continue;
      for (const r of reducersOf(book, c)) {
        if (zoneOf === "command" && !r.eminence) continue;
        if (reducerHits(r, spell, book, card)) off += r.amount;
      }
    }
  }
  cost.generic = Math.max(0, cost.generic - off);
  return cost;
}

/** A seat loses life (damage, a payment, a drain). On the other seat's
    turn, its "whenever an opponent loses life during your turn, you draw
    that many cards" permanents draw (Kefka, Ruler of Ruin). */
function loseLife(g: PracticeGame, seat: Seat, n: number, book: CardBook) {
  if (n <= 0) return;
  g.sides[seat] = { ...g.sides[seat], life: g.sides[seat].life - n };
  const turn = g.active;
  if (turn === seat) return;
  for (const c of g.sides[turn].battlefield) {
    if (!drawsOnLifeLoss(book, c)) continue;
    // Not past the library's end: the game ends on the life, not the draw.
    const k = Math.min(n, g.sides[turn].library.length);
    if (!k) continue;
    say(g, turn, `${faceName(c)}: ${turn === "you" ? "you draw" : "the opponent draws"} ${k}.`);
    drawCards(g, turn, k);
  }
}

// ── Mana ───────────────────────────────────────────────────────────────

/** What a seat can pay with now: its floating mana, then its untapped
    sources. */
export function availableMana(g: PracticeGame, seat: Seat, book: CardBook, exclude: number[] = []): Source[] {
  const side = g.sides[seat];
  // Vivi and Selvala make mana their own way (below), not by tapping for one.
  const special = (c: PlayCard) => !!powerManaOf(book, c) || !!greatestPowerManaOf(book, c);
  const all = manaSources(side, book, g.turn, exclude).filter((s) => !special(side.battlefield.find((c) => c.iid === s.iid) ?? ({} as PlayCard)));
  const ready = (c: PlayCard) => !c.tapped && !exclude.includes(c.iid) && !(isCreature(book, c) && isSick(book, c, g.turn));
  // 'Other Elves you control have "{T}: Add {G} or {U}."' (Thranduil the Strategist)
  for (const granter of side.battlefield) {
    const gm = grantedManaOf(book, granter);
    if (!gm) continue;
    for (const c of side.battlefield) {
      if (c.iid === granter.iid || !isCreature(book, c) || !isType(book, c, gm.type) || !ready(c) || all.some((s) => s.iid === c.iid)) continue;
      all.push({ iid: c.iid, name: c.name, colors: gm.colors, amount: 1 });
    }
  }
  for (const c of side.battlefield) {
    // Vivi: {0}, X of {U} and/or {R}, X its power; once a turn, on your turn.
    const pm = powerManaOf(book, c);
    if (pm && !exclude.includes(c.iid) && !g.once?.includes(c.iid) && (!pm.yourTurn || g.active === seat)) {
      const x = stats(book, c).power;
      if (x > 0) all.push({ iid: c.iid, name: c.name, colors: pm.colors, amount: x, once: true, float: true });
    }
    // Selvala: {G}, {T}: X of any colours, X the greatest power among your
    // creatures. One of your {G} sources pays the {G}.
    const sm = greatestPowerManaOf(book, c);
    if (sm && ready(c)) {
      const x = Math.max(0, ...side.battlefield.filter((y) => isCreature(book, y)).map((y) => stats(book, y).power));
      const payer = all
        .filter((s) => s.iid !== c.iid && s.amount === 1 && !s.sacrifice && !s.once && !s.float && s.colors.includes(sm.input))
        .sort((a, b) => a.colors.length - b.colors.length)[0];
      if (payer && x >= 2) {
        all.splice(all.indexOf(payer), 1);
        all.push({ iid: c.iid, name: c.name, colors: ["W", "U", "B", "R", "G"], amount: x, also: [payer.iid], float: true });
      }
    }
  }
  return [...poolSources(g.pool?.[seat]), ...all];
}

/** Pay: tap the sources (sacrificing the one-shot ones) and spend the
    floating mana that was used. */
function spend(g: PracticeGame, seat: Seat, paid: Payment, sources: Source[]) {
  const floating = new Set(paid.tap.filter((t) => t < 0).map((t) => -t - 1));
  if (floating.size && g.pool) g.pool[seat] = g.pool[seat].filter((_, i) => !floating.has(i));
  for (const t of paid.tap) {
    if (t < 0) continue;
    const src = sources.find((x) => x.iid === t);
    if (src?.sacrifice) {
      const name = findCard(g, t)?.card.name;
      moveTo(g, t, "graveyard");
      say(g, seat, `${who(seat)} sacrifice${seat === "you" ? "" : "s"} ${name} for mana.`);
    } else if (src?.once) g.once = [...(g.once ?? []), t];
    else update(g, t, (c) => ({ ...c, tapped: true }));
    for (const a of src?.also ?? []) update(g, a, (c) => ({ ...c, tapped: true }));
    // Vivi, Selvala: all of it at once; what this payment leaves floats.
    if (src?.float) {
      const left = src.amount - (paid.used[t] ?? 0);
      if (!g.pool) g.pool = { you: [], opp: [] };
      if (left > 0) g.pool[seat] = [...g.pool[seat], ...Array.from({ length: left }, () => src.colors.join(""))];
      say(g, seat, `${faceName(findCard(g, t)?.card ?? ({ name: src.name } as PlayCard))} adds ${src.amount} mana${left > 0 ? ` (${left} left floating)` : ""}.`);
    }
  }
}

/** The colours a seat may pay for with 2 life a pip (K'rrik: ["B"]). */
export function lifeFor(g: PracticeGame, seat: Seat, book: CardBook): string[] {
  return [...new Set(g.sides[seat].battlefield.flatMap((c) => lifeForMana(book, c)))];
}

/** Life the AI keeps when it pays life for mana (K'rrik, phyrexian mana):
    enough to live through the other side's creatures. */
function lifeFloor(g: PracticeGame, seat: Seat, book: CardBook): number {
  const threat = g.sides[other(seat)].battlefield.filter((c) => isCreature(book, c)).reduce((n, c) => n + Math.max(0, stats(book, c).power), 0);
  return Math.max(5, threat + 1);
}

/** What the AI pays for a cost now, with life where a card lets it, and
    never below its floor. */
function aiPay(g: PracticeGame, seat: Seat, cost: Cost, sources: Source[], book: CardBook, opts: { x?: number; life?: number } = {}) {
  const paid = payCost(cost, sources, { ...opts, lifeFor: lifeFor(g, seat, book) });
  if (!paid) return null;
  if (paid.life > (opts.life ?? 0) && g.sides[seat].life - paid.life < lifeFloor(g, seat, book)) return null;
  return paid;
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
  landEntered(g, seat, book);
  if (untappedShock) {
    say(g, seat, `${who(seat)} pay${seat === "you" ? "" : "s"} ${shock} life for ${land.name} to enter untapped.`);
    loseLife(g, seat, shock, book);
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
  if (fetch.life) loseLife(g, seat, fetch.life, book);
  moveTo(g, land.iid, "graveyard");
  say(g, seat, `${who(seat)} crack${seat === "you" ? "" : "s"} ${land.name} for ${pick.name}.`);
  const pickInfo = infoOf(book, pick);
  const pickShock = shockLife(pickInfo);
  const pickUntapped = !fetch.tapped && (pickShock ? g.sides[seat].life > 6 : !entersTapped(pickInfo));
  moveTo(g, pick.iid, "battlefield", { tapped: !pickUntapped });
  landEntered(g, seat, book);
  if (pickShock && pickUntapped) {
    say(g, seat, `${who(seat)} pay${seat === "you" ? "" : "s"} ${pickShock} life for ${pick.name} to enter untapped.`);
    loseLife(g, seat, pickShock, book);
  }
  g.sides[seat] = { ...g.sides[seat], library: shuffled(g.sides[seat].library) };
}

// ── Turns ──────────────────────────────────────────────────────────────

/** The active player's turn begins: untap, and draw (not the first player
    on turn one). */
export function startTurn(g0: PracticeGame, book: CardBook = {}): PracticeGame {
  const g = structuredClone(g0);
  const seat = g.active;
  const side = g.sides[seat];
  g.sides[seat] = { ...side, battlefield: side.battlefield.map((c) => ({ ...c, tapped: false })) };
  g.landPlayed = false;
  g.attacked = [];
  g.once = [];
  g.mayCast = [];
  say(g, seat, `Turn ${g.turn} — ${seat === "you" ? "your turn" : "the opponent's turn"}.`);
  // "At the beginning of each upkeep, create a 1/1 … Pest" (Beledros
  // Witherbloom): every upkeep, for whoever controls it.
  for (const s of ["you", "opp"] as Seat[]) {
    for (const c of [...g.sides[s].battlefield]) {
      const t = upkeepTokenOf(book, c);
      if (!t) continue;
      addTokens(g, s, { name: t.name, power: t.power, toughness: t.toughness, keywords: [], kind: "creature" }, t.count);
      say(g, s, `${faceName(c)}: ${s === "you" ? "you create" : "the opponent creates"} ${t.count === 1 ? "a" : t.count} ${t.name} token${t.count === 1 ? "" : "s"} (${t.power}/${t.toughness}).`);
    }
  }
  if (g.turn > 1) drawCards(g, seat, 1);
  checkState(g, book);
  return g;
}

/** End the turn: damage and "until end of turn" wear off, and the other
    player's turn starts. */
export function endTurn(g0: PracticeGame, book: CardBook = {}): PracticeGame {
  if (g0.winner) return g0;
  const g = structuredClone(g0);
  g.combat = null;
  // Damage and "until end of turn" wear off (the cleanup, here before the
  // end step's checks, which only touch players and copies).
  for (const seat of ["you", "opp"] as Seat[]) {
    const side = g.sides[seat];
    g.sides[seat] = { ...side, battlefield: side.battlefield.map(({ damage: _d, pump: _p, eot: _e, ...c }) => c) };
  }
  endStep(g, book);
  if (g.winner) return g;
  emptyPool(g);
  g.active = other(g.active);
  g.turn += 1;
  return startTurn(g, book);
}

/** The end step's automatic triggers: Kratos punishes the creatures that
    didn't attack, and Inalla's copies are exiled. (Braids asks, so the
    table runs it first: playerEndStep, aiEndStep.) */
function endStep(g: PracticeGame, book: CardBook) {
  const seat = g.active;
  for (const s of ["you", "opp"] as Seat[]) {
    for (const c of g.sides[s].battlefield) {
      if (!punishesIdleOf(book, c)) continue;
      const idle = g.sides[seat].battlefield.filter((x) => isCreature(book, x) && !(g.attacked ?? []).includes(x.iid)).length;
      if (!idle) continue;
      say(g, s, `${faceName(c)} deals ${idle} damage to ${seat === "you" ? "you" : "the opponent"}: ${idle === 1 ? "a creature" : `${idle} creatures`} that didn't attack.`);
      loseLife(g, seat, idle, book);
    }
  }
  for (const s of ["you", "opp"] as Seat[]) {
    for (const c of g.sides[s].battlefield.filter((x) => x.exileAtEnd)) {
      moveTo(g, c.iid, "exile");
      say(g, s, `The copy of ${c.name} is exiled.`);
    }
  }
  checkState(g, book);
}

// ── Your side (by hand) ────────────────────────────────────────────────

/** A card from your hand or command zone, played as the solo table would:
    a permanent onto the battlefield, an instant or sorcery to the graveyard.
    Not checked; you're the rules. */
/** Where you may play a card from: your hand, the command zone, or your
    graveyard when a card let you this turn (Silas Renn). */
const playableZone = (g: PracticeGame, at: { seat: Seat; zone: Zone; card: PlayCard }) =>
  at.seat === "you" && (at.zone === "hand" || at.zone === "command" || (at.zone === "graveyard" && !!g.mayCast?.includes(at.card.iid)));

export function playerPlay(g0: PracticeGame, iid: number, book: CardBook = {}): PracticeGame {
  const at = findCard(g0, iid);
  if (!at || !playableZone(g0, at)) return g0;
  const g = structuredClone(g0);
  const card = at.card;
  if (at.zone === "command") g.tax.you += 1;
  if (at.zone === "graveyard") g.mayCast = g.mayCast!.filter((i) => i !== iid);
  // The face that's up is what's played (turn a modal card over for its land).
  if (isLand(card) && at.zone === "hand") g.landPlayed = true;
  const triggers = isLand(card) ? null : () => castTriggers(g, "you", card, book);
  if (resolvesToGraveyard(faceUpType(card))) {
    say(g, "you", `You cast ${card.name}.`, card);
    triggers?.();
    moveTo(g, iid, "graveyard");
  } else {
    say(g, "you", `You ${isLand(card) ? "play" : "cast"} ${card.name}.`, isLand(card) ? undefined : card);
    triggers?.();
    moveTo(g, iid, "battlefield");
    if (isLand(card)) landEntered(g, "you", book);
  }
  checkState(g, book);
  return g;
}

/** Your permanent has entered (it resolved, not countered): what the table
    carries out as it enters (Kefka's discard, Selvala's draw, Inalla's
    copy, the Elvenking's loot), and an Aura asks where it goes (then
    Light-Paws may search: the table opens that). */
export function playerEnters(g0: PracticeGame, iid: number, book: CardBook): PracticeGame {
  const at = findCard(g0, iid);
  if (!at || at.seat !== "you" || at.zone !== "battlefield") return g0;
  const g = structuredClone(g0);
  const copied = entered(g, "you", at.card, book, { cast: true });
  if (copied && /\benters\b/i.test(faceText(infoOf(book, at.card), at.card))) say(g, "you", `Resolve: the copy's enters ability (${at.card.name}).`);
  if (discardTriggerOf(book, at.card)?.enters && !g.choice) discardTrigger(g, "you", at.card, book);
  if (isType(book, at.card, "aura") && !g.choice && [...g.sides.you.battlefield, ...g.sides.opp.battlefield].some((c) => isCreature(book, c))) {
    const lightPaws = g.sides.you.battlefield.find((c) => auraTutorOf(book, c));
    g.choice = { kind: "attach", source: at.card.name, by: "you", aura: iid, tutor: lightPaws?.iid };
  }
  checkState(g, book);
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
  if (delta < 0) loseLife(g, seat, -delta, book);
  else g.sides[seat] = { ...g.sides[seat], life: g.sides[seat].life + delta };
  checkState(g, book);
  return g;
}

/** You give the game up: the opponent wins, and the game is over (it counts
    as a loss in the deck's record). */
export function concede(g0: PracticeGame): PracticeGame {
  if (g0.winner) return g0;
  const g = structuredClone(g0);
  g.winner = "opp";
  g.choice = undefined;
  say(g, null, "You concede. The opponent wins.");
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
  return aiPay(g, seat, spellCost(g, seat, card, book, zone), availableMana(g, seat, book), book) !== null;
}

/** A cast in stages, so the player can answer it: "pay" pays and announces
    it (the card waits where it is), then "resolve" carries it out or
    "counter" sends it to the graveyard (a commander to the command zone).
    Without a stage, a cast does both at once. */
export interface CastStage {
  stage?: "pay" | "resolve" | "counter";
  /** "counter": what countered it, for the log. */
  by?: string;
}

export function applyAction(g0: PracticeGame, seat: Seat, action: PlanAction, book: CardBook, opts: CastStage = {}): Step {
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
    // From its graveyard only when a card let it, this turn (Silas Renn).
    const fromGrave = at.zone === "graveyard" && !!g.mayCast?.includes(card.iid);
    if (at.zone !== "hand" && at.zone !== "command" && !fromGrave) return fail(`(The opponent tried to cast ${card.name} from its ${at.zone}.)`);
    if (isLand(card)) return fail(`(The opponent tried to cast the land ${card.name}.)`);
    if (opts.stage === "counter") {
      moveTo(g, card.iid, card.commander ? "command" : "graveyard");
      say(g, other(seat), `${opts.by ?? "A counterspell"} counters ${card.name}.`);
      return { game: g, ok: true };
    }
    if (opts.stage === "resolve") {
      resolveCast(g, seat, card, action, book);
      return { game: g, ok: true };
    }
    const cost = spellCost(g, seat, card, book, at.zone);
    const sources = availableMana(g, seat, book);
    const paid = aiPay(g, seat, cost, sources, book, { x: action.x ?? 0 });
    if (!paid) return fail(`The opponent can't pay for ${card.name} yet.`);
    spend(g, seat, paid, sources);
    if (at.zone === "command") g.tax[seat] += 1;
    if (fromGrave) g.mayCast = g.mayCast!.filter((i) => i !== card.iid);
    const x = cost.xCount ? ` (X = ${action.x ?? 0})` : "";
    const target = action.effects.map((e) => parseCardId(e.target)).find((t) => t !== null);
    const on = target !== undefined && target !== null ? findCard(g, target)?.card.name : undefined;
    if (paid.life) say(g, seat, `${who(seat)} ${verb(seat, "pay")} ${paid.life} life for ${card.name}.`);
    loseLife(g, seat, paid.life, book);
    say(g, seat, `${who(seat)} casts ${card.name}${x}${on ? ` on ${on}` : ""}.`, card);
    castTriggers(g, seat, card, book);
    checkState(g, book);
    if (opts.stage === "pay" || g.winner) return { game: g, ok: true };
    resolveCast(g, seat, card, action, book);
    return { game: g, ok: true };
  }

  // activate
  // A fetch land already cracked itself when it was played.
  if (at.zone === "graveyard" && fetchOf(info)) return { game: g0, ok: true };
  if (at.zone !== "battlefield") return fail(`(The opponent tried to use ${card.name}, which isn't in play.)`);
  // Inalla's "tap five Wizards", Beledros's "pay 10 life: untap your
  // lands": the table carries them out, whatever effects the plan gave.
  const tribe = tapTribeOf(book, card);
  if (tribe && !action.tap_card && !action.mana) {
    if (!tapTribe(g, seat, card, tribe, book)) return fail(`(${faceName(card)} needs ${tribe.count} untapped ${tribe.type}s.)`);
    return { game: g, ok: true };
  }
  const untap = untapLandsOf(book, card);
  if (untap && !action.tap_card && !action.mana && (action.life ?? untap.life) >= untap.life) {
    if (!untapLands(g, seat, card, untap.life, book)) return fail(`(${faceName(card)}'s ability is once a turn.)`);
    return { game: g, ok: true };
  }
  // Kefka's {8}: the table carries it out (the player picks what to
  // sacrifice; Kefka transforms), whatever effects the plan gave it.
  const edict = edictOf(book, card);
  if (edict && !action.tap_card && !action.sacrifice_card && (!action.mana || totalOf(parseCost(action.mana)) === totalOf(parseCost(edict.mana)))) {
    if (g.active !== seat || g.combat) return fail(`(${faceName(card)}'s ability is for its own main phase.)`);
    const sources = availableMana(g, seat, book);
    const paid = aiPay(g, seat, parseCost(edict.mana), sources, book);
    if (!paid) return fail(`The opponent can't pay for ${faceName(card)}'s ability.`);
    spend(g, seat, paid, sources);
    loseLife(g, seat, paid.life, book);
    say(g, seat, `${who(seat)} ${verb(seat, "activate")} ${faceName(card)}.`, card);
    edictResolve(g, seat, card, edict, book);
    checkState(g, book);
    return { game: g, ok: true };
  }
  if (action.tap_card) {
    if (card.tapped) return fail(`(${card.name} is already tapped.)`);
    if (isCreature(book, card) && isSick(book, card, g.turn)) return fail(`(${card.name} can't tap the turn it arrived.)`);
  }
  const cost = parseCost(action.mana);
  const sources = availableMana(g, seat, book, action.tap_card ? [card.iid] : []);
  const paid = aiPay(g, seat, cost, sources, book, { life: action.life ?? 0 });
  if (!paid) return fail(`The opponent can't pay for ${card.name}'s ability.`);
  spend(g, seat, paid, sources);
  if (action.tap_card) update(g, card.iid, (c) => ({ ...c, tapped: true }));
  loseLife(g, seat, paid.life, book);
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
    const paid = aiPay(g0, "opp", spellCost(g0, "opp", c, book, "hand"), sources, book, { x: k.xIsValue ? spell.manaValue : 0 });
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
      spend(g, "opp", paid, sources);
      loseLife(g, "opp", paid.life, book);
    }
    if (pitched) {
      moveTo(g, pitched.iid, "exile");
      loseLife(g, "opp", k.freeLife, book);
    }
    const how = pitched ? ` (exiling ${pitched.name})` : free === "commander" ? " (free: its commander is out)" : "";
    say(g, "opp", `The opponent counters ${at.card.name} with ${c.name}${how}.`, c);
    castTriggers(g, "opp", c, book);
    moveTo(g, c.iid, "graveyard");
    moveTo(g, iid, at.card.commander ? "command" : "graveyard");
    if (k.rider) say(g, "opp", `Resolve: ${k.rider}`);
    checkState(g, book);
    return g;
  }
  return g0;
}

// ── Tokens and counters (either side, from the table's menus) ──────────

/** Tokens that are artifacts, not creatures. */
const ARTIFACT_TOKENS = /^(treasure|food|clue|gold|blood|map|powerstone|junk|shard|incubator)$/i;

export interface TokenSpec {
  name: string;
  power: number;
  toughness: number;
  keywords: string[];
  kind: "creature" | "artifact";
  tapped?: boolean;
}

function addTokens(g: PracticeGame, seat: Seat, spec: TokenSpec, count: number) {
  for (let i = 0; i < Math.max(1, Math.min(20, count)); i++) {
    const token: PlayCard = {
      iid: g.nextIid++,
      name: spec.name.slice(0, 40) || "Token",
      imageUri: "",
      typeLine: spec.kind === "artifact" ? `Token Artifact — ${spec.name}` : `Token Creature — ${spec.name}`,
      tapped: !!spec.tapped,
      commander: false,
      enteredTurn: g.turn,
      token: {
        power: Math.max(0, Math.min(99, Math.floor(spec.power))),
        toughness: Math.max(spec.kind === "artifact" ? 0 : 1, Math.min(99, Math.floor(spec.toughness))),
        keywords: spec.keywords.slice(0, 6).map((k) => k.slice(0, 30)),
        kind: spec.kind,
      },
    };
    g.sides[seat] = { ...g.sides[seat], battlefield: [...g.sides[seat].battlefield, token] };
  }
}

/** Tokens a player makes by hand (a Treasure, a 1/1 Soldier…). */
export function createTokens(g0: PracticeGame, seat: Seat, spec: TokenSpec, count = 1): PracticeGame {
  const g = structuredClone(g0);
  const n = Math.max(1, Math.min(20, Math.floor(count)));
  addTokens(g, seat, spec, n);
  const stats = spec.kind === "artifact" ? "" : ` (${spec.power}/${spec.toughness})`;
  say(g, seat, `${seat === "you" ? "You create" : "The opponent creates"} ${n === 1 ? "a" : n} ${spec.name} token${n === 1 ? "" : "s"}${stats}.`);
  return g;
}

/** Put counters on a creature: +1/+1 (n > 0) or -1/-1 (n < 0). */
export function addCounters(g0: PracticeGame, iid: number, n: number, book: CardBook): PracticeGame {
  const at = findCard(g0, iid);
  if (!at || at.zone !== "battlefield" || !n) return g0;
  const g = structuredClone(g0);
  update(g, iid, (c) => ({ ...c, counters: (c.counters ?? 0) + n }));
  say(g, at.seat, `${at.card.name} gets ${Math.abs(n) === 1 ? "a" : Math.abs(n)} ${n > 0 ? "+1/+1" : "-1/-1"} counter${Math.abs(n) === 1 ? "" : "s"}.`);
  checkState(g, book);
  return g;
}

// ── Triggers and choices the table carries out (K'rrik, Kefka, Vivi…) ──

/** A seat casts a spell: its permanents' "whenever you cast a … spell"
    triggers (K'rrik's counter, Vivi's counter and damage, prowess). */
function castTriggers(g: PracticeGame, seat: Seat, spell: PlayCard, book: CardBook) {
  const info = infoOf(book, spell);
  const seen = { typeLine: info?.typeLine ?? spell.typeLine ?? "", manaCost: info?.manaCost ?? "" };
  const foe = other(seat);
  for (const c of [...g.sides[seat].battlefield]) {
    if (c.iid === spell.iid) continue;
    const t = castTriggerOf(book, c);
    if (!t || !t.hits(seen)) continue;
    const name = faceName(c);
    if (t.counters && isCreature(book, c)) {
      update(g, c.iid, (x) => ({ ...x, counters: (x.counters ?? 0) + t.counters }));
      say(g, seat, `${name} gets ${t.counters === 1 ? "a" : t.counters} +1/+1 counter${t.counters === 1 ? "" : "s"}.`);
    }
    if (t.pump && isCreature(book, c)) {
      update(g, c.iid, (x) => ({ ...x, pump: { power: (x.pump?.power ?? 0) + t.pump, toughness: (x.pump?.toughness ?? 0) + t.pump } }));
      say(g, seat, `${name} gets +${t.pump}/+${t.pump} until end of turn.`);
    }
    if (t.damage) {
      say(g, seat, `${name} deals ${t.damage} damage to ${foe === "you" ? "you" : "the opponent"}.`);
      loseLife(g, foe, t.damage, book);
    }
    if (t.drain) {
      say(g, seat, `${foe === "you" ? "You lose" : "The opponent loses"} ${t.drain} life (${name}).`);
      loseLife(g, foe, t.drain, book);
    }
    if (t.gain) {
      g.sides[seat] = { ...g.sides[seat], life: g.sides[seat].life + t.gain };
      say(g, seat, `${who(seat)} ${verb(seat, "gain")} ${t.gain} life (${name}).`);
    }
    if (t.draw) {
      say(g, seat, `${who(seat)} ${verb(seat, "draw")} ${t.draw} (${name}).`);
      drawCards(g, seat, t.draw);
    }
    if (t.token) {
      addTokens(g, seat, { ...t.token, kind: "creature" }, 1);
      say(g, seat, `${name} makes a ${t.token.name} token (${t.token.power}/${t.token.toughness}).`);
    }
  }
}

/** The card the AI would rather lose from its hand: a land it has plenty
    of, else its most expensive card. */
function aiDiscardPick(g: PracticeGame, seat: Seat, book: CardBook): PlayCard | null {
  const side = g.sides[seat];
  if (!side.hand.length) return null;
  const landsOut = side.battlefield.filter(isLand).length;
  const lands = side.hand.filter(canPlayAsLand);
  if (lands.length >= 2 || (lands.length && landsOut >= 6)) return lands.find(isLand) ?? lands[0]!;
  const spells = side.hand.filter((c) => !isLand(c)).sort((a, b) => (infoOf(book, b)?.manaValue ?? 0) - (infoOf(book, a)?.manaValue ?? 0));
  return spells[0] ?? side.hand[0]!;
}

/** "Each player discards a card. Then you draw a card for each card type
    among cards discarded this way" (Kefka, Court Mage, as it enters or
    attacks). The AI discards at once; you choose yours (the game's choice),
    unless your hand is empty. */
function discardTrigger(g: PracticeGame, by: Seat, source: PlayCard, book: CardBook) {
  const name = faceName(source);
  say(g, by, `${name}: each player discards a card.`);
  const discarded: string[] = [];
  const ai = aiDiscardPick(g, "opp", book);
  if (ai) {
    moveTo(g, ai.iid, "graveyard");
    say(g, "opp", `The opponent discards ${ai.name}.`);
    discarded.push(infoOf(book, ai)?.typeLine ?? ai.typeLine ?? "");
  }
  const choice: Choice = { kind: "discard", source: name, by, discarded };
  if (g.sides.you.hand.length) g.choice = choice;
  else drawForTypes(g, choice, book);
}

/** Kefka's draw: one card for each card type among the discards. */
function drawForTypes(g: PracticeGame, choice: Choice, book: CardBook) {
  const types = [...new Set((choice.discarded ?? []).flatMap(cardTypes))];
  if (!types.length) return;
  say(g, choice.by, `${who(choice.by)} ${verb(choice.by, "draw")} ${types.length} for the card types discarded (${types.join(", ")}).`);
  drawCards(g, choice.by, types.length);
}

/** Can this permanent be sacrificed to "sacrifices a <what>"? */
const sacrificable = (book: CardBook, c: PlayCard, what: string) =>
  /\bnonland\b/.test(what) ? !isLand(c) : /\bcreature\b/.test(what) ? isCreature(book, c) : /\bland\b/.test(what) ? isLand(c) : true;

/** The permanent the AI would rather lose: a token, a land it has plenty
    of, its cheapest card, and its commander last. */
function aiSacrificePick(g: PracticeGame, seat: Seat, what: string, book: CardBook): PlayCard | null {
  const field = g.sides[seat].battlefield.filter((c) => sacrificable(book, c, what));
  if (!field.length) return null;
  const lands = g.sides[seat].battlefield.filter(isLand).length;
  const cost = (c: PlayCard) => {
    if (c.commander) return 100;
    if (c.token) return isCreature(book, c) ? stats(book, c).power * 0.1 : 0.05;
    if (isLand(c)) return (lands >= 5 ? 0.5 : 8) + (/\bBasic\b/.test(c.typeLine ?? "") ? 0 : 0.3);
    return 2 + (infoOf(book, c)?.manaValue ?? 0);
  };
  return field.reduce((a, b) => (cost(b) < cost(a) ? b : a));
}

/** "Each opponent sacrifices a permanent of their choice. Transform Kefka."
    The AI picks its own; you pick yours (the game's choice). */
function edictResolve(g: PracticeGame, by: Seat, source: PlayCard, e: Edict, book: CardBook) {
  const name = faceName(source);
  const foe = other(by);
  if (foe === "opp") {
    const pick = aiSacrificePick(g, "opp", e.what, book);
    if (pick) {
      moveTo(g, pick.iid, "graveyard");
      say(g, "opp", `The opponent sacrifices ${pick.name}.`);
    } else say(g, "opp", `The opponent has nothing to sacrifice.`);
  } else if (g.sides.you.battlefield.some((c) => sacrificable(book, c, e.what))) {
    g.choice = { kind: "sacrifice", source: name, by, what: e.what };
  } else say(g, "you", `You have nothing to sacrifice.`);
  if (e.transform && !source.flipped) {
    update(g, source.iid, (c) => ({ ...c, flipped: true }));
    const back = source.name.split(" // ")[1]?.trim();
    say(g, by, `${name} transforms${back ? ` into ${back}` : ""}.`);
  }
}

/** The cards you may pick for the choice the game is waiting on. */
export function choiceTargets(g: PracticeGame, book: CardBook): number[] {
  const c = g.choice;
  if (!c) return [];
  const you = g.sides.you;
  switch (c.kind) {
    case "discard":
      return you.hand.map((x) => x.iid);
    case "sacrifice":
      return you.battlefield.filter((x) => (c.types ? sharedTypes(book, x, c.types).length > 0 : sacrificable(book, x, c.what ?? "permanent"))).map((x) => x.iid);
    case "put":
      return you.hand.filter((x) => isPermanentCard(book, x)).map((x) => x.iid);
    case "attach":
      return [...you.battlefield, ...g.sides.opp.battlefield].filter((x) => x.iid !== c.aura && isCreature(book, x)).map((x) => x.iid);
  }
}

/** Your pick for the choice the game is waiting on: the card you discard,
    the permanent you sacrifice, the card you put onto the battlefield, or
    the creature your Aura goes on. */
export function resolveChoice(g0: PracticeGame, iid: number, book: CardBook): PracticeGame {
  const choice = g0.choice;
  if (!choice || !choiceTargets(g0, book).includes(iid)) return g0;
  const at = findCard(g0, iid)!;
  const g = structuredClone(g0);
  g.choice = null;
  if (choice.kind === "discard") {
    moveTo(g, iid, "graveyard");
    say(g, "you", `You discard ${at.card.name}.`);
    if (!choice.loot) drawForTypes(g, { ...choice, discarded: [...(choice.discarded ?? []), infoOf(book, at.card)?.typeLine ?? at.card.typeLine ?? ""] }, book);
  } else if (choice.kind === "sacrifice") {
    moveTo(g, iid, "graveyard");
    say(g, "you", `You sacrifice ${at.card.name}${choice.braids ? ` (${choice.source})` : ""}.`);
    if (choice.braids === "yours") braidsAnswer(g, "you", sharedTypes(book, at.card, choice.types ?? BRAIDS_TYPES), choice.life ?? 2, choice.source, book);
  } else if (choice.kind === "put") {
    moveTo(g, iid, "battlefield");
    say(g, "you", `You put ${at.card.name} onto the battlefield (${choice.source}).`, at.card);
    if (isLand(at.card)) landEntered(g, "you", book);
    else entered(g, "you", at.card, book, { cast: false });
  } else {
    update(g, choice.aura!, (c) => ({ ...c, attachedTo: iid }));
    say(g, "you", `${choice.source} goes on ${at.card.name}.`);
  }
  checkState(g, book);
  return g;
}

/** Not doing what the choice offers, when it's optional: Braids's
    sacrifice (yours: nothing happens; the AI's: you lose the life and it
    draws), or The Ur-Dragon's permanent. */
export function declineChoice(g0: PracticeGame, book: CardBook): PracticeGame {
  const c = g0.choice;
  if (!c?.decline) return g0;
  const g = structuredClone(g0);
  g.choice = null;
  if (c.braids === "theirs") {
    say(g, "you", `You don't sacrifice: you lose ${c.life ?? 2} life, and the opponent draws a card.`);
    loseLife(g, "you", c.life ?? 2, book);
    drawCards(g, "opp", 1);
  }
  checkState(g, book);
  return g;
}

/** You activate your permanent's "each opponent sacrifices" ability: paid
    from your untapped mana, then the AI sacrifices what it would rather
    lose, and the card transforms if it says so. */
export function playerEdict(g0: PracticeGame, iid: number, book: CardBook): PracticeGame {
  const at = findCard(g0, iid);
  if (!at || at.seat !== "you" || at.zone !== "battlefield") return g0;
  const e = edictOf(book, at.card);
  if (!e) return g0;
  const g = structuredClone(g0);
  const name = faceName(at.card);
  payForYou(g, parseCost(e.mana), `${name}'s ability`, book);
  say(g, "you", `You activate ${name}.`, at.card);
  edictResolve(g, "you", at.card, e, book);
  checkState(g, book);
  return g;
}

// ── Commanders' triggers (Winota, Selvala, Inalla, Light-Paws, Thranduil,
// The Ur-Dragon, Silas Renn, Braids, Beledros): see lib/practice/abilities.

/** A land entered under a seat's control: its landfall tokens (Thranduil). */
function landEntered(g: PracticeGame, seat: Seat, book: CardBook) {
  for (const c of [...g.sides[seat].battlefield]) {
    const t = landfallTokenOf(book, c);
    if (!t) continue;
    addTokens(g, seat, { name: t.name, power: t.power, toughness: t.toughness, keywords: t.keywords, kind: "creature" }, t.count);
    say(g, seat, `${faceName(c)}: landfall, ${t.count === 1 ? "a" : t.count} ${t.name} token${t.count === 1 ? "" : "s"} (${t.power}/${t.toughness}).`);
  }
}

/** A permanent entered under a seat's control: Selvala's draw for the
    biggest creature, the Elvenking's loot, Inalla's copy (paid, {1}), and
    the AI's Light-Paws search. Returns whether a copy was made, so the AI's
    enters effects can happen again. */
function entered(g: PracticeGame, seat: Seat, card: PlayCard, book: CardBook, opts: { cast: boolean }): boolean {
  const at = findCard(g, card.iid);
  if (!at || at.zone !== "battlefield") return false;
  const now = at.card;
  // Selvala: "its controller may draw a card if its power is greater than
  // each other creature's power".
  if (isCreature(book, now)) {
    const p = stats(book, now).power;
    const others = [...g.sides.you.battlefield, ...g.sides.opp.battlefield].filter((c) => c.iid !== now.iid && isCreature(book, c));
    if (others.every((c) => stats(book, c).power < p)) {
      for (const s of ["you", "opp"] as Seat[]) {
        for (const c of g.sides[s].battlefield) {
          if (c.iid === now.iid || !drawsForBiggest(book, c)) continue;
          say(g, seat, `${faceName(c)}: ${now.name} is the biggest creature; ${seat === "you" ? "you draw" : "the opponent draws"} a card.`);
          drawCards(g, seat, 1);
        }
      }
    }
  }
  // Thranduil, the Elvenking: another legendary Elf enters: draw two, then discard one.
  for (const c of [...g.sides[seat].battlefield]) {
    const l = lootOnEnterOf(book, c);
    if (!l || c.iid === now.iid || !isType(book, now, l.type) || (l.legendary && !isType(book, now, "legendary"))) continue;
    say(g, seat, `${faceName(c)}: ${seat === "you" ? "you draw" : "the opponent draws"} ${l.draw}, then discard${seat === "you" ? "" : "s"} a card.`);
    drawCards(g, seat, l.draw);
    if (seat === "opp") {
      const pick = aiDiscardPick(g, "opp", book);
      if (pick) {
        moveTo(g, pick.iid, "graveyard");
        say(g, "opp", `The opponent discards ${pick.name}.`);
      }
    } else if (!g.choice && g.sides.you.hand.length) g.choice = { kind: "discard", source: faceName(c), by: "you", loot: true };
  }
  // Inalla's eminence: another nontoken Wizard enters: pay {1} for a hasty copy.
  let copied = false;
  if (!now.token && !now.copy) {
    for (const c of [...g.sides[seat].battlefield, ...g.sides[seat].command]) {
      const e = copyOnEnterOf(book, c);
      if (!e || c.iid === now.iid || !isType(book, now, e.type)) continue;
      const cost = parseCost(e.cost);
      const sources = availableMana(g, seat, book);
      const paid = seat === "you" ? youPay(g, cost, sources, book) : aiPay(g, seat, cost, sources, book);
      if (!paid) {
        say(g, seat, `(${faceName(c)}: no mana left for a copy of ${now.name}.)`);
        break;
      }
      spend(g, seat, paid, sources);
      loseLife(g, seat, paid.life, book);
      const { counters: _c, damage: _d, attachedTo: _a, pump: _p, boost: _b, ...base } = now;
      const copy: PlayCard = { ...base, iid: g.nextIid++, copy: true, exileAtEnd: true, eot: ["Haste"], commander: false, enteredTurn: g.turn, tapped: false };
      g.sides[seat] = { ...g.sides[seat], battlefield: [...g.sides[seat].battlefield, copy] };
      say(g, seat, `${faceName(c)}: ${who(seat)} ${verb(seat, "pay")} ${e.cost} for a copy of ${now.name}, with haste. It's exiled at the end step.`, copy);
      entered(g, seat, copy, book, { cast: false });
      copied = true;
      break;
    }
  }
  // Light-Paws, the AI's (yours opens a search at the table): an Aura it
  // cast finds another, no pricier, with a new name, onto Light-Paws.
  if (opts.cast && seat === "opp" && isType(book, now, "aura")) {
    for (const lp of g.sides.opp.battlefield) if (auraTutorOf(book, lp)) aiAuraTutor(g, lp, now, book);
  }
  return copied;
}

/** What Light-Paws may find for an Aura of this mana value: an Aura no
    pricier, with a name none of your Auras has. */
export function auraTutorTest(g: PracticeGame, seat: Seat, aura: PlayCard, book: CardBook): (c: PlayCard) => boolean {
  const mv = infoOf(book, aura)?.manaValue ?? 0;
  const names = new Set(g.sides[seat].battlefield.filter((c) => isType(book, c, "aura")).map((c) => c.name));
  return (c) => isType(book, c, "aura") && (infoOf(book, c)?.manaValue ?? 0) <= mv && !names.has(c.name);
}

function aiAuraTutor(g: PracticeGame, lightPaws: PlayCard, aura: PlayCard, book: CardBook) {
  const test = auraTutorTest(g, "opp", aura, book);
  const pick = g.sides.opp.library.filter(test).sort((a, b) => (infoOf(book, b)?.manaValue ?? 0) - (infoOf(book, a)?.manaValue ?? 0))[0];
  g.sides.opp = { ...g.sides.opp, library: shuffled(g.sides.opp.library.filter((c) => c !== pick)) };
  if (!pick) {
    say(g, "opp", `${faceName(lightPaws)}: the opponent finds no Aura.`);
    return;
  }
  g.sides.opp = { ...g.sides.opp, library: [pick, ...g.sides.opp.library] };
  moveTo(g, pick.iid, "battlefield");
  update(g, pick.iid, (c) => ({ ...c, attachedTo: lightPaws.iid }));
  say(g, "opp", `${faceName(lightPaws)}: the opponent finds ${pick.name} and puts it on ${faceName(lightPaws)}.`, pick);
}

/** The AI's Aura goes on what its plan targets, else on the player's best
    creature if it's a curse (can't attack or block, -N/-N), else on its own
    best: Light-Paws, its commander, its biggest. Nothing to enchant: it's
    put into the graveyard. */
function aiAttach(g: PracticeGame, seat: Seat, aura: PlayCard, action: PlanAction, book: CardBook) {
  const creatures = (s: Seat) => g.sides[s].battlefield.filter((c) => c.iid !== aura.iid && isCreature(book, c));
  const targeted = action.effects.map((e) => parseCardId(e.target)).find((t) => t !== null && [...creatures("you"), ...creatures("opp")].some((c) => c.iid === t));
  const text = faceText(infoOf(book, aura), aura).toLowerCase();
  const curse = /can't attack|can't block|gets -\d|doesn't untap/.test(text);
  const biggest = (cs: PlayCard[]) => [...cs].sort((a, b) => stats(book, b).power - stats(book, a).power)[0];
  const mine = creatures(seat);
  const host =
    targeted ??
    (curse
      ? biggest(creatures(other(seat)))?.iid
      : (mine.find((c) => auraTutorOf(book, c)) ?? mine.find((c) => c.commander) ?? biggest(mine))?.iid);
  if (host === undefined) {
    moveTo(g, aura.iid, "graveyard");
    say(g, seat, `${aura.name} has nothing to enchant.`);
    return;
  }
  update(g, aura.iid, (c) => ({ ...c, attachedTo: host }));
  say(g, seat, `${aura.name} goes on ${findCard(g, host)?.card.name ?? "a creature"}.`);
}

/** Winota: a non-Human attacker looks at the top six for a Human to put
    in tapped and attacking (indestructible this turn); the rest go to the
    bottom in a random order. The best Human is picked for you too. */
function winotaTrigger(g: PracticeGame, seat: Seat, source: PlayCard, w: { look: number; type: string }, book: CardBook) {
  const top = g.sides[seat].library.slice(0, w.look);
  const pick = top
    .filter((c) => isCreature(book, c) && isType(book, c, w.type))
    .sort((a, b) => (infoOf(book, b)?.manaValue ?? 0) - (infoOf(book, a)?.manaValue ?? 0) || stats(book, b).power - stats(book, a).power)[0];
  const rest = new Set(top.filter((c) => c !== pick).map((c) => c.iid));
  if (pick) {
    moveTo(g, pick.iid, "battlefield", { tapped: true });
    update(g, pick.iid, (c) => ({ ...c, eot: [...(c.eot ?? []), "Indestructible"] }));
    if (g.combat) g.combat = { ...g.combat, attackers: [...g.combat.attackers, pick.iid] };
    say(g, seat, `${faceName(source)}: ${who(seat)} ${verb(seat, "put")} ${pick.name} onto the battlefield tapped and attacking, indestructible this turn.`, pick);
    entered(g, seat, pick, book, { cast: false });
  } else say(g, seat, `${faceName(source)}: no ${w.type} among the top ${top.length}.`);
  const lib = g.sides[seat].library;
  g.sides[seat] = { ...g.sides[seat], library: [...lib.filter((c) => !rest.has(c.iid)), ...shuffled(lib.filter((c) => rest.has(c.iid)))] };
}

const isPermanentCard = (book: CardBook, c: PlayCard) => /\b(Artifact|Creature|Enchantment|Land|Planeswalker|Battle)\b/.test(frontLine(book, c));

/** The Ur-Dragon: Dragons attacked, so draw that many, then put a permanent
    card from the hand onto the battlefield: the AI its priciest; you choose
    (or none). */
function putFromHand(g: PracticeGame, seat: Seat, source: string, book: CardBook) {
  const hand = g.sides[seat].hand.filter((c) => isPermanentCard(book, c));
  if (!hand.length) return;
  if (seat === "you") {
    if (!g.choice) g.choice = { kind: "put", source, by: "you", decline: "None" };
    return;
  }
  const pick = [...hand].sort((a, b) => Number(isLand(a)) - Number(isLand(b)) || (infoOf(book, b)?.manaValue ?? 0) - (infoOf(book, a)?.manaValue ?? 0))[0]!;
  moveTo(g, pick.iid, "battlefield");
  say(g, "opp", `${source}: the opponent puts ${pick.name} onto the battlefield.`, pick);
  if (isLand(pick)) landEntered(g, "opp", book);
  else entered(g, "opp", pick, book, { cast: false });
}

const BRAIDS_TYPES = ["artifact", "creature", "enchantment", "land", "planeswalker"];
const sharedTypes = (book: CardBook, c: PlayCard, types: string[]) => cardTypes(frontLine(book, c)).filter((t) => types.includes(t));

/** Braids answered: the other player sacrifices a permanent sharing a type,
    or loses the life and Braids's controller draws. The AI keeps what's
    worth more than that; you choose (the game's choice). */
function braidsAnswer(g: PracticeGame, by: Seat, types: string[], life: number, source: string, book: CardBook) {
  const victim = other(by);
  const options = g.sides[victim].battlefield.filter((c) => sharedTypes(book, c, types).length);
  const pay = () => {
    say(g, victim, `${victim === "you" ? "You don't sacrifice: you lose" : "The opponent doesn't sacrifice: it loses"} ${life} life, and ${by === "you" ? "you draw" : "the opponent draws"} a card.`);
    loseLife(g, victim, life, book);
    drawCards(g, by, 1);
  };
  if (!options.length) return pay();
  if (victim === "you") {
    g.choice = { kind: "sacrifice", source, by, types, decline: `Lose ${life} life`, braids: "theirs", life };
    return;
  }
  // Fodder it won't miss; anything but its commander when the life hurts.
  const lands = g.sides.opp.battlefield.filter(isLand).length;
  const cheap = options.find((c) => c.token || c.copy || (isLand(c) && lands >= 6));
  const low = g.sides.opp.life <= life + 4;
  const pick = cheap ?? (low ? [...options].filter((c) => !c.commander).sort((a, b) => (infoOf(book, a)?.manaValue ?? 0) - (infoOf(book, b)?.manaValue ?? 0))[0] : undefined);
  if (!pick) return pay();
  moveTo(g, pick.iid, "graveyard");
  say(g, "opp", `The opponent sacrifices ${pick.name} (${source}).`);
}

/** Your end step, with Braids: you may sacrifice an artifact, creature,
    enchantment, land or planeswalker (the game's choice, with "Don't"). */
export function playerEndStep(g0: PracticeGame, book: CardBook): PracticeGame {
  if (g0.choice || g0.winner || g0.active !== "you") return g0;
  const braids = g0.sides.you.battlefield.find((c) => braidsOf(book, c));
  if (!braids || !g0.sides.you.battlefield.some((c) => sharedTypes(book, c, BRAIDS_TYPES).length)) return g0;
  const g = structuredClone(g0);
  g.choice = { kind: "sacrifice", source: faceName(braids), by: "you", types: BRAIDS_TYPES, decline: "Don't sacrifice", braids: "yours", life: braidsOf(book, braids)!.life };
  return g;
}

/** The AI's end step: Inalla taps five Wizards for 7 life as often as it
    can, and Braids sacrifices fodder (a copy about to be exiled, a token, a
    spare land) for the player to answer. */
export function aiEndStep(g0: PracticeGame, book: CardBook): PracticeGame {
  if (g0.winner || g0.active !== "opp") return g0;
  const g = structuredClone(g0);
  for (const c of [...g.sides.opp.battlefield]) {
    const t = tapTribeOf(book, c);
    if (!t) continue;
    for (let n = 0; n < 4 && !g.winner; n++) if (!tapTribe(g, "opp", c, t, book)) break;
  }
  const braids = g.sides.opp.battlefield.find((c) => braidsOf(book, c));
  if (braids && !g.choice && !g.winner) {
    const lands = g.sides.opp.battlefield.filter(isLand).length;
    const fodder =
      g.sides.opp.battlefield.find((c) => c.exileAtEnd) ??
      g.sides.opp.battlefield.find((c) => c.token) ??
      (lands >= 6 ? g.sides.opp.battlefield.find((c) => isLand(c) && /\bBasic\b/.test(c.typeLine ?? "")) : undefined);
    if (fodder) {
      const types = sharedTypes(book, fodder, BRAIDS_TYPES);
      moveTo(g, fodder.iid, "graveyard");
      say(g, "opp", `${faceName(braids)}: the opponent sacrifices ${fodder.name}. Sacrifice a ${types.join(" or ")}, or lose ${braidsOf(book, braids)!.life} life and it draws.`);
      braidsAnswer(g, "opp", types, braidsOf(book, braids)!.life, faceName(braids), book);
    }
  }
  checkState(g, book);
  return g;
}

/** Inalla: tap untapped Wizards (copies and tokens first; sickness doesn't
    matter, it isn't {T}) for the other player to lose the life. */
function tapTribe(g: PracticeGame, seat: Seat, source: PlayCard, t: { count: number; type: string; life: number }, book: CardBook): boolean {
  const ready = g.sides[seat].battlefield
    .filter((c) => !c.tapped && isCreature(book, c) && isType(book, c, t.type))
    .sort((a, b) => Number(!!b.exileAtEnd) - Number(!!a.exileAtEnd) || Number(!!b.token) - Number(!!a.token) || stats(book, a).power - stats(book, b).power);
  if (ready.length < t.count) return false;
  for (const c of ready.slice(0, t.count)) update(g, c.iid, (x) => ({ ...x, tapped: true }));
  const foe = other(seat);
  say(g, seat, `${faceName(source)}: ${who(seat)} ${verb(seat, "tap")} ${t.count} ${t.type}s; ${foe === "you" ? "you lose" : "the opponent loses"} ${t.life} life.`);
  loseLife(g, foe, t.life, book);
  checkState(g, book);
  return true;
}

/** Your Inalla: "Tap five untapped Wizards you control: Target player loses 7 life." */
export function playerTapTribe(g0: PracticeGame, iid: number, book: CardBook): PracticeGame {
  const at = findCard(g0, iid);
  const t = at && at.seat === "you" && at.zone === "battlefield" ? tapTribeOf(book, at.card) : null;
  if (!at || !t) return g0;
  const g = structuredClone(g0);
  if (!tapTribe(g, "you", at.card, t, book)) say(g, "you", `(${faceName(at.card)}: you need ${t.count} untapped ${t.type}s.)`);
  return g;
}

/** Beledros Witherbloom: pay 10 life, untap all your lands; once a turn. */
function untapLands(g: PracticeGame, seat: Seat, card: PlayCard, life: number, book: CardBook): boolean {
  if (g.once?.includes(card.iid)) return false;
  g.once = [...(g.once ?? []), card.iid];
  g.sides[seat] = { ...g.sides[seat], battlefield: g.sides[seat].battlefield.map((c) => (isLand(c) ? { ...c, tapped: false } : c)) };
  say(g, seat, `${who(seat)} ${verb(seat, "pay")} ${life} life to untap ${seat === "you" ? "your" : "its"} lands (${faceName(card)}).`);
  loseLife(g, seat, life, book);
  checkState(g, book);
  return true;
}

export function playerUntapLands(g0: PracticeGame, iid: number, book: CardBook): PracticeGame {
  const at = findCard(g0, iid);
  const u = at && at.seat === "you" && at.zone === "battlefield" ? untapLandsOf(book, at.card) : null;
  if (!at || !u || g0.once?.includes(iid)) return g0;
  const g = structuredClone(g0);
  untapLands(g, "you", at.card, u.life, book);
  return g;
}

/** The AI's casts from its graveyard this turn (Silas Renn), when it can
    pay: as actions for the table to play out. */
export function aiGraveyardCasts(g: PracticeGame, book: CardBook): PlanAction[] {
  return (g.mayCast ?? []).flatMap((iid) => {
    const c = g.sides.opp.graveyard.find((x) => x.iid === iid);
    if (!c || !castable(g, "opp", c, book, "graveyard")) return [];
    return [{ kind: "cast" as const, card: cardId(iid), x: null, tap_card: null, sacrifice_card: null, mana: null, life: null, effects: [] }];
  });
}

// ── Your casts, paid for you; your searches ─────────────────────────────

/** You cast a card: the mana it needs is tapped for you first (lands, then
    one-shot sources like a Treasure), then it's played as by hand. A card
    with another way to cast it (Force of Will) isn't tapped for, nor one you
    can't pay for (tap by hand); X is left to you. Undo puts it all back. */
export function playerCast(g0: PracticeGame, iid: number, book: CardBook): PracticeGame {
  const at = findCard(g0, iid);
  if (!at || !playableZone(g0, at)) return g0;
  if (isLand(at.card) || g0.winner) return playerPlay(g0, iid, book);
  const info = infoOf(book, at.card);
  const cost = spellCost(g0, "you", at.card, book, at.zone);
  if (hasAltCost(info) || totalOf(cost) === 0) return playerPlay(g0, iid, book);
  const g = structuredClone(g0);
  payForYou(g, cost, at.card.name, book);
  return playerPlay(g, iid, book);
}

/** What you'd pay for a cost now: mana, and with K'rrik 2 life for each
    {B} the mana can't cover, but never the life you have left. */
export function youPay(g: PracticeGame, cost: Cost, sources: Source[], book: CardBook) {
  const paid = payCost(cost, sources, { x: 0, lifeFor: lifeFor(g, "you", book) });
  return paid && paid.life < g.sides.you.life ? paid : null;
}

/** Pay a cost of yours from your untapped mana (and, with K'rrik, 2 life
    for each {B} the mana can't cover), or say to tap by hand. */
function payForYou(g: PracticeGame, cost: Cost, what: string, book: CardBook) {
  const sources = availableMana(g, "you", book);
  const paid = youPay(g, cost, sources, book);
  if (!paid) {
    say(g, "you", `(Not enough untapped mana for ${what}: tap what you use by hand.)`);
    return;
  }
  // The tapped ones by name; a one-shot source (a Treasure) logs its own sacrifice.
  const names = paid.tap.filter((t) => t > 0 && !sources.find((x) => x.iid === t)?.sacrifice).map((t) => findCard(g, t)?.card.name ?? "");
  if (names.length || paid.life) say(g, "you", `You ${names.length ? `tap ${names.join(", ")}` : ""}${names.length && paid.life ? " and " : ""}${paid.life ? `pay ${paid.life} life` : ""} for ${what}${cost.xCount ? " (tap for X by hand)" : ""}.`);
  spend(g, "you", paid, sources);
  loseLife(g, "you", paid.life, book);
}

/** One find of a search: from your library to your hand or the
    battlefield. ("On top" waits for finishSearch, after the shuffle.) */
export function playerFind(g0: PracticeGame, iid: number, to: "hand" | "battlefield", tapped = false, book: CardBook = {}, attachTo?: number): PracticeGame {
  const at = findCard(g0, iid);
  if (!at || at.seat !== "you" || at.zone !== "library") return g0;
  const g = structuredClone(g0);
  moveTo(g, iid, to, { tapped });
  // An Aura found for Light-Paws goes on Light-Paws.
  const host = attachTo !== undefined ? findCard(g, attachTo) : null;
  if (to === "battlefield" && host?.zone === "battlefield") update(g, iid, (c) => ({ ...c, attachedTo: attachTo }));
  say(g, "you", `You find ${at.card.name}${to === "hand" ? " (to your hand)" : host ? ` and put it on ${host.card.name}` : ""}.`);
  if (to === "battlefield") {
    if (isLand(at.card)) landEntered(g, "you", book);
    else entered(g, "you", at.card, book, { cast: false });
  }
  checkState(g, book);
  return g;
}

/** The end of a search: shuffle your library, then put what goes on top there. */
export function finishSearch(g0: PracticeGame, onTop: number[] = []): PracticeGame {
  const g = structuredClone(g0);
  g.sides.you = { ...g.sides.you, library: shuffled(g.sides.you.library) };
  for (const iid of onTop) {
    const at = findCard(g, iid);
    if (!at || at.zone !== "library") continue;
    g.sides.you = { ...g.sides.you, library: [at.card, ...g.sides.you.library.filter((c) => c.iid !== iid)] };
    say(g, "you", `You put ${at.card.name} on top of your library.`);
  }
  say(g, "you", `You shuffle your library.`);
  return g;
}

/** Use a permanent's search ability (crack a fetch land): its tap, life and
    sacrifice are paid here; a mana cost you pay by hand. The search follows. */
export function playerUseSearch(g0: PracticeGame, iid: number, ability: SearchAbility, book: CardBook = {}): PracticeGame {
  const at = findCard(g0, iid);
  if (!at || at.seat !== "you" || at.zone !== "battlefield") return g0;
  const g = structuredClone(g0);
  if (ability.tap) update(g, iid, (c) => ({ ...c, tapped: true }));
  if (ability.sacrifice) moveTo(g, iid, "graveyard");
  say(g, "you", `You ${ability.sacrifice ? "sacrifice" : "use"} ${at.card.name}${ability.life ? ` and pay ${ability.life} life` : ""} to search your library.`);
  loseLife(g, "you", ability.life, book);
  return g;
}

/** A paid-for cast takes effect: a permanent enters, a spell resolves. */
function resolveCast(g: PracticeGame, seat: Seat, card: PlayCard, action: PlanAction, book: CardBook) {
  if (resolvesToGraveyard(card.typeLine)) {
    applyEffects(g, seat, action.effects, book, card.name);
    moveTo(g, card.iid, "graveyard");
  } else {
    moveTo(g, card.iid, "battlefield");
    // An Aura goes on what it targets, or where it helps most.
    if (isType(book, card, "aura")) aiAttach(g, seat, card, action, book);
    // Kefka's discard is the table's to carry out, not the plan's.
    const auto = discardTriggerOf(book, card)?.enters;
    const effects = auto ? action.effects.filter((e) => e.type !== "discard" && e.type !== "draw") : action.effects;
    applyEffects(g, seat, effects, book, card.name);
    if (auto) discardTrigger(g, seat, card, book);
    // Inalla's copy enters too: its enters ability happens again.
    if (entered(g, seat, card, book, { cast: true }) && effects.length) applyEffects(g, seat, effects, book, `${card.name} (the copy)`);
  }
  checkState(g, book);
}

/** On your turn, the AI may answer one of your creatures with an instant
    from its hand (Swords to Plowshares, Lightning Bolt, Into the Roil):
    an attacker when you attack, or your biggest threat at the end of your
    turn. Returns the cast, as an action for the table to play out (and for
    you to answer), or null when nothing is worth it or payable. */
export function aiRemovalAction(g: PracticeGame, book: CardBook, targets: number[], when: "attack" | "end"): PlanAction | null {
  const opp = g.sides.opp;
  const options = opp.hand.flatMap((c) => {
    const r = removalOf(infoOf(book, c));
    return r ? [{ c, r }] : [];
  });
  if (!options.length) return null;
  const sources = availableMana(g, "opp", book);
  const affordable = options
    .filter(({ c }) => aiPay(g, "opp", spellCost(g, "opp", c, book, "hand"), sources, book) !== null)
    .sort((a, b) => (infoOf(book, a.c)?.manaValue ?? 0) - (infoOf(book, b.c)?.manaValue ?? 0));
  if (!affordable.length) return null;
  const attacking = new Set(g.combat?.attackers ?? []);
  const creatures = targets
    .map((iid) => g.sides.you.battlefield.find((c) => c.iid === iid))
    .filter((c): c is PlayCard => !!c && isCreature(book, c));
  const incoming = when === "attack" ? creatures.reduce((n, c) => n + stats(book, c).power, 0) : 0;
  const worth = (c: PlayCard) => stats(book, c).power >= (when === "attack" ? 3 : 4) || c.commander || (when === "attack" && incoming >= opp.life);
  const ranked = creatures.filter(worth).sort((a, b) => stats(book, b).power - stats(book, a).power || (infoOf(book, b)?.manaValue ?? 0) - (infoOf(book, a)?.manaValue ?? 0));
  for (const target of ranked) {
    const s = stats(book, target);
    const tInfo = infoOf(book, target);
    const fit = affordable.find(({ r }) => {
      if (r.attackingOnly && !attacking.has(target.iid)) return false;
      if (r.notColor && new RegExp(`\\{[^}]*${r.notColor}[^}]*\\}`).test(tInfo?.manaCost ?? "")) return false;
      if (r.notType && new RegExp(`\\b${r.notType}\\b`, "i").test(tInfo?.typeLine ?? target.typeLine ?? "")) return false;
      if (r.kind === "destroy" && indestructible(g, "you", target, book)) return false;
      if (r.kind === "damage" && (indestructible(g, "you", target, book) || r.amount < s.toughness - (target.damage ?? 0))) return false;
      return true;
    });
    if (!fit) continue;
    const effect: Effect = { type: fit.r.kind === "damage" ? "damage" : fit.r.kind, target: cardId(target.iid), player: null, amount: fit.r.amount || null, name: null, power: null, toughness: null, keywords: [], to: null, tapped: null, text: null };
    const rider: Effect[] = fit.r.rider ? [{ ...effect, type: "note", target: null, amount: null, text: fit.r.rider }] : [];
    return { kind: "cast", card: cardId(fit.c.iid), x: null, tap_card: null, sacrifice_card: null, mana: null, life: null, effects: [effect, ...rider] };
  }
  return null;
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
          say(g, caster, `${source} deals ${amount} damage to ${s === "you" ? "you" : "the opponent"}.`);
          loseLife(g, s, amount, book);
        } else if (onField && isCreature(book, onField.card)) {
          update(g, onField.card.iid, (c) => ({ ...c, damage: (c.damage ?? 0) + amount }));
          say(g, caster, `${source} deals ${amount} damage to ${onField.card.name}.`);
        }
        break;
      }
      case "life": {
        const s = seatOf(caster, e.player);
        const delta = Math.max(-99, Math.min(99, Math.floor(e.amount ?? 0)));
        say(g, caster, `${s === "you" ? "You" : "The opponent"} ${delta >= 0 ? "gains" : "loses"} ${Math.abs(delta)} life.`);
        if (delta < 0) loseLife(g, s, -delta, book);
        else g.sides[s] = { ...g.sides[s], life: g.sides[s].life + delta };
        break;
      }
      case "destroy":
      case "exile":
      case "bounce": {
        if (!onField) break;
        if (e.type === "destroy" && indestructible(g, onField.seat, onField.card, book)) {
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
        const artifact = ARTIFACT_TOKENS.test(name) || (e.power === null && e.toughness === null);
        addTokens(g, s, { name, power: e.power ?? 1, toughness: e.toughness ?? 1, keywords: e.keywords, kind: artifact ? "artifact" : "creature", tapped: !!e.tapped }, count);
        say(g, caster, `${source} makes ${count} ${name} token${count === 1 ? "" : "s"}${artifact ? "" : ` (${e.power ?? 1}/${e.toughness ?? 1})`}.`);
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
        if (e.to !== "hand") {
          if (isLand(found)) landEntered(g, s, book);
          else entered(g, s, found, book, { cast: false });
        }
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
  g.attacked = [...(g.attacked ?? []), ...attackers];
  // "Whenever Kefka attacks": its discard, before blocks.
  for (const iid of attackers) {
    const card = findCard(g, iid)!.card;
    if (discardTriggerOf(book, card)?.attacks && !g.choice) discardTrigger(g, seat, card, book);
  }
  // Winota: each non-Human attacker brings a Human in from the top six.
  const winotas = g.sides[seat].battlefield.flatMap((c) => {
    const w = winotaOf(book, c);
    return w ? [{ c, w }] : [];
  });
  for (const iid of attackers) {
    const a = findCard(g, iid)?.card;
    if (!a) continue;
    for (const { c, w } of winotas) if (!isType(book, a, w.notType)) winotaTrigger(g, seat, c, w, book);
  }
  // The Ur-Dragon: one card for each attacking Dragon, then a permanent from the hand.
  for (const c of [...g.sides[seat].battlefield]) {
    const t = tribeAttackOf(book, c);
    if (!t) continue;
    const n = attackers.filter((iid) => {
      const a = findCard(g, iid)?.card;
      return !!a && isType(book, a, t.type);
    }).length;
    if (!n) continue;
    say(g, seat, `${faceName(c)}: ${n} ${t.type}${n === 1 ? "" : "s"} attack; ${seat === "you" ? "you draw" : "the opponent draws"} ${n}.`);
    drawCards(g, seat, n);
    putFromHand(g, seat, faceName(c), book);
  }
  checkState(g, book);
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
    // Attackers that hit the player this step, for "deals combat damage to
    // a player" triggers (Yuriko).
    const hitters: PlayCard[] = [];
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
          if (left > 0) hitters.push(attacker);
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
              hitters.push(attacker);
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
      say(g, atk, `${def === "you" ? "You take" : "The opponent takes"} ${toPlayer} combat damage.`);
      loseLife(g, def, toPlayer, book);
    }
    if (cmdToPlayer && g.commanderGame) g.cmdDamage[def] += cmdToPlayer;
    for (const s of ["you", "opp"] as Seat[]) {
      if (gain[s]) {
        g.sides[s] = { ...g.sides[s], life: g.sides[s].life + gain[s] };
        say(g, s, `${s === "you" ? "You gain" : "The opponent gains"} ${gain[s]} life (lifelink).`);
      }
    }
    for (const h of hitters) hitTriggers(g, atk, h, book);
    for (const iid of deathtouched) {
      const c = findCard(g, iid);
      if (c && c.zone === "battlefield" && !indestructible(g, c.seat, c.card, book)) {
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

/** An attacker hit the player: its controller's "whenever a Ninja you
    control deals combat damage to a player" triggers (Yuriko's reveal and
    life loss, a card), and its own "whenever ~ deals combat damage to a
    player, draw a card". */
function hitTriggers(g: PracticeGame, seat: Seat, hitter: PlayCard, book: CardBook) {
  const foe = other(seat);
  // Silas Renn: an artifact card from the graveyard may be cast this turn
  // (the priciest; yours shows "Cast it" in its menu).
  const kind = castFromGraveyardOnHitOf(book, hitter);
  if (kind) {
    const pick = g.sides[seat].graveyard
      .filter((c) => cardTypes(frontLine(book, c)).includes(kind) && !(g.mayCast ?? []).includes(c.iid))
      .sort((a, b) => (infoOf(book, b)?.manaValue ?? 0) - (infoOf(book, a)?.manaValue ?? 0))[0];
    if (pick) {
      g.mayCast = [...(g.mayCast ?? []), pick.iid];
      say(g, seat, `${faceName(hitter)}: ${seat === "you" ? "you" : "the opponent"} may cast ${pick.name} from ${seat === "you" ? "your" : "its"} graveyard this turn.`);
    }
  }
  for (const c of [...g.sides[seat].battlefield]) {
    for (const t of hitTriggersOf(book, c)) {
      if (t.ninjas ? !isNinja(book, hitter) : c.iid !== hitter.iid) continue;
      const name = faceName(c);
      if (t.reveal) {
        const top = g.sides[seat].library[0];
        if (!top) continue;
        const mv = infoOf(book, top)?.manaValue ?? 0;
        drawCards(g, seat, 1);
        say(g, seat, `${name}: ${seat === "you" ? "you reveal" : "the opponent reveals"} ${top.name} and ${verb(seat, "put")} it into ${seat === "you" ? "your" : "its"} hand${mv ? `; ${foe === "you" ? "you lose" : "the opponent loses"} ${mv} life` : ""}.`);
        loseLife(g, foe, mv, book);
      }
      if (t.draw) {
        say(g, seat, `${who(seat)} ${verb(seat, "draw")} ${t.draw} (${name}).`);
        drawCards(g, seat, t.draw);
      }
    }
  }
}

// ── Ninjutsu (Yuriko) ──────────────────────────────────────────────────

export interface NinjutsuOption {
  ninja: PlayCard;
  zone: "hand" | "command";
  cost: string;
  /** The unblocked attackers it can replace. */
  unblocked: PlayCard[];
}

/** After blocks: the ninjas a seat can bring in now, from its hand (or
    its command zone, for commander ninjutsu), that it can pay for. */
export function ninjutsuOptions(g: PracticeGame, seat: Seat, book: CardBook): NinjutsuOption[] {
  const combat = g.combat;
  if (!combat || combat.attacker !== seat || combat.stage !== "blocked" || g.winner) return [];
  const side = g.sides[seat];
  const unblocked = combat.attackers
    .filter((a) => !combat.blocks[a]?.length)
    .map((a) => side.battlefield.find((c) => c.iid === a))
    .filter((c): c is PlayCard => !!c);
  if (!unblocked.length) return [];
  const sources = availableMana(g, seat, book);
  const out: NinjutsuOption[] = [];
  for (const [zone, cards] of [
    ["hand", side.hand],
    ["command", side.command],
  ] as const) {
    for (const card of cards) {
      const n = ninjutsuOf(book, card);
      if (!n || (zone === "command" && !n.commander)) continue;
      const cost = parseCost(n.cost);
      const paid = seat === "you" ? youPay(g, cost, sources, book) : aiPay(g, seat, cost, sources, book);
      if (paid) out.push({ ninja: card, zone, cost: n.cost, unblocked });
    }
  }
  return out;
}

/** Ninjutsu: pay, return an unblocked attacker to its owner's hand, and
    put the ninja onto the battlefield tapped and attacking in its place.
    It isn't cast: no commander tax, and nothing counters it. */
export function ninjutsu(g0: PracticeGame, seat: Seat, ninjaIid: number, attackerIid: number, book: CardBook): PracticeGame {
  const opt = ninjutsuOptions(g0, seat, book).find((o) => o.ninja.iid === ninjaIid);
  const attacker = opt?.unblocked.find((a) => a.iid === attackerIid);
  if (!opt || !attacker) return g0;
  const g = structuredClone(g0);
  const name = faceName(opt.ninja);
  if (seat === "you") payForYou(g, parseCost(opt.cost), `${name}'s ninjutsu`, book);
  else {
    const sources = availableMana(g, seat, book);
    const paid = aiPay(g, seat, parseCost(opt.cost), sources, book);
    if (!paid) return g0;
    spend(g, seat, paid, sources);
    loseLife(g, seat, paid.life, book);
  }
  moveTo(g, attackerIid, "hand");
  moveTo(g, ninjaIid, "battlefield", { tapped: true });
  g.combat = { ...g.combat!, attackers: g.combat!.attackers.map((a) => (a === attackerIid ? ninjaIid : a)) };
  say(g, seat, `${who(seat)} ${seat === "you" ? "use" : "uses"} ninjutsu: ${name} attacks in place of ${attacker.name}, which goes back to ${seat === "you" ? "your" : "its"} hand.`, opt.ninja);
  return g;
}

/** The AI's ninjutsu after your blocks: a ninja with a hit trigger
    (Yuriko) first, then the biggest, each for its least valuable unblocked
    attacker (not its commander, not another ninja), when the swap is worth
    it. */
export function aiNinjutsu(g0: PracticeGame, book: CardBook): PracticeGame {
  let g = g0;
  const worth = (c: PlayCard) => (c.token ? 0.5 : (infoOf(book, c)?.manaValue ?? 0));
  const triggers = (c: PlayCard) => hitTriggersOf(book, c).some((t) => t.ninjas) || g.sides.opp.battlefield.some((x) => hitTriggersOf(book, x).some((t) => t.ninjas));
  for (let i = 0; i < 3; i++) {
    const options = ninjutsuOptions(g, "opp", book);
    if (!options.length) break;
    const score = (o: NinjutsuOption) => (hitTriggersOf(book, o.ninja).length ? 100 : 0) + stats(book, o.ninja).power + (o.zone === "command" ? 1 : 0);
    const best = options.reduce((a, b) => (score(b) > score(a) ? b : a));
    const back = best.unblocked
      .filter((a) => !a.commander && !isNinja(book, a))
      .sort((x, y) => worth(x) - worth(y) || stats(book, x).power - stats(book, y).power)[0];
    if (!back) break;
    if (!triggers(best.ninja) && stats(book, best.ninja).power <= stats(book, back).power) break;
    const next = ninjutsu(g, "opp", best.ninja.iid, back.iid, book);
    if (next === g) break;
    g = next;
  }
  return g;
}

// ── Scry (your side) ───────────────────────────────────────────────────

/** You scry: the cards you looked at go back, some on top in the order you
    set, the rest on the bottom. The log says how many, not which. */
export function playerScry(g0: PracticeGame, top: number[], bottom: number[]): PracticeGame {
  const n = top.length + bottom.length;
  if (!n) return g0;
  const next = scry(g0.sides.you, top, bottom);
  if (next === g0.sides.you) return g0;
  const g = structuredClone(g0);
  g.sides.you = next;
  say(g, "you", `You scry ${n}: ${top.length} on top, ${bottom.length} on the bottom.`);
  return g;
}
