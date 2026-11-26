// The parts of the AI opponent that are rules, not judgement, and so need
// no model: how it blocks, whether it mulligans, and the plan it falls back
// on when the model can't be reached. See docs/practice-vs-ai.md.

import { mulligan as londonMulligan, bottomCard, isLandCard, type PlayCard, type PlaytestState } from "../playtest";
import { BASIC_COLOR, burdenDrawOf, canPlayAsLand, counterOf, edictOf, entersTapped, fetchOf, handManaOf, has, infoOf, isCreature, isLand, manaOutput, ninjutsuOf, ownTurnOf, removalOf, sacManaOf, searchOnCast, stats, transmuteOf, wheelSpellOf, type Search } from "./cards";
import { aiEquipHost, aiRemovalAction, applyAction, availableMana, canAttack, canBlock, cardId, castable, colourNeeds, comboStatus, indestructible, lifeFor, spellCost, uncastable } from "./game";
import { comboOutcome, type DeckCombo } from "./combos";
import { equipOf, punishesIdleOf } from "./abilities";
import { manaSources, manaTotal, parseCost, payCost, totalOf } from "./mana";
import { treasureSpellOf } from "./treasure";
import { drawSpellOf, tutorOf, tutorSearch, wipeOf, type Tutor } from "./spells";
import { adNauseamOf, burnOf, devotion, impulseOf, emptyDrawWinsOf, extraTurnLosesOf, extraTurnOf, hasStorm, landsForManaOf, libraryExilerOf, oracleWinOf, ritualMana, ritualOf, sacrificeCostOf } from "./wincons";
import { triggersOf } from "./triggers";
import { lifeForCardsOf, searchAbility, type SearchAbility } from "./cards";
import { scaleDamage } from "./damage";
import { castTriggerOf } from "./cards";
import { other, type CardBook, type Effect, type PlanAction, type PracticeGame, type Seat, type TurnPlan } from "./types";

const value = (book: CardBook, c: PlayCard) => (c.token ? 1 : (infoOf(book, c)?.manaValue ?? 0));

/** Would this blocker kill the attacker? Survive it? The fight as combat
    plays it: a first-strike step, then the regular one (double strike hits
    in both), deathtouch kills with any damage, indestructible doesn't die,
    and a creature dead after the first step deals no regular damage. */
