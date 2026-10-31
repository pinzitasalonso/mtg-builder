// The parts of the AI opponent that are rules, not judgement, and so need
// no model: how it blocks, whether it mulligans, and the plan it falls back
// on when the model can't be reached. See docs/practice-vs-ai.md.

import { mulligan as londonMulligan, bottomCard, isLandCard, type PlayCard, type PlaytestState } from "../playtest";
import { has, infoOf, isCreature, isLand, stats } from "./cards";
import { canAttack, canBlock, cardId, castable } from "./game";
import { manaSources, parseCost, payCost } from "./mana";
import { other, type CardBook, type PlanAction, type PracticeGame, type Seat, type TurnPlan } from "./types";

const value = (book: CardBook, c: PlayCard) => (c.token ? 1 : (infoOf(book, c)?.manaValue ?? 0));

/** Would this blocker kill the attacker? Survive it? */
function exchange(book: CardBook, attacker: PlayCard, blocker: PlayCard) {
  const a = stats(book, attacker);
  const b = stats(book, blocker);
  const kills = (b.power >= a.toughness - (attacker.damage ?? 0) && b.power > 0) || (has(book, blocker, "Deathtouch") && b.power > 0);
  const dies =
    !has(book, blocker, "Indestructible") &&
    ((a.power >= b.toughness - (blocker.damage ?? 0) && a.power > 0) || (has(book, attacker, "Deathtouch") && a.power > 0));
  const firstStrikeWin = (has(book, blocker, "First strike") || has(book, blocker, "Double strike")) && !has(book, attacker, "First strike") && kills;
  return { kills: kills && !has(book, attacker, "Indestructible"), dies: dies && !firstStrikeWin };
}

/** How the defending side blocks: to survive first, then blocks that win,
    then trades that are worth it. */
export function chooseBlocks(g: PracticeGame, book: CardBook): Record<number, number[]> {
  const combat = g.combat;
  if (!combat) return {};
  const def = other(combat.attacker);
  const attackers = combat.attackers
    .map((iid) => g.sides[combat.attacker].battlefield.find((c) => c.iid === iid))
    .filter((c): c is PlayCard => !!c)
    .sort((x, y) => stats(book, y).power - stats(book, x).power);
  const free = g.sides[def].battlefield.filter((c) => isCreature(book, c) && !c.tapped);
  const blocks: Record<number, number[]> = {};
  const taken = new Set<number>();
  const hit = (a: PlayCard) => stats(book, a).power * (has(book, a, "Double strike") ? 2 : 1);
  const unblocked = () => attackers.filter((a) => !blocks[a.iid]).reduce((n, a) => n + hit(a), 0);

  // Blocks that win: the blocker kills it and lives. The smallest that does.
  for (const a of attackers) {
    if (has(book, a, "Menace")) continue;
    const winner = free
      .filter((b) => !taken.has(b.iid) && canBlock(book, b, a))
      .filter((b) => {
        const x = exchange(book, a, b);
        return x.kills && !x.dies;
      })
      .sort((x, y) => value(book, x) - value(book, y))[0];
    if (winner) {
      blocks[a.iid] = [winner.iid];
      taken.add(winner.iid);
    }
  }
  // Survive: if what gets through is lethal, put bodies in front of the
  // biggest hitters until it isn't.
  const life = g.sides[def].life;
  for (const a of attackers) {
    if (unblocked() < life) break;
    if (blocks[a.iid]) continue;
    const need = has(book, a, "Menace") ? 2 : 1;
    const chumps = free
      .filter((b) => !taken.has(b.iid) && canBlock(book, b, a))
      .sort((x, y) => value(book, x) - value(book, y))
      .slice(0, need);
    if (chumps.length === need) {
      blocks[a.iid] = chumps.map((c) => c.iid);
      chumps.forEach((c) => taken.add(c.iid));
    }
  }
  // Trades worth taking: both die, and the attacker cost more.
  for (const a of attackers) {
    if (blocks[a.iid] || has(book, a, "Menace")) continue;
    const trade = free
      .filter((b) => !taken.has(b.iid) && canBlock(book, b, a) && exchange(book, a, b).kills)
      .filter((b) => value(book, a) > value(book, b))
      .sort((x, y) => value(book, x) - value(book, y))[0];
    if (trade) {
      blocks[a.iid] = [trade.iid];
      taken.add(trade.iid);
    }
  }
  return blocks;
}

/** Attackers that won't just die to a block: no untapped defender kills them
    and lives. Everything goes in when it's lethal. */
