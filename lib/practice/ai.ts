// The parts of the AI opponent that are rules, not judgement, and so need
// no model: how it blocks, whether it mulligans, and the plan it falls back
// on when the model can't be reached. See docs/practice-vs-ai.md.

import { mulligan as londonMulligan, bottomCard, isLandCard, type PlayCard, type PlaytestState } from "../playtest";
import { BASIC_COLOR, canPlayAsLand, edictOf, entersTapped, fetchOf, has, infoOf, isCreature, isLand, manaOutput, searchOnCast, stats, wheelSpellOf } from "./cards";
import { aiRemovalAction, applyAction, availableMana, canAttack, canBlock, cardId, castable, indestructible, lifeFor, spellCost } from "./game";
import { manaSources, manaTotal, parseCost, payCost } from "./mana";
import { treasureSpellOf } from "./treasure";
import { drawSpellOf, tutorOf, wipeOf } from "./spells";
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
  const total = able.reduce((n, c) => n + stats(book, c).power * (has(book, c, "Double strike") ? 2 : 1), 0);
  if (total >= g.sides[def].life + blockers.reduce((n, b) => n + Math.max(0, stats(book, b).power), 0) && able.length > blockers.length) return able;
  return able.filter((a) => !blockers.some((b) => canBlock(book, b, a) && exchange(book, a, b).kills && !exchange(book, a, b).dies));
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
  return d && life - d.lose >= 10 ? d.draw : 0;
}

const blank = (type: Effect["type"]): Effect => ({ ...drawEffect(0), type, player: null, amount: null });

/** What a tutor finds: the biggest card it can cast next turn (with one
    more land), or else the biggest. Lands only when it has none in hand and
    few out. */