function exchange(book: CardBook, attacker: PlayCard, blocker: PlayCard) {
  const fighters = [attacker, blocker].map((c) => ({
    c,
    power: Math.max(0, stats(book, c).power),
    toughness: stats(book, c).toughness,
    damage: c.damage ?? 0,
    deathtouched: false,
    first: has(book, c, "First strike") || has(book, c, "Double strike"),
    regular: !has(book, c, "First strike") || has(book, c, "Double strike"),
    deathtouch: has(book, c, "Deathtouch"),
    indestructible: has(book, c, "Indestructible"),
  }));
  const dead = (f: (typeof fighters)[number]) => !f.indestructible && (f.damage >= f.toughness || f.deathtouched);
  const [a, b] = fighters as [(typeof fighters)[0], (typeof fighters)[0]];
  for (const step of ["first", "regular"] as const) {
    const aHits = !dead(a) && a[step] && a.power > 0;
    const bHits = !dead(b) && b[step] && b.power > 0;
    if (aHits) {
      b.damage += a.power;
      if (a.deathtouch) b.deathtouched = true;
    }
    if (bHits) {
      a.damage += b.power;
      if (b.deathtouch) a.deathtouched = true;
    }
  }
  return { kills: dead(a), dies: dead(b) };
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
  // Blocks that cost nothing: the blocker lives, and the damage doesn't
  // land. The biggest hitters first, behind the sturdiest it has. (A 0/5
  // wall watched attackers go past it turn after turn.)
  for (const a of attackers) {
    if (blocks[a.iid]) continue;
    const need = has(book, a, "Menace") ? 2 : 1;
    const walls = free
      .filter((b) => !taken.has(b.iid) && canBlock(book, b, a) && !exchange(book, a, b).dies)
      .sort((x, y) => stats(book, y).toughness - stats(book, x).toughness)
      .slice(0, need);
    if (walls.length === need) {
      blocks[a.iid] = walls.map((c) => c.iid);
      walls.forEach((c) => taken.add(c.iid));
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
/** The other side punishes creatures that don't attack (Kratos, God of
    War): then attacking is worth it for its own sake. */
export const idlePunished = (g: PracticeGame, seat: Seat, book: CardBook) => g.sides[other(seat)].battlefield.some((c) => punishesIdleOf(book, c));

export function safeAttackers(g: PracticeGame, seat: Seat, book: CardBook): PlayCard[] {
  const def = other(seat);
  const punished = idlePunished(g, seat, book);
  const able = g.sides[seat].battlefield.filter((c) => canAttack(g, seat, c, book) && (stats(book, c).power > 0 || punished));
  const blockers = g.sides[def].battlefield.filter((c) => isCreature(book, c) && !c.tapped);
  const total = able.reduce((n, c) => n + stats(book, c).power * (has(book, c, "Double strike") ? 2 : 1), 0);
  if (total >= g.sides[def].life + blockers.reduce((n, b) => n + Math.max(0, stats(book, b).power), 0) && able.length > blockers.length) return able;
  // (Menace takes two blockers: one creature across the table can't stop it.)
  return able.filter((a) => {
    const can = blockers.filter((b) => canBlock(book, b, a));
    if (has(book, a, "Menace") && can.length < 2) return true;
    return !can.some((b) => exchange(book, a, b).kills && !exchange(book, a, b).dies);
  });
}

const drawEffect = (amount: number): Effect => ({
  type: "draw",
  target: null,
  player: "ai",
  amount,
  name: null,
  power: null,
  toughness: null,
  keywords: [],
  to: null,
  tapped: null,
  text: null,
});

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

/** The colours a land gives: its own, or (a fetch) what it can find. */
function landColors(book: CardBook, land: PlayCard): string[] {
  const own = manaOutput(infoOf(book, land), land.typeLine)?.colors;
  if (own?.length) return own;
  const f = fetchOf(infoOf(book, land));
  if (!f) return [];
  return f.types.includes("land") ? ["W", "U", "B", "R", "G"] : f.types.flatMap((t) => (BASIC_COLOR[t] ? [BASIC_COLOR[t]!] : []));
}

/** A spell that only draws (and maybe costs life): safe to cast without
    judgement while the life is there (Night's Whisper, Opt, Read the Bones). */
function drawOnly(book: CardBook, c: PlayCard, life = Infinity): number {
  const d = drawSpellOf(infoOf(book, c));
  // The life it keeps is only a matter for a spell that costs life.
  return d && (!d.lose || life - d.lose >= 10) ? d.draw : 0;
}

const blank = (type: Effect["type"]): Effect => ({ ...drawEffect(0), type, player: null, amount: null });

/** What a tutor finds: the biggest card it can cast next turn (with one
    more land), or else the biggest. Lands only when it has none in hand and
    few out. */
function tutorPick(g: PracticeGame, seat: Seat, c: PlayCard, book: CardBook, combos: DeckCombo[] = [], opts: { tutor?: Tutor; onlyPieces?: boolean } = {}): Effect[] | null {
  const t = opts.tutor ?? tutorOf(infoOf(book, c));
  // It keeps 10 life from a tutor that costs life (Vampiric Tutor). One
  // that costs none is cast at any life: after Ad Nauseam, at 8, it used
  // to hold Demonic Tutor for turns.
  if (!t || (t.lose > 0 && g.sides[seat].life - t.lose < 10)) return null;
  // Lim-Dûl's Vault pays a life for every five cards it passes: not below 20.
  if (t.dig && g.sides[seat].life < 20) return null;
  const side = g.sides[seat];
  // Next turn's mana: what it has (tapped or not) and a land drop.
  const reach = manaTotal(availableMana(g, seat, book)) + side.battlefield.filter((x) => x.tapped).length + 1;
  const needLand = !side.hand.some(canPlayAsLand) && side.battlefield.filter(isLand).length < 4;
  // Demonic Counsel finds any card with four card types in the graveyard.
  const search = tutorSearch(t, side.graveyard);
  const fits = side.library.filter((x) => search.test(x.typeLine, infoOf(book, x)) && (needLand || !isLand(x)) && (infoOf(book, x)?.toughness !== 0 || !isCreature(book, x)));
  if (!fits.length) return null;
  const mv = (x: PlayCard) => infoOf(book, x)?.manaValue ?? 0;
  // The missing half of a win comes first: Thassa's Oracle when it holds
  // Demonic Consultation or Tainted Pact (or the other way round), and one
  // of them with Laboratory Maniac out. With neither half in hand but both
  // in the deck, the Oracle.
  const isOracle = (x: PlayCard) => oracleWinOf(book, x);
  const isExiler = (x: PlayCard) => !!libraryExilerOf(infoOf(book, x));
  const holdsOracle = side.hand.some(isOracle);
  const holdsExiler = side.hand.some(isExiler);
  const maniacOut = side.battlefield.some((x) => emptyDrawWinsOf(book, x));
  const combo = (x: PlayCard) =>
    (isExiler(x) && (holdsOracle || maniacOut) && !holdsExiler) || (isOracle(x) && holdsExiler && !holdsOracle)
      ? 100000
      : isOracle(x) && !holdsOracle && side.library.some(isExiler)
        ? 50000
        : 0;
  // A piece of one of the deck's combos that is still in the library: the
  // fewer pieces that combo lacks, the more it's worth finding.
  // Only the combos nearest to done count: with Demonic Consultation in
  // hand, Tainted Pact isn't a piece it lacks.
  const open = combos
    .filter((k) => comboOutcome(k.produces) !== "other")
    .map((k) => comboStatus(g, seat, k, book))
    .filter((st) => st.missing.length && st.missing.every((m) => m.where === "library"));
  const nearest = Math.min(...open.map((st) => st.missing.length));
  const lacking = new Map<string, number>();
  for (const st of open) if (st.missing.length === nearest) for (const m of st.missing) lacking.set(m.name.toLowerCase(), st.missing.length);
  const piece = (x: PlayCard) => {
    const n = lacking.get(x.name.toLowerCase()) ?? lacking.get(x.name.split(" // ")[0]!.toLowerCase());
    return n ? 80000 - n * 5000 : 0;
  };
  // When this tutor can't find the piece (Mystical Tutor and a creature):
  // a tutor that can, and failing that a draw engine.
  const lackingCards = side.library.filter((x) => piece(x) > 0);
  const bridge = (x: PlayCard) => {
    if (!lackingCards.length) return 0;
    const info = infoOf(book, x);
    const tu = tutorOf(info);
    if (tu && !tu.discardRandom && tu.search.to[0]!.zone === "hand" && lackingCards.some((y) => tutorSearch(tu, side.graveyard).test(y.typeLine, infoOf(book, y)))) return 60000;
    return adNauseamOf(info) || lifeForCardsOf(book, x) ? 40000 : 0;
  };
  // With the whole win in hand, what it lacks is mana: the tutor finds the
  // quickest fix, a cheap rock that makes its colours before a ritual. (It
  // went for a second combo's pieces, or cast the tutor for nothing.)
  const whole = holdsOracle && (holdsExiler || maniacOut);
  const fix = (x: PlayCard) => {
    if (!whole || isLand(x) || isCreature(book, x)) return 0;
    const info = infoOf(book, x);
    const made = manaOutput(info, x.typeLine);
    if (made && (info?.manaValue ?? 9) <= 2) return 200000 + (made.colors.includes("U") ? 2000 : 0) + (made.colors.includes("B") ? 1000 : 0) - (info?.manaValue ?? 0) * 300;
    const ritual = ritualMana(info, { graveyard: side.graveyard.length, ritesInGraveyards: 0, foeHand: g.sides[other(seat)].hand.length });
    return ritual && ritual.length > (info?.manaValue ?? 0) ? 150000 + ritual.length : 0;
  };
  const score = (x: PlayCard) => fix(x) + combo(x) + piece(x) + bridge(x) + (needLand && isLand(x) ? 10000 : 0) + (mv(x) <= reach ? 1000 : 0) + mv(x) * 10 + (isCreature(book, x) ? 1 : 0);
  const pick = fits.reduce((a, b) => (score(b) > score(a) ? b : a));
  // Nothing that helps the win it holds: the tutor waits.
  if (whole && !fix(pick)) return null;
  // Wishclaw Talisman goes to the player once used: only for a combo piece.
  if (opts.onlyPieces && !piece(pick) && combo(pick) < 100000) return null;
  const effects: Effect[] = [{ ...blank("search"), name: pick.name, to: search.to[0]!.zone === "top" ? "top" : "hand" }];
  if (t.lose) effects.push({ ...blank("life"), player: "ai", amount: -t.lose });
  return effects;
}

/** A board wipe, when it takes much more of the player's than of its own:
    at least two of their creatures (or their commander), and five more in
    power and mana value than it loses. Toxic Deluge's X is the least life
    that does it best, keeping ten. */
function wipePlan(g: PracticeGame, seat: Seat, c: PlayCard, book: CardBook): PlanAction | null {
  const w = wipeOf(infoOf(book, c));
  if (!w) return null;
  const foe = other(seat);
  const all = (["you", "opp"] as Seat[]).flatMap((s) => g.sides[s].battlefield.filter((x) => isCreature(book, x)).map((x) => ({ x, s })));
  if (!all.some(({ s }) => s === foe)) return null;
  const dies = (x: PlayCard, s: Seat, n: number) => {
    const t = stats(book, x).toughness - (w.kind === "damage" ? (x.damage ?? 0) : 0);
    if (w.kind === "shrink") return t <= n;
    if (indestructible(g, s, x, book)) return false;
    return w.kind === "destroy" || t <= n;
  };
  const worth = (x: PlayCard) => Math.max(0, stats(book, x).power) + value(book, x) + (x.commander ? 5 : 0);
  const net = (n: number) => {
    const gone = all.filter(({ x, s }) => dies(x, s, n));
    const theirs = gone.filter(({ s }) => s === foe);
    return { theirs, gain: theirs.reduce((t, { x }) => t + worth(x), 0) - gone.filter(({ s }) => s === seat).reduce((t, { x }) => t + worth(x), 0) };
  };
  let n = w.amount ?? 0;
  if (w.amount === null) {
    // Toxic Deluge: try each X the life allows.
    let best = { n: 0, gain: -Infinity };
    for (let x = 1; x <= Math.min(13, g.sides[seat].life - 10); x++) {
      const r = net(x);
      if (r.gain > best.gain) best = { n: x, gain: r.gain };
    }
    if (!best.n) return null;
    n = best.n;
  }
  const r = net(n);
  if (r.gain < 5 || !(r.theirs.length >= 2 || r.theirs.some(({ x }) => x.commander))) return null;
  const effects: Effect[] = all.map(({ x }) =>
    w.kind === "destroy" ? { ...blank("destroy"), target: cardId(x.iid) } : w.kind === "damage" ? { ...blank("damage"), target: cardId(x.iid), amount: n } : { ...blank("pump"), target: cardId(x.iid), power: -n, toughness: -n }
  );
  if (w.amount === null) effects.unshift({ ...blank("life"), player: "ai", amount: -n });
  return { ...blankAction("cast", c.iid), x: w.amount === null ? n : null, effects };
}

/** A plan (the model's) with the casts that would throw a combo away
    taken out: Thassa's Oracle or Underworld Breach cast on a turn the
    plan doesn't go off, and an extra turn that costs the game (Final
    Fortune). A plan that declares a combo, or empties its library, is
    left as it is. */
export function guardPlan(g: PracticeGame, plan0: TurnPlan, book: CardBook, seat: Seat = "opp"): TurnPlan {
  // An attacker with no power stays home, where it can block. Unless the
  // attack is the point: the other side punishes creatures that don't
  // attack (Kratos: that was why Rograkh swung every turn), a trigger on
  // attacking, or a Ninja to bring in behind it.
  const side = g.sides[seat];
  const attackIsThePoint = (c: PlayCard) =>
    idlePunished(g, seat, book) ||
    /\battacks?\b/i.test(infoOf(book, c)?.oracleText ?? "") ||
    side.battlefield.some((x) => x.iid !== c.iid && /\bwhenever [^.]*\bcreatures? you control attacks?\b/i.test(infoOf(book, x)?.oracleText ?? "")) ||
    [...side.hand, ...side.command].some((x) => !!ninjutsuOf(book, x));
  const attack = plan0.attack.filter((id) => {
    const c = side.battlefield.find((x) => cardId(x.iid) === id);
    return !c || stats(book, c).power > 0 || attackIsThePoint(c);
  });
  const plan = attack.length === plan0.attack.length ? plan0 : { ...plan0, attack };
  const own = [...g.sides[seat].hand, ...g.sides[seat].command];
  const cardOf = (a: PlanAction) => own.find((c) => cardId(c.iid) === a.card);
  const all = [...plan.main, ...plan.after_combat];
  // Going off: a combo, or Demonic Consultation / Tainted Pact with the
  // card that wins from an empty library. (Either of them alone is a tutor.)
  const winsEmpty = [...side.hand, ...side.battlefield].some((c) => oracleWinOf(book, c)) || side.battlefield.some((c) => emptyDrawWinsOf(book, c));
  const goes = all.some((a) => {
    const c = a.kind === "cast" ? cardOf(a) : undefined;
    return a.kind === "combo" || (!!c && !!libraryExilerOf(infoOf(book, c)) && winsEmpty);
  });
  if (goes) return plan;
  const wasted = (a: PlanAction) => {
    if (a.kind !== "cast") return false;
    const c = cardOf(a);
    if (!c) return false;
    return oracleWinOf(book, c)
      ? devotion(g, seat, "U", book) + 2 < g.sides[seat].library.length
      : !!triggersOf(book, c).endSacrifice || extraTurnLosesOf(infoOf(book, c)) || !!landsForManaOf(infoOf(book, c));
  };
  if (!all.some(wasted)) return plan;
  return { ...plan, main: plan.main.filter((a) => !wasted(a)), after_combat: plan.after_combat.filter((a) => !wasted(a)) };
}

/** An activated tutor's use (Wishclaw Talisman), as a plan action. */
function abilityTutor(c: PlayCard, ab: SearchAbility, effects: Effect[]): PlanAction {
  return { ...blankAction("activate", c.iid), tap_card: true, sacrifice_card: ab.sacrifice || null, mana: ab.mana, life: ab.life || null, effects };
}

/** A card the planner keeps in hand for its combo: a piece the combo wants
    in the hand or the graveyard (Thassa's Oracle, Brain Freeze), or one
    that only lasts the turn it's cast (Underworld Breach). Cast alone, it's
    wasted. */
function heldForCombo(book: CardBook, c: PlayCard, combos: DeckCombo[]): boolean {
  if (triggersOf(book, c).endSacrifice) return true;
  const name = c.name.toLowerCase();
  const front = c.name.split(" // ")[0]!.toLowerCase();
  return combos.some((k) => {
    const o = comboOutcome(k.produces);
    return (o === "win" || o === "mill") && k.pieces.some((p) => (p.name.toLowerCase() === name || p.name.toLowerCase() === front) && !p.zones.includes("B"));
  });
}

/** One of the deck's combos, finished this turn, as the actions that do
    it; null when none can be. Tried on a copy of the table with the real
    moves, the nearest combo first: the pieces it holds are cast, a tutor
    in hand finds the piece still in the library, and when the mana is
    short it's made: free rocks, rituals (a creature sacrificed for the
    ones that ask), a creature fed to Phyrexian Tower. Nothing is cast
    unless the whole line gets there. */
function goOff(g: PracticeGame, book: CardBook, seat: Seat, combos: DeckCombo[], land: PlanAction | null): { actions: PlanAction[]; attack: string[]; wins: boolean } | null {
  const lines = combos.filter((c) => comboOutcome(c.produces) !== "other");
  if (!lines.length || g.choice) return null;
  // The table once the land is down (a fetch land has fetched).
  let start = g;
  if (land) {
    const r = applyAction(g, seat, land, book, { combos });
    if (!r.ok || r.game.choice) return null;
    start = r.game;
  }
  const far = (c: DeckCombo) => {
    const st = comboStatus(start, seat, c, book);
    return st.missing.length * 10 + st.toCast.length + (st.needs ? 50 : 0);
  };
  for (const c of [...lines].sort((a, b) => far(a) - far(b))) {
    // Milling a library that's already empty does nothing more.
    if (comboOutcome(c.produces) === "mill" && !start.sides[other(seat)].library.length) continue;
    const line = comboLine(start, book, seat, c, combos);
    if (!line) continue;
    const outcome = comboOutcome(c.produces);
    // A win, or the player's library gone: the turn is this and nothing
    // else. Endless mana with a way to spend it for ever is a win too.
    if (outcome !== "mana" || line.after.winner === seat) return { actions: line.actions, attack: [], wins: true };
    // Endless mana: the rest of the turn is planned with it in the pool.
    const out: { wins?: boolean } = {};
    const rest = fallbackPlan(line.after, book, seat, out, combos.filter((x) => x.id !== c.id));
    return { actions: [...line.actions, ...rest.main], attack: rest.attack, wins: !!out.wins };
  }
  return null;
}

function comboLine(g0: PracticeGame, book: CardBook, seat: Seat, combo: DeckCombo, combos: DeckCombo[]): { actions: PlanAction[]; after: PracticeGame } | null {
  let t = g0;
  const actions: PlanAction[] = [];
  const step = (a: PlanAction) => {
    const r = applyAction(t, seat, a, book, { combos });
    if (!r.ok || r.game.choice || r.game.winner === other(seat)) return false;
    t = r.game;
    actions.push(a);
    return true;
  };
  const costOf = (c: PlayCard, zone: "hand" | "command") => totalOf(spellCost(t, seat, c, book, zone));
  const zoneOf = (c: PlayCard) => (t.sides[seat].command.some((x) => x.iid === c.iid) ? ("command" as const) : ("hand" as const));
  const isPiece = (c: PlayCard) => combo.pieces.some((p) => p.name.toLowerCase() === c.name.toLowerCase() || p.name.toLowerCase() === c.name.split(" // ")[0]!.toLowerCase());
  /** A tutor in hand that puts this card in the hand, as its cast. (Not
      Gamble: its random discard could throw the piece away.) */
  const tutorFor = (name: string): PlanAction | null => {
    const want = t.sides[seat].library.find((x) => x.name.toLowerCase() === name.toLowerCase() || x.name.split(" // ")[0]!.toLowerCase() === name.toLowerCase());
    if (!want) return null;
    for (const c of t.sides[seat].hand) {
      const tu = isPiece(c) ? null : tutorOf(infoOf(book, c));
      const search = tu ? tutorSearch(tu, t.sides[seat].graveyard) : null;
      if (!tu || !search || tu.discardRandom || search.to[0]!.zone !== "hand" || !search.test(want.typeLine, infoOf(book, want))) continue;
      if (tu.lose > 0 && t.sides[seat].life - tu.lose < 1) continue;
      const effects: Effect[] = [{ ...blank("search"), name: want.name, to: "hand" }];
      if (tu.lose) effects.push({ ...blank("life"), player: "ai", amount: -tu.lose });
      return { ...blankAction("cast", c.iid), effects };
    }
    // An activated one on the battlefield (Wishclaw Talisman).
    for (const c of t.sides[seat].battlefield) {
      const ab = isLand(c) || c.tapped ? null : searchAbility(infoOf(book, c));
      if (!ab || !ab.tap || ab.to[0]!.zone !== "hand" || !ab.test(want.typeLine, infoOf(book, want))) continue;
      return abilityTutor(c, ab, [{ ...blank("search"), name: want.name, to: "hand" }]);
    }
    return null;
  };
  /** One more source of mana, played: true when something was. */
  const makeMana = (): boolean => {
    const side = t.sides[seat];
    const spare = side.hand.filter((c) => !isLand(c) && !isPiece(c));
    // A rock that costs less than it gives (Lotus Petal, a Mox, Sol Ring, Mana Vault).
    for (const c of spare) {
      const made = manaOutput(infoOf(book, c), c.typeLine);
      if (!made || isCreature(book, c) || made.amount <= costOf(c, "hand")) continue;
      const before = manaTotal(availableMana(t, seat, book));
      const saved = { t, n: actions.length };
      if (step(blankAction("cast", c.iid))) {
        if (manaTotal(availableMana(t, seat, book)) > before) return true;
        // It gave nothing (a Mox with no way to turn it on): take it back.
        t = saved.t;
        actions.length = saved.n;
      }
    }
    const fodder = side.battlefield.some((c) => isCreature(book, c));
    const wantsFodder = spare.some((c) => sacrificeCostOf(infoOf(book, c)) === "creature" && ritualNow(c)) || side.battlefield.some((c) => !c.tapped && sacManaOf(infoOf(book, c)));
    // A creature that costs nothing (Rograkh), to be sacrificed for mana.
    if (wantsFodder && !fodder) {
      const free = [...side.command, ...side.hand].find((c) => isCreature(book, c) && !isPiece(c) && costOf(c, zoneOf(c)) === 0);
      if (free && step(blankAction("cast", free.iid))) return true;
    }
    // A ritual that gives more than it costs.
    const rituals = spare
      .map((c) => ({ c, net: (ritualNow(c)?.length ?? 0) - costOf(c, "hand") }))
      .filter((r) => r.net > 0)
      .sort((a, b) => b.net - a.net);
    for (const r of rituals) if (step(blankAction("cast", r.c.iid))) return true;
    // A creature fed to Phyrexian Tower.
    for (const c of side.battlefield) {
      if (c.tapped || !sacManaOf(infoOf(book, c)) || !t.sides[seat].battlefield.some((x) => isCreature(book, x) && !isPiece(x))) continue;
      if (step(blankAction("activate", c.iid))) return true;
    }
    // Last, Rain of Filth: every land for one more mana. All in, so only
    // here, where the line is thrown away unless it wins.
    for (const c of spare) {
      if (landsForManaOf(infoOf(book, c)) && side.battlefield.some(isLand) && step(blankAction("cast", c.iid))) return true;
    }
    return false;
  };
  const ritualNow = (c: PlayCard) =>
    ritualMana(infoOf(book, c), {
      graveyard: t.sides[seat].graveyard.length,
      ritesInGraveyards: [...t.sides.you.graveyard, ...t.sides.opp.graveyard].filter((x) => x.name === c.name).length,
      foeHand: t.sides[other(seat)].hand.length,
    });
  for (let n = 0; n < 24; n++) {
    const st = comboStatus(t, seat, combo, book);
    if (st.ready) {
      const go: PlanAction = { ...blankAction("cast", 0), kind: "combo", card: combo.id };
      const r = applyAction(t, seat, go, book, { combos });
      if (!r.ok) return null;
      return { actions: [...actions, go], after: r.game };
    }
    // What a turn can't mend: a piece that's gone, a graveyard too thin.
    if (st.needs || st.missing.some((m) => m.where !== "library")) return null;
    const finds = st.missing.map((m) => tutorFor(m.name));
    if (finds.some((f) => !f) && st.missing.length > t.sides[seat].hand.filter((c) => tutorOf(infoOf(book, c))).length) return null;
    const find = finds.find((f): f is PlanAction => !!f);
    if (st.missing.length && !find) return null;
    // The mana the rest of the line asks for: the tutors, the pieces to
    // cast, the combo's own. Short of it, the rituals and rocks come first:
    // what they add pays for the tutor, and the lands keep their colours
    // for the pieces.
    const handCard = (a: PlanAction) => t.sides[seat].hand.find((c) => cardId(c.iid) === a.card);
    const ahead =
      totalOf(parseCost(combo.manaNeeded)) +
      st.toCast.reduce((n, c) => n + costOf(c, zoneOf(c)), 0) +
      finds.reduce((n, f) => n + (f && handCard(f) ? costOf(handCard(f)!, "hand") : 0), 0) +
      // A piece still in the library that has to be cast once found.
      st.missing.reduce((n, m) => n + (combo.pieces.find((p) => p.name === m.name)?.zones.includes("B") ? (book[m.name.toLowerCase()]?.manaValue ?? 0) : 0), 0);
    if (ahead > manaTotal(availableMana(t, seat, book)) && makeMana()) continue;
    // A tutor for a piece still in the library.
    if (find && step(find)) continue;
    // A piece that has to be out (or in the graveyard), cheapest first.
    const piece = [...st.toCast].sort((a, b) => costOf(a, zoneOf(a)) - costOf(b, zoneOf(b))).find((c) => step(blankAction("cast", c.iid)));
    if (piece) continue;
    // Short of mana: make some.
    if (makeMana()) continue;
    return null;
  }
  return null;
}

/** The planner's turn when it wins the game outright (Thassa's Oracle
    with an empty library, a lethal storm or burn turn), checked by
    playing it out; null otherwise. A model game uses it too: a win the
    table can see isn't left to the model to find. */
export function winningTurn(g: PracticeGame, book: CardBook, seat: Seat = "opp", combos: DeckCombo[] = []): TurnPlan | null {
  if (g.winner || g.choice || g.combat || g.active !== seat) return null;
  const out: { wins?: boolean } = {};
  const plan = fallbackPlan(g, book, seat, out, combos);
  if (!out.wins) return null;
  let after = g;
  for (const a of plan.main) after = applyAction(after, seat, a, book, { combos }).game;
  // Won, or the player's library is gone (they lose as they draw).
  return after.winner === seat || !after.sides[other(seat)].library.length ? plan : null;
}

/** What a smart opponent's turn brought it after its plan was made: a
    tutor's find, a draw spell's cards, Jeska's Will's three. The model
    couldn't name a card it didn't hold, so its plan stops there (it found
    Necropotence, made {B}{B}{B} with Cabal Ritual, and passed with both).
    This is the built-in planner's turn from here, cut down to those new
    cards and the mana that pays for them: the cards the model chose to hold
    stay held. `held` is the hand as the model saw it. Null: nothing new
    to play. */
export function arrivalsPlan(g: PracticeGame, book: CardBook, held: Set<number>, seat: Seat = "opp", combos: DeckCombo[] = []): TurnPlan | null {
  if (g.winner || g.choice || g.combat || g.active !== seat) return null;
  const fresh = g.sides[seat].hand.filter((c) => !held.has(c.iid));
  if (!fresh.length) return null;
  const isFresh = (a: PlanAction) => fresh.some((c) => cardId(c.iid) === a.card);
  // Mana for them: an ability, a ritual, a rock that pays for itself.
  const makesMana = (a: PlanAction) => {
    if (a.kind === "activate") return true;
    if (a.kind !== "cast") return false;
    const c = g.sides[seat].hand.find((x) => cardId(x.iid) === a.card);
    const info = c ? infoOf(book, c) : undefined;
    if (!c || !info) return false;
    return !!ritualMana(info, { graveyard: 0, ritesInGraveyards: 0, foeHand: 1 }) || (manaOutput(info, c.typeLine)?.amount ?? 0) >= (info.manaValue ?? 0);
  };
  const plan = fallbackPlan(g, book, seat, {}, combos);
  const last = plan.main.findLastIndex((a) => (a.kind === "cast" || a.kind === "land" || a.kind === "combo") && (a.kind === "combo" || isFresh(a)));
  if (last < 0) return null;
  const main = plan.main.slice(0, last + 1).filter((a) => a.kind === "combo" || isFresh(a) || makesMana(a));
  return main.some((a) => a.kind === "combo" || isFresh(a)) ? { ...plan, main } : null;
}

/** What a smart opponent's leftover mana pays for, after its plan: the
    creatures and other permanents of the built-in planner's turn. The model
    leaves mana on the table (nine mana, one spell, and a two-mana creature
    still in hand), and nothing at this table is cast later at instant speed
    but a counterspell or a removal spell: so their mana is kept back, and
    the rest is spent. Null: nothing to add. */
export function spareManaPlan(g: PracticeGame, book: CardBook, seat: Seat = "opp", combos: DeckCombo[] = []): TurnPlan | null {
  if (g.winner || g.choice || g.combat || g.active !== seat) return null;
  const side = g.sides[seat];
  // The dearest answer it holds that costs mana: that much stays untapped.
  const answers = side.hand.filter((c) => !!counterOf(infoOf(book, c)) || !!removalOf(infoOf(book, c)));
  const reserve = answers.reduce((n, c) => Math.max(n, totalOf(spellCost(g, seat, c, book, "hand"))), 0);
  const plan = fallbackPlan(g, book, seat, {}, combos);
  let sim = g;
  const main: PlanAction[] = [];
  for (const a of plan.main) {
    // A land drop it didn't make is made.
    if (a.kind === "land" && !sim.landPlayed) {
      const r = applyAction(sim, seat, a, book, { combos });
      if (r.ok) {
        sim = r.game;
        main.push(a);
      }
      continue;
    }
    if (a.kind !== "cast") continue;
    const c = [...side.hand, ...side.command].find((x) => cardId(x.iid) === a.card);
    // Permanents only, and not a commander: recasting one is the model's call.
    if (!c || c.commander || isLand(c) || /\b(Instant|Sorcery)\b/.test((infoOf(book, c)?.typeLine ?? c.typeLine ?? "").split(" // ")[0]!)) continue;
    // A creature that arrives can't attack this turn: into Kratos, it costs life.
    if (isCreature(book, c) && idlePunished(g, seat, book)) continue;
    const r = applyAction(sim, seat, a, book, { combos });
    if (!r.ok || manaTotal(availableMana(r.game, seat, book)) < reserve) continue;
    sim = r.game;
    main.push(a);
  }
  return main.length ? { ...plan, main } : null;
}

/** A wheel is worth casting when it gives this seat more cards than it
    throws away: the hand (less the wheel) is two cards or fewer. */
function wheelWorth(g: PracticeGame, seat: Seat, c: PlayCard, book: CardBook): boolean {
  const w = wheelSpellOf(book, c);
  if (!w) return false;
  // What it would lose: the cards it means to play. Counterspells and
  // answers it holds for the player's turn don't count against a wheel.
  const hand = g.sides[seat].hand.filter((x) => x.iid !== c.iid);
  // Never both halves of a win (Thassa's Oracle with Consultation or Pact):
  // that hand is one land from winning.
  if (hand.some((x) => oracleWinOf(book, x)) && hand.some((x) => libraryExilerOf(infoOf(book, x)))) return false;
  const left = hand.filter((x) => liveInHand(book, x)).length;
  return left <= 2 && g.sides[seat].library.length > 10;
}

/** Jeska's Will is worth casting by itself with a commander out (both
    modes) and a few cards in the player's hand: mana, and three cards to
    spend it on. */
function impulseWorth(g: PracticeGame, seat: Seat, c: PlayCard, book: CardBook): boolean {
  return impulseOf(infoOf(book, c)) > 0 && g.sides[seat].battlefield.some((x) => x.commander) && g.sides[other(seat)].hand.length >= 3;
}

/** A card the planner would play on its own turn: a land, a permanent, or
    a spell it knows how to use (a tutor, a draw spell, a ritual, a way to
    win). The rest (counterspells, answers) wait for the player. */
function liveInHand(book: CardBook, c: PlayCard): boolean {
  const info = infoOf(book, c);
  if (isLand(c) || !/\b(Instant|Sorcery)\b/.test((info?.typeLine ?? c.typeLine ?? "").split(" // ")[0]!)) return true;
  return !!tutorOf(info) || !!drawSpellOf(info) || adNauseamOf(info) || !!libraryExilerOf(info) || !!ritualMana(info, { graveyard: 0, ritesInGraveyards: 0, foeHand: 1 });
}

/** The turn without the model: a land (the one that unlocks the most), then
    the biggest permanents it can pay for, then spells that only draw, then
    safe attacks. */
export function fallbackPlan(g: PracticeGame, book: CardBook, seat: Seat = "opp", out: { wins?: boolean } = {}, combos: DeckCombo[] = []): TurnPlan {
  const side = g.sides[seat];
  const main: PlanAction[] = [];
  const lands = side.hand.filter(canPlayAsLand);
  if (!g.landPlayed && lands.length) {
    // Prefer the land that makes what the hand (or the commander) is
    // shortest of, then one that enters untapped.
    const short = colourNeeds(g, seat, book);
    // A modal card with a land back is a spell first: a real land goes before it.
    const score = (l: PlayCard) =>
      landColors(book, l).reduce((n, c) => n + (short[c] ?? 0), 0) * 10 + (entersTapped(infoOf(book, l), ownTurnOf(g.turn)) ? 0 : 5) + landColors(book, l).length - (isLand(l) ? 0 : 8);
    const pickLand = lands.reduce((a, b) => (score(b) > score(a) ? b : a));
    // (Holding a land back to keep City of Traitors was tried, and measured
    // slower over 200 games a list: the land goes down, and the table taps
    // the City for its mana first.)
    main.push(blankAction("land", pickLand.iid));
  }
  // Spend the mana: permanents, biggest first, while it can still pay.
  // (Instants and sorceries need targets and judgement, so they wait.)
  let sim: PracticeGame = structuredClone(g);
  if (main.length) {
    const land = sim.sides[seat].hand.find((c) => cardId(c.iid) === main[0]!.card)!;
    // A land that enters tapped (a Triome) gives nothing this turn. (A fetch
    // land or a shock land is played out by the engine below.)
    const tapped = entersTapped(infoOf(book, land), ownTurnOf(g.turn)) && !fetchOf(infoOf(book, land));
    sim.sides[seat] = { ...sim.sides[seat], hand: sim.sides[seat].hand.filter((c) => c !== land), battlefield: [...sim.sides[seat].battlefield, { ...land, enteredTurn: g.turn, tapped }] };
    sim.landPlayed = true;
  }
  // Pay from the simulated table: tap what's used, and pay the life.
  const payIn = (cost: ReturnType<typeof parseCost>) => {
    const sources = availableMana(sim, seat, book);
    const paid = payCost(cost, sources, { lifeFor: lifeFor(sim, seat, book) });
    // The life it costs: K'rrik's, and what a land like Ancient Tomb deals.
    if (!paid) return false;
    const life = paid.life + paid.pain;
    if (life && sim.sides[seat].life - life < 10) return false;
    const once = paid.tap.filter((t) => sources.find((x) => x.iid === t)?.once);
    const tapped = new Set(paid.tap.flatMap((t) => [t, ...(sources.find((x) => x.iid === t)?.also ?? [])]).filter((t) => !once.includes(t)));
    sim = structuredClone(sim);
    sim.once = [...(sim.once ?? []), ...once];
    // Floating mana used (a ritual's) is gone.
    const usedPool = new Set(paid.tap.filter((t) => t < 0).map((t) => -t - 1));
    if (usedPool.size && sim.pool) sim.pool[seat] = sim.pool[seat].filter((_, i) => !usedPool.has(i));
    // A Spirit Guide exiled for its mana is gone from the hand.
    const exiled = new Set(paid.tap.filter((t) => sources.find((x) => x.iid === t)?.exile));
    sim.sides[seat] = {
      ...sim.sides[seat],
      life: sim.sides[seat].life - life,
      hand: sim.sides[seat].hand.filter((x) => !exiled.has(x.iid)),
      battlefield: sim.sides[seat].battlefield.map((x) => (tapped.has(x.iid) ? { ...x, tapped: true } : x)),
    };
    // What a source made and this payment didn't use floats, as at the table.
    for (const t of paid.tap) {
      const src = sources.find((x) => x.iid === t);
      const left = src && t >= 0 && !src.exile ? src.amount - (paid.used[t] ?? 0) : 0;
      if (!src || left <= 0) continue;
      if (!sim.pool) sim.pool = { you: [], opp: [] };
      sim.pool[seat] = [...sim.pool[seat], ...Array.from({ length: left }, () => src.colors.join(""))];
    }
    return true;
  };
  // A combo it can finish this turn: the pieces it holds are cast, a tutor
  // finds the one it lacks, rituals and sacrifices make the mana. A win,
  // or milling the player out, comes before anything else; endless mana is
  // taken and then spent.
  const combo = goOff(g, book, seat, combos, main[0] ?? null);
  if (combo) {
    out.wins = combo.wins;
    return { main: [...main, ...combo.actions], attack: combo.attack, after_combat: [], say: "" };
  }
  // A way to win now comes before anything else. It is played out on a
  // copy of the real table first: the planner's own count of its mana can
  // be off (City of Traitors goes when the land is played), and a
  // Consultation with no Oracle after it loses the game.
  const beforeWin = sim;
  const win = winLine();
  if (win) {
    let t = g;
    let ok = true;
    for (const a of [...main, ...win]) {
      const r = applyAction(t, seat, a, book, { combos });
      if (!r.ok) {
        ok = false;
        break;
      }
      t = r.game;
    }
    if (ok && t.winner === seat) {
      out.wins = true;
      return { main: [...main, ...win], attack: [], after_combat: [], say: "" };
    }
    sim = beforeWin;
  }
  function winLine(): PlanAction[] | null {
    const hand = sim.sides[seat].hand;
    const can = (c: PlayCard) => castable(sim, seat, c, book, "hand");
    const tryPay = (cards: PlayCard[]) => {
      const before = sim;
      for (const c of cards) {
        if (!can(c) || !payIn(spellCost(sim, seat, c, book, "hand"))) {
          sim = before;
          return false;
        }
      }
      return true;
    };
    const oracle = hand.find((c) => oracleWinOf(book, c));
    const exiler = hand.find((c) => libraryExilerOf(infoOf(book, c)));
    // Thassa's Oracle alone, when devotion (with its own {U}{U}) covers the library.
    if (oracle && devotion(sim, seat, "U", book) + 2 >= sim.sides[seat].library.length && tryPay([oracle])) return [blankAction("cast", oracle.iid)];
    // Demonic Consultation or Tainted Pact, then the Oracle.
    if (oracle && exiler && tryPay([exiler, oracle])) return [blankAction("cast", exiler.iid), blankAction("cast", oracle.iid)];
    // Laboratory Maniac or Jace out: empty the library, then draw.
    const maniac = sim.sides[seat].battlefield.some((c) => emptyDrawWinsOf(book, c));
    const drawer = hand.find((c) => drawOnly(book, c, sim.sides[seat].life) > 0);
    if (maniac && exiler && drawer && tryPay([exiler, drawer])) return [blankAction("cast", exiler.iid), { ...blankAction("cast", drawer.iid), effects: [drawEffect(1)] }];
    return allIn();
  }
  /** A storm or burn turn: every spell it can cast, rituals first, when
      the damage they deal (Vivi's ping for each noncreature spell, burn at
      the player's face, through Torbran and Fiery Emancipation) is lethal. */
  function allIn(): PlanAction[] | null {
    const foe = other(seat);
    const pingers = sim.sides[seat].battlefield.flatMap((c) => {
      const t = castTriggerOf(book, c);
      return t && (t.damage || t.drain) ? [{ c, t }] : [];
    });
    const spells = sim.sides[seat].hand.filter((c) => !isLand(c) && !isCreature(book, c));
    if (!spells.length) return null;
    // Spells cast so far this turn, by anyone: a storm spell's copies.
    const before = (g.spells?.you ?? 0) + (g.spells?.opp ?? 0);
    const hurts = (c: PlayCard, cast = 0) => {
      const info = infoOf(book, c);
      const seen = { typeLine: info?.typeLine ?? c.typeLine ?? "", manaCost: info?.manaCost ?? "" };
      const pings = pingers.filter(({ t }) => t.hits(seen)).reduce((n, { c: p, t }) => n + scaleDamage(sim, book, seat, p, foe, t.damage) + t.drain, 0);
      return pings + scaleDamage(sim, book, seat, c, foe, burnOf(info)) * (hasStorm(info) ? before + cast + 1 : 1);
    };
    if (!spells.some((c) => hurts(c) > 0)) return null;
    const saved = sim;
    const plan: PlanAction[] = [];
    let total = 0;
    const left = [...spells];
    for (;;) {
      const net = (c: PlayCard) => (ritualOf(infoOf(book, c))?.length ?? 0) - totalOf(spellCost(sim, seat, c, book, "hand"));
      // A ritual that makes more than it costs first, then the cheapest.
      const order = left
        .filter((c) => castable(sim, seat, c, book, "hand"))
        // A storm spell goes last, with the most spells before it.
        .sort(
          (a, b) =>
            Number(hasStorm(infoOf(book, a))) - Number(hasStorm(infoOf(book, b))) ||
            Number(net(b) > 0) - Number(net(a) > 0) ||
            totalOf(spellCost(sim, seat, a, book, "hand")) - totalOf(spellCost(sim, seat, b, book, "hand"))
        );
      const next = order.find((c) => payIn(spellCost(sim, seat, c, book, "hand")));
      if (!next) break;
      left.splice(left.indexOf(next), 1);
      const info = infoOf(book, next);
      const units = ritualOf(info);
      const effects: Effect[] = [];
      if (units) {
        sim = structuredClone(sim);
        if (!sim.pool) sim.pool = { you: [], opp: [] };
        sim.pool[seat] = [...sim.pool[seat], ...units];
        effects.push({ ...blank("mana"), text: units.map((u) => `{${u}}`).join("") });
      }
      const burn = burnOf(info);
      if (burn) effects.push({ ...blank("damage"), target: seat === "opp" ? "player" : "ai", amount: burn });
      const draws = drawOnly(book, next);
      if (draws) effects.push(drawEffect(draws));
      total += hurts(next, plan.length);
      plan.push({ ...blankAction("cast", next.iid), effects });
    }
    if (total >= sim.sides[foe].life) return plan;
    sim = saved;
    return null;
  }
  // An "each opponent sacrifices" ability (Kefka's {8}) comes first: it
  // takes a permanent and transforms Kefka.
  for (const c of sim.sides[seat].battlefield) {
    const e = edictOf(book, c);
    if (!e || c.flipped || !g.sides[other(seat)].battlefield.length) continue;
    if (payIn(parseCost(e.mana))) main.push({ ...blankAction("activate", c.iid), mana: e.mana });
  }
  // A ramp spell (Cultivate, Rampant Growth, Farseek, Nature's Lore): the
  // lands it finds, each where the card puts it. Before the creatures, so
  // the mana is there next turn.
  const taken = new Set<number>();
  for (const c of sim.sides[seat].hand) {
    const finds = landSearch(sim, seat, c, book, taken);
    if (!finds || !castable(sim, seat, c, book, "hand")) continue;
    if (!payIn(spellCost(sim, seat, c, book, "hand"))) continue;
    main.push({ ...blankAction("cast", c.iid), effects: finds });
  }
  // A board wipe, when the player's board is much the bigger.
  let wiped = false;
  for (const c of sim.sides[seat].hand) {
    const wipe = wipePlan(sim, seat, c, book);
    if (!wipe || !castable(sim, seat, c, book, "hand") || !payIn(spellCost(sim, seat, c, book, "hand"))) continue;
    main.push(wipe);
    wiped = true;
    break;
  }
  // A sorcery that removes a creature (Feed the Swarm), at the player's
  // biggest threat. Its instants are kept for the player's turn.
  if (seat === "opp" && !wiped) {
    const kill = aiRemovalAction(sim, book, sim.sides.you.battlefield.map((c) => c.iid), "main");
    const card = kill ? sim.sides.opp.hand.find((c) => cardId(c.iid) === kill.card) : undefined;
    if (kill && card && payIn(spellCost(sim, "opp", card, book, "hand"))) main.push(kill);
  }
  const cast = new Set(main.map((a) => a.card));
  // The combos that end the game: what the deck is built to do.
  const ending = combos.filter((c) => comboOutcome(c.produces) === "win" || comboOutcome(c.produces) === "mill");
  const candidates = [
    ...sim.sides[seat].hand.filter((c) => !cast.has(cardId(c.iid))).map((c) => ({ c, zone: "hand" as const })),
    ...sim.sides[seat].command.map((c) => ({ c, zone: "command" as const })),
  ]
    .filter(
      ({ c }) =>
        !isLand(c) &&
        (!/\b(Instant|Sorcery)\b/.test((c.typeLine ?? "").split(" // ")[0]!) ||
          drawOnly(book, c, sim.sides[seat].life) > 0 ||
          !!tutorOf(infoOf(book, c)) ||
          extraTurnOf(infoOf(book, c)) ||
          // Jeska's Will with a commander out: the mana and three cards.
          impulseWorth(sim, seat, c, book) ||
          // Ad Nauseam, with the life to turn into cards.
          (adNauseamOf(infoOf(book, c)) && sim.sides[seat].life >= 20) ||
          wheelWorth(sim, seat, c, book) ||
          !!treasureSpellOf(book, c))
    )
    // Thassa's Oracle is kept for the win; Consultation and Pact too.
    .filter(({ c }) => !oracleWinOf(book, c) && !libraryExilerOf(infoOf(book, c)))
    // So is a piece of a combo that isn't worth anything alone (a spell,
    // a card that only lasts the turn), a card that costs the game (Final
    // Fortune), and a Spirit Guide, which is mana.
    .filter(({ c }) => !heldForCombo(book, c, combos) && !extraTurnLosesOf(infoOf(book, c)) && !handManaOf(infoOf(book, c)))
    // A 0/0 creature needs a choice the planner doesn't make: X counters
    // (Walking Ballista) or a creature to copy (Phyrexian Metamorph). Cast
    // as it is, it dies at once.
    .filter(({ c }) => !(isCreature(book, c) && infoOf(book, c)?.toughness === 0))
    // Permanents first, biggest first; then tutors; then the draw spells.
    .sort((a, b) => rank(a.c) - rank(b.c) || value(book, b.c) - value(book, a.c));
  function rank(c: PlayCard) {
    // Another turn first: everything after it is worth twice. A combo
    // deck's tutors come before its permanents: the piece is the plan.
    return extraTurnOf(infoOf(book, c)) || adNauseamOf(infoOf(book, c)) || impulseOf(infoOf(book, c)) ? -1 : tutorOf(infoOf(book, c)) ? (ending.length ? -0.5 : 1) : drawOnly(book, c) ? 2 : 0;
  }
  /** A draw engine (Necropotence, Rhystic Study, Mystic Remora, Ad
      Nauseam): worth a ritual to land early. */
  const engine = (c: PlayCard) => {
    const info = infoOf(book, c);
    return !!lifeForCardsOf(book, c) || !!triggersOf(book, c).tax || adNauseamOf(info);
  };
  /** A ritual cast first (on the planner's copy of the table) so the
      engine can be paid for: its action, or null. */
  const ritualInto = (c: PlayCard, zone: "hand" | "command"): PlanAction | null => {
    if (uncastable(sim, seat, c, book)) return null;
    for (const r of sim.sides[seat].hand) {
      if (r.iid === c.iid || heldForCombo(book, r, combos) || uncastable(sim, seat, r, book)) continue;
      const units = ritualMana(infoOf(book, r), {
        graveyard: sim.sides[seat].graveyard.length,
        ritesInGraveyards: [...sim.sides.you.graveyard, ...sim.sides.opp.graveyard].filter((x) => x.name === r.name).length,
        foeHand: sim.sides[other(seat)].hand.length,
      });
      if (!units || units.length <= totalOf(spellCost(sim, seat, r, book, "hand"))) continue;
      const saved = sim;
      if (!payIn(spellCost(sim, seat, r, book, "hand"))) continue;
      sim = structuredClone(sim);
      if (!sim.pool) sim.pool = { you: [], opp: [] };
      sim.pool[seat] = [...sim.pool[seat], ...units];
      sim.sides[seat] = { ...sim.sides[seat], hand: sim.sides[seat].hand.filter((x) => x.iid !== r.iid) };
      if (castable(sim, seat, c, book, zone)) return blankAction("cast", r.iid);
      sim = saved;
    }
    return null;
  };
  // Transmute (Drift of Phantasms, Dizzy Spell, Muddle the Mixture): for a
  // piece its combo lacks, the card is worth more as that piece.
  const transmuted = new Set<number>();
  for (const c of [...sim.sides[seat].hand]) {
    const tm = transmuteOf(infoOf(book, c));
    if (!tm) continue;
    const search: Search = { count: 1, what: `a card with mana value ${tm.manaValue}`, to: [{ zone: "hand" }], test: (_type, info) => (info?.manaValue ?? 0) === tm.manaValue };
    const found = tutorPick(sim, seat, c, book, combos, { tutor: { search, lose: 0 }, onlyPieces: true });
    if (!found || !payIn(parseCost(tm.cost))) continue;
    main.push({ ...blankAction("activate", c.iid), mana: tm.cost, effects: found });
    sim = structuredClone(sim);
    sim.sides[seat] = { ...sim.sides[seat], hand: sim.sides[seat].hand.filter((x) => x.iid !== c.iid) };
    transmuted.add(c.iid);
  }
  for (const { c, zone } of candidates) {
    if (transmuted.has(c.iid)) continue;
    if (!castable(sim, seat, c, book, zone)) {
      // Worth a ritual: a draw engine, or (in a combo deck) a tutor that
      // finds the piece it lacks. The win comes next turn: it needn't all
      // fit in one.
      const worth = engine(c) || (!!tutorOf(infoOf(book, c)) && !!tutorPick(sim, seat, c, book, combos, { onlyPieces: true }));
      const ritual = worth ? ritualInto(c, zone) : null;
      if (!ritual) continue;
      main.push(ritual);
    }
    // A tutor needs something worth finding; a draw spell, the life to spare.
    const found = tutorOf(infoOf(book, c)) ? tutorPick(sim, seat, c, book, combos) : null;
    if (tutorOf(infoOf(book, c)) && !found) continue;
    const drawSpell = drawSpellOf(infoOf(book, c));
    if (!payIn(spellCost(sim, seat, c, book, zone))) continue;
    if (found) main.push({ ...blankAction("cast", c.iid), effects: found });
    else if (drawSpell && !wheelWorth(sim, seat, c, book) && !treasureSpellOf(book, c)) {
      const effects = [drawEffect(drawSpell.draw)];
      if (drawSpell.lose) effects.push({ ...blank("life"), player: "ai", amount: -drawSpell.lose });
      main.push({ ...blankAction("cast", c.iid), effects });
      sim = structuredClone(sim);
      sim.sides[seat] = { ...sim.sides[seat], life: sim.sides[seat].life - drawSpell.lose };
    } else main.push(blankAction("cast", c.iid));
  }
  // An activated tutor on the battlefield (Wishclaw Talisman), for a combo
  // piece: the player gets it after.
  for (const c of sim.sides[seat].battlefield) {
    const ab = isLand(c) || c.tapped ? null : searchAbility(infoOf(book, c));
    if (!ab || ab.count !== 1 || ab.to[0]!.zone !== "hand" || !ab.tap) continue;
    const found = tutorPick(sim, seat, c, book, combos, { tutor: { search: ab, lose: ab.life }, onlyPieces: !!ab.givesAway || ab.sacrifice });
    if (!found || !payIn(parseCost(ab.mana))) continue;
    main.push(abilityTutor(c, ab, found));
    sim = structuredClone(sim);
    sim.sides[seat] = { ...sim.sides[seat], battlefield: sim.sides[seat].battlefield.map((x) => (x.iid === c.iid ? { ...x, tapped: true } : x)) };
  }
  // The One Ring: a card for each burden counter, every turn it can spare
  // the life (the counters cost one each at its upkeep).
  for (const c of sim.sides[seat].battlefield) {
    if (c.tapped || !burdenDrawOf(book, c)) continue;
    const burden = (c.burden ?? 0) + 1;
    if (sim.sides[seat].life - burden < 12) continue;
    main.push({ ...blankAction("activate", c.iid), tap_card: true });
    sim = structuredClone(sim);
    sim.sides[seat] = { ...sim.sides[seat], battlefield: sim.sides[seat].battlefield.map((x) => (x.iid === c.iid ? { ...x, tapped: true, burden } : x)) };
  }
  // Then the Equipment that's on nothing, onto its best creature, while it
  // can pay. (An Equipment cast this turn waits for the next: it isn't on
  // the battlefield the planner looks at.)
  for (const e of sim.sides[seat].battlefield) {
    const eq = equipOf(book, e);
    if (!eq || e.attachedTo !== undefined) continue;
    const host = aiEquipHost(sim, seat, e, [], book);
    if (host === undefined || !payIn(parseCost(eq.cost))) continue;
    main.push({ ...blankAction("activate", e.iid), mana: eq.cost, effects: [{ ...blank("note"), target: cardId(host), text: "equip" }] });
    sim = structuredClone(sim);
    sim.sides[seat] = { ...sim.sides[seat], battlefield: sim.sides[seat].battlefield.map((x) => (x.iid === e.iid ? { ...x, attachedTo: host } : x)) };
  }
  return {
    main,
    attack: safeAttackers(g, seat, book).map((c) => cardId(c.iid)),
    after_combat: [],
    say: "",
  };
}

/** A spell that only searches for lands, as the effects that carry it out:
    each land found goes where the card says (the battlefield, tapped or
    not, or the hand). Null for any other spell, or with no land to find.
    Basics the hand's colours are missing are found first. */
function landSearch(g: PracticeGame, seat: Seat, c: PlayCard, book: CardBook, taken: Set<number>): Effect[] | null {
  const info = infoOf(book, c);
  if (isLand(c) || !/\b(Instant|Sorcery)\b/.test((info?.typeLine ?? c.typeLine ?? "").split(" // ")[0]!)) return null;
  const spec = searchOnCast(info);
  // Only a search and nothing else: "…, then shuffle." is the whole card.
  if (!spec || !/^search your library for [^.]*\.(?: \([^)]*\))?$/i.test((info?.oracleText ?? "").trim())) return null;
  // A ramp spell finds only lands; one that would find a creature or a
  // spell too ("a card": Demonic Tutor) is a tutor.
  if (["Creature — Test", "Instant", "Artifact"].some((t) => spec.test(t, undefined))) return null;
  const side = g.sides[seat];
  const lands = side.library.filter((l) => !taken.has(l.iid) && isLand(l) && spec.test(l.typeLine, infoOf(book, l)));
  if (!lands.length) return null;
  const have = new Set(side.battlefield.flatMap((x) => landColors(book, x)));
  const useful = (l: PlayCard) => landColors(book, l).filter((col) => !have.has(col)).length;
  const picks = [...lands].sort((a, b) => useful(b) - useful(a)).slice(0, spec.count);
  // Every find must be a land the card could find: otherwise it's not a ramp spell.
  const effects: Effect[] = [];
  for (const [i, l] of picks.entries()) {
    taken.add(l.iid);
    const to = spec.to[Math.min(i, spec.to.length - 1)] ?? { zone: "battlefield" as const, tapped: true };
    if (to.zone === "top") return null;
    effects.push({ type: "search", target: null, player: null, amount: null, name: l.name, power: null, toughness: null, keywords: [], to: to.zone, tapped: to.zone === "battlefield" ? !!to.tapped : null, text: null });
  }
  return effects.length ? effects : null;
}

/** A line of rules text that is an ability to use, other than one that only
    makes mana ("{T}: Add {G}"). */
const usableAbility = (text: string) => text.split("\n").some((line) => /^[^:"]{1,80}:\s+(?!Add\b)/.test(line.trim()));

/** A turn with nothing to decide, or null. After its land drop the seat can
    cast nothing, has no creature that could attack, and controls nothing
    with an ability to use: all there is to do is play the land (or pass).
    The table plays that without asking the model, which would take its
    time to say the same. Early turns are mostly these. */
export function simpleTurn(g: PracticeGame, book: CardBook, seat: Seat = "opp", combos: DeckCombo[] = []): TurnPlan | null {
  if (g.winner || g.choice || g.combat || g.active !== seat) return null;
  const plan = fallbackPlan(g, book, seat, {}, combos);
  if (plan.attack.length || plan.after_combat.length || plan.main.some((a) => a.kind !== "land")) return null;
  // The table as it is once the land is down (a fetch land has fetched).
  let after = g;
  for (const a of plan.main) after = applyAction(after, seat, a, book).game;
  if (after.winner || after.choice) return null;
  const side = after.sides[seat];
  const spells = [...side.hand.map((c) => ({ c, zone: "hand" as const })), ...side.command.map((c) => ({ c, zone: "command" as const }))].filter(({ c }) => !isLand(c));
  if (spells.some(({ c, zone }) => castable(after, seat, c, book, zone))) return null;
  if (side.battlefield.some((c) => canAttack(after, seat, c, book))) return null;
  if (side.battlefield.some((c) => !isLand(c) && usableAbility(infoOf(book, c)?.oracleText ?? ""))) return null;
  return plan;
}

/** The AI keeps 2–5 lands in seven; otherwise it mulligans once and puts
    back what it has too much of. */
export function aiMulligan(side: PlaytestState, book: CardBook): PlaytestState {
  // Fast mana counts towards a hand's mana: a card that costs one or less
  // and makes mana (Sol Ring, Lotus Petal, a Mox), or a Spirit Guide.
  const fast = (c: PlayCard) => {
    if (isLandCard(c.typeLine)) return false;
    const info = infoOf(book, c);
    if (handManaOf(info)) return true;
    const made = manaOutput(info, c.typeLine);
    return !!made && !isCreature(book, c) && (info?.manaValue ?? 9) <= 1;
  };
  // A hand's mana has to make a colour its spells ask for. (City of Traitors
  // as the only land, with a hand of blue, black and red spells, was kept
  // at six: it cast its {0} commander and nothing else for six turns.) A
  // fetch land finds a coloured one.
  const ALL = ["W", "U", "B", "R", "G"];
  const coloured = (hand: PlayCard[]) => {
    const made = new Set(
      hand
        .filter((c) => isLandCard(c.typeLine) || fast(c))
        .flatMap((c) => (fetchOf(infoOf(book, c)) ? ALL : (manaOutput(infoOf(book, c), c.typeLine)?.colors ?? (handManaOf(infoOf(book, c)) ? ALL : []))))
    );
    const asked = hand.filter((c) => !isLandCard(c.typeLine)).flatMap((c) => parseCost(infoOf(book, c)?.manaCost ?? null).pips.flat().filter((p) => ALL.includes(p)));
    return !asked.length || asked.some((p) => made.has(p));
  };
  const keepable = (hand: PlayCard[], mulligans: number) => {
    const lands = hand.filter((c) => isLandCard(c.typeLine)).length;
    const mana = lands + hand.filter(fast).length;
    if (lands >= 2 && lands <= 5) return true;
    // On one land, that land (or the fast mana beside it) has to cast something.
    if (!coloured(hand)) return false;
    // One land with fast mana is a turbo deck's keep.
    if (lands === 1 && mana >= 3) return true;
    // Past one mulligan, anything with a land in it.
    return mulligans >= 1 && lands >= 1 && lands <= 6;
  };
  if (keepable(side.hand, 0)) return side;
  let s = side;
  // Never a hand with no land: down to five at most.
  do s = londonMulligan(s);
  while (s.mulligans < 2 && !keepable(s.hand, s.mulligans));
  const after = s.hand.filter((c) => isLandCard(c.typeLine)).length;
  const back = [...s.hand].sort((a, b) => {
    // Too few lands: bottom the priciest spell (fast mana last). Too many: bottom a land.
    if (after < 3) return (isLandCard(a.typeLine) ? 1 : 0) - (isLandCard(b.typeLine) ? 1 : 0) || Number(fast(a)) - Number(fast(b)) || value(book, b) - value(book, a);
    return (isLandCard(b.typeLine) ? 1 : 0) - (isLandCard(a.typeLine) ? 1 : 0);
  });
  for (const c of back.slice(0, s.toBottom)) s = bottomCard(s, c.iid);
  return s;
}