export function safeAttackers(g: PracticeGame, seat: Seat, book: CardBook): PlayCard[] {
  const def = other(seat);
  const able = g.sides[seat].battlefield.filter((c) => canAttack(g, seat, c, book) && stats(book, c).power > 0);
  const blockers = g.sides[def].battlefield.filter((c) => isCreature(book, c) && !c.tapped);
  const total = able.reduce((n, c) => n + stats(book, c).power, 0);
  if (total >= g.sides[def].life + blockers.reduce((n, b) => n + Math.max(0, stats(book, b).power), 0) && able.length > blockers.length) return able;
  return able.filter((a) => !blockers.some((b) => canBlock(book, b, a) && exchange(book, a, b).kills && !exchange(book, a, b).dies));
}

const blankAction = (kind: PlanAction["kind"], iid: number): PlanAction => ({
  kind,
  card: cardId(iid),
  x: null,
  tap_card: null,
  sacrifice_card: null,
  mana: null,
  life: null,
  effects: [],
});

/** The turn without the model: a land (the one that unlocks the most), then
    the biggest permanents it can pay for, then safe attacks. */
export function fallbackPlan(g: PracticeGame, book: CardBook, seat: Seat = "opp"): TurnPlan {
  const side = g.sides[seat];
  const main: PlanAction[] = [];
  const lands = side.hand.filter(isLand);
  if (!g.landPlayed && lands.length) {
    // Prefer a land of a colour the hand is missing.
    const missing = new Set(side.hand.filter((c) => !isLand(c)).flatMap((c) => parseCost(infoOf(book, c)?.manaCost ?? null).pips.flat()));
    const pickLand = lands.find((l) => (infoOf(book, l)?.producedMana ?? []).some((c) => missing.has(c))) ?? lands[0]!;
    main.push(blankAction("land", pickLand.iid));
  }
  // Spend the mana: permanents, biggest first, while it can still pay.
  // (Instants and sorceries need targets and judgement, so they wait.)
  let sim: PracticeGame = structuredClone(g);
  if (main.length) {
    const land = sim.sides[seat].hand.find((c) => cardId(c.iid) === main[0]!.card)!;
    sim.sides[seat] = { ...sim.sides[seat], hand: sim.sides[seat].hand.filter((c) => c !== land), battlefield: [...sim.sides[seat].battlefield, { ...land, enteredTurn: g.turn }] };
    sim.landPlayed = true;
  }
  const candidates = [
    ...sim.sides[seat].hand.map((c) => ({ c, zone: "hand" as const })),
    ...sim.sides[seat].command.map((c) => ({ c, zone: "command" as const })),
  ]
    .filter(({ c }) => !isLand(c) && !/\b(Instant|Sorcery)\b/.test((c.typeLine ?? "").split(" // ")[0]!))
    .sort((a, b) => value(book, b.c) - value(book, a.c));
  for (const { c, zone } of candidates) {
    if (!castable(sim, seat, c, book, zone)) continue;
    const cost = parseCost(infoOf(book, c)?.manaCost ?? null);
    if (zone === "command") cost.generic += 2 * sim.tax[seat];
    const paid = payCost(cost, manaSources(sim.sides[seat], book, sim.turn));
    if (!paid) continue;
    sim = structuredClone(sim);
    sim.sides[seat] = {
      ...sim.sides[seat],
      battlefield: sim.sides[seat].battlefield.map((x) => (paid.tap.includes(x.iid) ? { ...x, tapped: true } : x)),
    };
    main.push(blankAction("cast", c.iid));
  }
  return {
    main,
    attack: safeAttackers(g, seat, book).map((c) => cardId(c.iid)),
    after_combat: [],
    say: "",
  };
}

/** The AI keeps 2–5 lands in seven; otherwise it mulligans once and puts
    back what it has too much of. */
export function aiMulligan(side: PlaytestState, book: CardBook): PlaytestState {
  const lands = side.hand.filter((c) => isLandCard(c.typeLine)).length;
  if (lands >= 2 && lands <= 5) return side;
  let s = londonMulligan(side);
  const after = s.hand.filter((c) => isLandCard(c.typeLine)).length;
  const back = [...s.hand].sort((a, b) => {
    // Too few lands: bottom the priciest spell. Too many: bottom a land.
    if (after < 3) return (isLandCard(a.typeLine) ? 1 : 0) - (isLandCard(b.typeLine) ? 1 : 0) || value(book, b) - value(book, a);
    return (isLandCard(b.typeLine) ? 1 : 0) - (isLandCard(a.typeLine) ? 1 : 0);
  });
  for (const c of back.slice(0, s.toBottom)) s = bottomCard(s, c.iid);
  return s;
}