function tutorPick(g: PracticeGame, seat: Seat, c: PlayCard, book: CardBook): Effect[] | null {
  const t = tutorOf(infoOf(book, c));
  if (!t || g.sides[seat].life - t.lose < 10) return null;
  const side = g.sides[seat];
  // Next turn's mana: what it has (tapped or not) and a land drop.
  const reach = manaTotal(availableMana(g, seat, book)) + side.battlefield.filter((x) => x.tapped).length + 1;
  const needLand = !side.hand.some(canPlayAsLand) && side.battlefield.filter(isLand).length < 4;
  const fits = side.library.filter((x) => t.search.test(x.typeLine, infoOf(book, x)) && (needLand || !isLand(x)) && (infoOf(book, x)?.toughness !== 0 || !isCreature(book, x)));
  if (!fits.length) return null;
  const mv = (x: PlayCard) => infoOf(book, x)?.manaValue ?? 0;
  const score = (x: PlayCard) => (needLand && isLand(x) ? 10000 : 0) + (mv(x) <= reach ? 1000 : 0) + mv(x) * 10 + (isCreature(book, x) ? 1 : 0);
  const pick = fits.reduce((a, b) => (score(b) > score(a) ? b : a));
  const effects: Effect[] = [{ ...blank("search"), name: pick.name, to: t.search.to[0]!.zone === "top" ? "top" : "hand" }];
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

/** A wheel is worth casting when it gives this seat more cards than it
    throws away: the hand (less the wheel) is two cards or fewer. */
function wheelWorth(g: PracticeGame, seat: Seat, c: PlayCard, book: CardBook): boolean {
  const w = wheelSpellOf(book, c);
  if (!w) return false;
  const left = g.sides[seat].hand.filter((x) => x.iid !== c.iid).length;
  return left <= 2 && g.sides[seat].library.length > 10;
}

/** The turn without the model: a land (the one that unlocks the most), then
    the biggest permanents it can pay for, then spells that only draw, then
    safe attacks. */
export function fallbackPlan(g: PracticeGame, book: CardBook, seat: Seat = "opp"): TurnPlan {
  const side = g.sides[seat];
  const main: PlanAction[] = [];
  const lands = side.hand.filter(canPlayAsLand);
  if (!g.landPlayed && lands.length) {
    // Prefer a land of a colour the hand (or the commander) is missing,
    // then one that enters untapped.
    const have = new Set(side.battlefield.flatMap((c) => landColors(book, c)));
    const missing = new Set(
      [...side.hand.filter((c) => !isLand(c)), ...side.command].flatMap((c) => parseCost(infoOf(book, c)?.manaCost ?? null).pips.flat()).filter((c) => !have.has(c))
    );
    // A modal card with a land back is a spell first: a real land goes before it.
    const score = (l: PlayCard) =>
      landColors(book, l).filter((c) => missing.has(c)).length * 10 + (entersTapped(infoOf(book, l)) ? 0 : 5) + landColors(book, l).length - (isLand(l) ? 0 : 8);
    const pickLand = lands.reduce((a, b) => (score(b) > score(a) ? b : a));
    main.push(blankAction("land", pickLand.iid));
  }
  // Spend the mana: permanents, biggest first, while it can still pay.
  // (Instants and sorceries need targets and judgement, so they wait.)
  let sim: PracticeGame = structuredClone(g);
  if (main.length) {
    const land = sim.sides[seat].hand.find((c) => cardId(c.iid) === main[0]!.card)!;
    // A land that enters tapped (a Triome) gives nothing this turn. (A fetch
    // land or a shock land is played out by the engine below.)
    const tapped = entersTapped(infoOf(book, land)) && !fetchOf(infoOf(book, land));
    sim.sides[seat] = { ...sim.sides[seat], hand: sim.sides[seat].hand.filter((c) => c !== land), battlefield: [...sim.sides[seat].battlefield, { ...land, enteredTurn: g.turn, tapped }] };
    sim.landPlayed = true;
  }
  // Pay from the simulated table: tap what's used, and pay the life.
  const payIn = (cost: ReturnType<typeof parseCost>) => {
    const sources = availableMana(sim, seat, book);
    const paid = payCost(cost, sources, { lifeFor: lifeFor(sim, seat, book) });
    if (!paid || (paid.life && sim.sides[seat].life - paid.life < 10)) return false;
    const once = paid.tap.filter((t) => sources.find((x) => x.iid === t)?.once);
    const tapped = new Set(paid.tap.flatMap((t) => [t, ...(sources.find((x) => x.iid === t)?.also ?? [])]).filter((t) => !once.includes(t)));
    sim = structuredClone(sim);
    sim.once = [...(sim.once ?? []), ...once];
    sim.sides[seat] = {
      ...sim.sides[seat],
      life: sim.sides[seat].life - paid.life,
      battlefield: sim.sides[seat].battlefield.map((x) => (tapped.has(x.iid) ? { ...x, tapped: true } : x)),
    };
    return true;
  };
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
          wheelWorth(sim, seat, c, book) ||
          !!treasureSpellOf(book, c))
    )
    // A 0/0 creature needs a choice the planner doesn't make: X counters
    // (Walking Ballista) or a creature to copy (Phyrexian Metamorph). Cast
    // as it is, it dies at once.
    .filter(({ c }) => !(isCreature(book, c) && infoOf(book, c)?.toughness === 0))
    // Permanents first, biggest first; then tutors; then the draw spells.
    .sort((a, b) => rank(a.c) - rank(b.c) || value(book, b.c) - value(book, a.c));
  function rank(c: PlayCard) {
    return tutorOf(infoOf(book, c)) ? 1 : drawOnly(book, c) ? 2 : 0;
  }
  for (const { c, zone } of candidates) {
    if (!castable(sim, seat, c, book, zone)) continue;
    // A tutor needs something worth finding; a draw spell, the life to spare.
    const found = tutorOf(infoOf(book, c)) ? tutorPick(sim, seat, c, book) : null;
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
export function simpleTurn(g: PracticeGame, book: CardBook, seat: Seat = "opp"): TurnPlan | null {
  if (g.winner || g.choice || g.combat || g.active !== seat) return null;
  const plan = fallbackPlan(g, book, seat);
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
