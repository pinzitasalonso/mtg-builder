// A goldfish, for the Speed axis.
//
// The rubric defines Speed entirely by the fundamental turn: "the turn it
// actually COMPLETES an elimination or wins outright in at least 50% of games
// with normal draws and no disruption. Goldfish a dozen hands turn by turn."
// That is a thing a computer can do, so this does it: a few hundred seeded
// hands, played with the rules that matter for a clock — land drops, rocks and
// dorks, rituals spent on a kill, tutors finding the missing piece, combo lines
// assembled and fired, creatures attacking a 40-life opponent, poison at ten,
// commander damage at twenty-one, pump finishers and drains.
//
// It is an ESTIMATE, and the result says so in its notes. What it does not
// model: colour, cost reducers, reanimation, cheating threats into play, and
// the opponent doing anything at all — which is the rubric's own definition.
// What it gets right is the thing the constant never could: a deck with fast
// mana and a two-card combo reads turn 3–4, a precon reads turn 9–11, and
// swapping a card moves the number.
//
// Seeded, so the same decklist scores the same every time.

import { MANA_OUTPUT, OVERRUN_FINISHERS } from "./deck-score-cards";
import { drawReading, manaProduced, nameKey, tutorReading, type CardRead } from "./deck-score-classify";

export interface GoldfishLine {
  pieces: string[];
  /** Mana to fire once the pieces are in play, from Spellbook's "{U}{U}{B}". */
  manaNeeded: number;
  /** Whether firing it wins or takes a player out — the goldfish only cares about those. */
  lethal: boolean;
  /** Any one of these is also needed — an outlet that turns infinite mana into a kill. */
  anyOf?: string[];
}

export interface GoldfishResult {
  /** The fundamental turn, on the half-turn grid the rubric reads. 14 means "14 or later". */
  fundamentalTurn: number;
  /** Fraction of hands that had taken a player out by each turn (index = turn). */
  wonByTurn: number[];
  hands: number;
  comboWins: number;
  combatWins: number;
  noWin: number;
  /** Mean mana available on turns 3, 4 and 5, for the notes. */
  manaOnTurn: Record<number, number>;
  notes: string[];
}

interface SimCard {
  name: string;
  key: string;
  mv: number;
  isLand: boolean;
  entersTapped: boolean;
  landMana: number;
  rock: number;
  dork: number;
  ritualNet: number;
  ritualAmount: number;
  landRamp: number;
  extraLandDrop: boolean;
  drawNow: number;
  drawPerTurn: number;
  tutor: boolean;
  creature: boolean;
  power: number;
  haste: boolean;
  infect: boolean;
  isCommander: boolean;
  anthem: number;
  extraCombat: "permanent" | "spell" | null;
  overrun: { kind: "craterhoof" | "flat" | "infect"; amount: number } | null;
  drainPerTurn: number;
  burn: number;
  /** "Each opponent loses X life" with X = leftover mana. */
  drainX: boolean;
  equipBonus: number;
  equipCost: number;
  /** Puts a permanent from hand onto the battlefield: each turn, or once. */
  cheat: "turn" | "once" | null;
}

const MAX_TURN = 14;

/** mulberry32 — small, fast, and the same sequence for the same seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashNames(names: string[]): number {
  let h = 2166136261;
  for (const n of [...names].sort()) {
    for (let i = 0; i < n.length; i++) {
      h ^= n.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

const wordNumber = (w: string): number =>
  ({ a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 } as Record<string, number>)[w] ??
  (Number.parseInt(w, 10) || 0);

export function toSimCard(r: CardRead): SimCard {
  const t = r.text;
  const named = MANA_OUTPUT[r.key];
  const card: SimCard = {
    name: r.card.name,
    key: r.key,
    mv: r.mv,
    isLand: r.isLand,
    entersTapped: r.isLand && /enters (the battlefield )?tapped/.test(t) && !/unless/.test(t),
    landMana: r.isLand ? (named?.kind === "land" ? named.amount : 1) : 0,
    rock: 0,
    dork: 0,
    ritualNet: 0,
    ritualAmount: 0,
    landRamp: 0,
    extraLandDrop: /you may play an additional land/.test(t),
    drawNow: 0,
    drawPerTurn: 0,
    tutor: false,
    creature: r.isCreature && !r.isLand,
    power: r.card.power ?? (r.isCreature ? Math.max(1, Math.round(r.mv * 0.8)) : 0),
    haste: r.keywords.has("haste"),
    infect: r.keywords.has("infect") || r.keywords.has("toxic"),
    isCommander: r.card.isCommander,
    anthem: 0,
    extraCombat: null,
    overrun: null,
    drainPerTurn: 0,
    burn: 0,
    drainX: false,
    equipBonus: 0,
    equipCost: 0,
    cheat: null,
  };
  if (r.isLand) return card;

  // Cheating a permanent into play — Braids, Sneak Attack, Show and Tell,
  // Elvish Piper — is the whole speed of the decks that do it, and the
  // curve says nothing about it.
  const cheats = /put (a|an|any number of|up to one|target) (artifact|creature|enchantment|land|permanent|artifact, creature, enchantment, or land|artifact, creature, enchantment, or planeswalker|creature or artifact)[^.]*card[^.]* from (your|their) hand onto the battlefield/.test(t);
  if (cheats && !/exile|graveyard/.test(t.split(".")[0] ?? "")) {
    card.cheat = r.isPermanent && /at the beginning of|whenever|\{t\}|: put/.test(t) ? "turn" : "once";
  }

  // Mana.
  const producesMana = /\{t\}[^:]*: add|: add \{|^add \{|add one mana|add two mana|add three mana|mana of any/.test(t);
  if (named && named.kind === "ritual") {
    card.ritualAmount = named.amount;
    card.ritualNet = named.amount - r.mv;
  } else if (named && named.kind === "rock") {
    card.rock = named.amount;
  } else if (named && named.kind === "dork") {
    card.dork = named.amount;
  } else if (producesMana && r.isCreature) {
    card.dork = manaProduced(r);
  } else if (producesMana && r.isPermanent && !/only to (cast|activate)/.test(r.first)) {
    card.rock = manaProduced(r);
    // Enchant-a-land ramp (Wild Growth) reads as a rock; it is one.
  } else if (!r.isPermanent && /^add /.test(r.first)) {
    card.ritualAmount = manaProduced(r);
    card.ritualNet = card.ritualAmount - r.mv;
  }
  if (card.rock && /enters (the battlefield )?tapped/.test(t)) card.entersTapped = true;

  // Land ramp spells and creatures.
  const ramp = t.match(/search your library for (up to )?(a|an|two|three|x) (basic )?(land|forest|plains|island|swamp|mountain)[^.]*(onto the battlefield|put (it|them|one of them|those cards) onto)/);
  if (ramp) card.landRamp = Math.max(1, wordNumber(ramp[2] ?? "a") - (ramp[1] && /your hand/.test(t) ? 1 : 0));
  if (/put a land card from your hand onto the battlefield/.test(t)) card.landRamp = Math.max(card.landRamp, 1);

  // Draw.
  const d = drawReading(r);
  if (d) {
    if (!r.isPermanent) {
      if (d.kind === "burst") card.drawNow = 6;
      else if (d.kind === "oneshot") card.drawNow = 2;
      else if (d.kind === "selection") card.drawNow = 1;
    } else if (d.kind === "burst") {
      // Necropotence, Bolas's Citadel: a permanent that refills at once.
      card.drawNow = 7;
      card.drawPerTurn = 1;
    } else if (d.kind !== "oneshot" && d.kind !== "symmetric") {
      card.drawPerTurn = 1;
    } else if (d.kind === "oneshot") {
      card.drawNow = 1;
    }
  }

  // Tutors.
  const tu = tutorReading(r);
  card.tutor = Boolean(tu && !tu.graveyardDestination && !r.isPermanent);

  // Combat helpers.
  const anthem = t.match(/(creatures|other creatures|creature tokens|\w+ creatures) you control get \+(\d)\/\+\d/);
  if (anthem && r.isPermanent) card.anthem = Number(anthem[2]);
  if (/additional combat phase/.test(t)) card.extraCombat = r.isPermanent ? "permanent" : "spell";
  if (!r.isPermanent || OVERRUN_FINISHERS.has(r.key) || r.isCreature) {
    if (/creatures you control get \+x\/\+x[^.]*(where x is|equal to)[^.]*number of creatures/.test(t)) {
      card.overrun = { kind: "craterhoof", amount: 0 };
    } else if (/creatures you control (get|gain) \+(\d)\/\+\d[^.]*trample/.test(t) || (/creatures you control get \+(\d)\/\+\d/.test(t) && !r.isPermanent)) {
      const m = t.match(/creatures you control (?:get|gain) \+(\d)\/\+\d/);
      card.overrun = { kind: "flat", amount: Number(m?.[1] ?? 1) };
    }
    if (/creatures you control (gain|have) infect/.test(t)) card.overrun = { kind: "infect", amount: card.overrun?.amount ?? 0 };
  }

  // Drain and burn.
  const drain = t.match(/each opponent loses (\d+) life/);
  if (drain && r.isPermanent && /whenever|at the beginning/.test(t)) card.drainPerTurn = Number(drain[1]);
  else if (drain && !r.isPermanent) card.burn = Number(drain[1]);
  if (!r.isPermanent && /each opponent loses x life/.test(t)) card.drainX = true;
  const burn = t.match(/deals? (\d+) damage to (any target|each opponent|target player|target opponent|target player or planeswalker|each player)/);
  if (burn && !r.isPermanent) card.burn = Math.max(card.burn, Number(burn[1]));

  // Equipment.
  const eq = t.match(/equipped creature gets \+(\d+)\/\+\d+/);
  if (eq && /\bequipment\b/.test(r.type)) {
    card.equipBonus = Number(eq[1]);
    const cost = t.match(/equip \{?(\d)\}?/);
    card.equipCost = cost ? Number(cost[1]) : 2;
  }
  return card;
}

interface Creature {
  power: number;
  castTurn: number;
  haste: boolean;
  infect: boolean;
  isCommander: boolean;
  bonus: number;
}

export function goldfish(
  reads: CardRead[],
  lines: GoldfishLine[],
  options: { hands?: number; seed?: number; trace?: (line: string) => void } = {}
): GoldfishResult {
  const trace = options.trace;
  const deck: SimCard[] = [];
  const commanders: SimCard[] = [];
  for (const r of reads) {
    const sim = toSimCard(r);
    if (sim.isCommander) {
      commanders.push(sim);
      continue;
    }
    for (let i = 0; i < r.copies; i++) deck.push(sim);
  }
  // Ad Nauseam draws until the life runs out, and the curve decides how far
  // that is: a cEDH pile at an average of 1.2 sees fifteen cards.
  const nonland = reads.filter((r) => !r.isLand && !r.card.isCommander);
  const avgMv = nonland.length ? nonland.reduce((n, r) => n + r.mv * r.copies, 0) / nonland.reduce((n, r) => n + r.copies, 0) : 3;
  for (const c of deck) if (c.key === "ad nauseam") c.drawNow = Math.max(6, Math.min(16, Math.round(30 / Math.max(1, avgMv * 1.6))));
  const hands = options.hands ?? 300;
  const seed = options.seed ?? hashNames(reads.map((r) => `${r.key}x${r.copies}`));
  const random = rng(seed);

  const lethalLines = lines
    .filter((l) => l.lethal && l.pieces.length > 0)
    .map((l) => ({ pieces: l.pieces.map(nameKey), manaNeeded: l.manaNeeded, anyOf: (l.anyOf ?? []).map(nameKey) }));
  const commanderKeys = new Set(commanders.map((c) => c.key));
  // A tutor that is itself a piece of a win line (Demonic Consultation) is
  // held for the line, never spent finding something else.
  const pieceKeys = new Set(lethalLines.flatMap((l) => [...l.pieces, ...l.anyOf]));
  for (const c of deck) if (c.tutor && pieceKeys.has(c.key)) c.tutor = false;

  const wonAt: number[] = [];
  let comboWins = 0;
  let combatWins = 0;
  const manaSamples: Record<number, number[]> = { 3: [], 4: [], 5: [] };

  const empty: GoldfishResult = {
    fundamentalTurn: MAX_TURN,
    wonByTurn: new Array(MAX_TURN + 1).fill(0),
    hands: 0,
    comboWins: 0,
    combatWins: 0,
    noWin: 0,
    manaOnTurn: { 3: 0, 4: 0, 5: 0 },
    notes: ["Not enough cards to goldfish."],
  };
  if (deck.length < 40) return empty;

  for (let h = 0; h < hands; h++) {
    const onPlay = h % 2 === 0;
    const library = [...deck];
    for (let i = library.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [library[i], library[j]] = [library[j]!, library[i]!];
    }
    let hand = library.splice(0, 7);
    const landsIn = (cards: SimCard[]) => cards.filter((c) => c.isLand).length;
    const manaIn = (cards: SimCard[]) => cards.filter((c) => c.isLand || c.rock > 0 || c.dork > 0 || c.ritualAmount > 0).length;
    // A combo deck also ships a hand with no way to the line: no tutor, no
    // piece, no refill. Its pilots mulligan for exactly that.
    const live = (cards: SimCard[]) => cards.some((c) => c.tutor || c.drawNow >= 6 || pieceKeys.has(c.key));
    const dead = (cards: SimCard[]) =>
      lethalLines.length > 0 ? manaIn(cards) < 2 || manaIn(cards) > 5 || !live(cards) : landsIn(cards) < 2 || landsIn(cards) > 5;
    // One London mulligan on a hand that cannot function.
    if (dead(hand)) {
      library.push(...hand);
      for (let i = library.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [library[i], library[j]] = [library[j]!, library[i]!];
      }
      hand = library.splice(0, 7);
      // Bottom the worst card: an excess land, else the most expensive spell.
      const idx =
        landsIn(hand) > 4
          ? hand.findIndex((c) => c.isLand)
          : hand.reduce((best, c, i) => (!c.isLand && c.mv > (hand[best]?.mv ?? -1) ? i : best), -1);
      if (idx >= 0) library.push(...hand.splice(idx, 1));
    }

    // Board state.
    const lands: { mana: number; playedTurn: number; tapped: boolean }[] = [];
    const rocks: { mana: number; activeFrom: number }[] = [];
    const dorks: { mana: number; castTurn: number }[] = [];
    const creatures: Creature[] = [];
    const battlefieldKeys = new Set<string>();
    let anthems = 0;
    let extraCombatPerm = false;
    let drawEngines = 0;
    let extraLandDrops = 0;
    let cheatEngines = 0;
    let commanderCasts = 0;
    let drainPerTurn = 0;
    let life = 40;
    let poison = 0;
    let commanderDamage = 0;
    let won = 0;
    let wonBy: "combo" | "combat" = "combat";
    const equipmentOnBoard: { bonus: number; cost: number; attached: boolean }[] = [];

    const draw = (n: number) => {
      for (let i = 0; i < n; i++) {
        const c = library.shift();
        if (c) hand.push(c);
      }
    };

    for (let t = 1; t <= MAX_TURN && !won; t++) {
      if (t > 1 || !onPlay) draw(1);
      draw(drawEngines);

      // Land drops.
      let drops = 1 + extraLandDrops;
      while (drops > 0) {
        const untapped = hand.findIndex((c) => c.isLand && !c.entersTapped);
        const any = untapped >= 0 ? untapped : hand.findIndex((c) => c.isLand);
        if (any < 0) break;
        const land = hand.splice(any, 1)[0]!;
        lands.push({ mana: land.landMana, playedTurn: t, tapped: land.entersTapped });
        drops--;
      }

      let mana =
        lands.reduce((n, l) => n + (l.tapped && l.playedTurn === t ? 0 : l.mana), 0) +
        rocks.reduce((n, r) => n + (r.activeFrom <= t ? r.mana : 0), 0) +
        dorks.reduce((n, d) => n + (d.castTurn < t ? d.mana : 0), 0);
      if (t >= 3 && t <= 5) manaSamples[t]!.push(mana);
      if (trace && h < 3) trace(`hand ${h} turn ${t}: mana ${mana} | hand: ${hand.map((c) => c.name).join(", ")} | board: ${[...battlefieldKeys].join(", ")}`);

      const ritualMana = () => hand.filter((c) => c.ritualNet > 0).reduce((n, c) => n + c.ritualNet, 0);
      const spendRituals = (needed: number) => {
        // Spend rituals only when they close the gap to a kill.
        for (let i = hand.length - 1; i >= 0 && mana < needed; i--) {
          const c = hand[i]!;
          if (c.ritualNet > 0 && mana >= c.mv) {
            mana += c.ritualNet;
            hand.splice(i, 1);
          }
        }
      };
      const attackers = () => creatures.filter((c) => c.castTurn < t || c.haste);
      /** Land a permanent on the battlefield with all its effects, paying nothing. */
      const materialise = (c: SimCard) => {
        hand.splice(hand.indexOf(c), 1);
        battlefieldKeys.add(c.key);
        if (c.creature) creatures.push({ power: c.power, castTurn: t, haste: c.haste, infect: c.infect, isCommander: false, bonus: 0 });
        if (c.rock > 0) rocks.push({ mana: c.rock, activeFrom: t + 1 });
        if (c.dork > 0) dorks.push({ mana: c.dork, castTurn: t });
        if (c.anthem) anthems += c.anthem;
        if (c.extraCombat === "permanent") extraCombatPerm = true;
        if (c.drawPerTurn) drawEngines += c.drawPerTurn;
        drainPerTurn += c.drainPerTurn;
        if (c.cheat === "turn") cheatEngines += 1;
      };
      // A cheat engine in play (Braids, Sneak Attack) lands the most
      // expensive permanent in hand for free once a turn — pieces of a line
      // first, then the biggest body.
      if (cheatEngines > 0) {
        const isPieceKey = (k: string) => lethalLines.some((l) => l.pieces.includes(k) || l.anyOf.includes(k));
        const candidates = hand.filter((c) => !c.isLand && (c.creature || c.rock > 0 || c.anthem > 0 || c.drawPerTurn > 0 || c.drainPerTurn > 0 || isPieceKey(c.key)) && c.mv >= 3);
        candidates.sort((a, b) => (Number(isPieceKey(b.key)) - Number(isPieceKey(a.key))) || b.mv - a.mv);
        if (candidates[0]) materialise(candidates[0]);
      }
      const combatDamage = (bonusAll = 0, craterhoof = false) => {
        const att = attackers();
        const boardSize = creatures.length;
        let total = 0;
        for (const c of att) total += c.power + c.bonus + anthems + bonusAll + (craterhoof ? boardSize : 0);
        return total * (extraCombatPerm ? 2 : 1);
      };
      const commanderCost = (c: SimCard) => c.mv + 2 * commanderCasts;

      // The casting loop: greedy, best thing first, until nothing fits.
      let progress = true;
      while (progress && !won) {
        progress = false;

        // 1. A lethal combo line assembled?
        for (const line of lethalLines) {
          let cost = line.manaNeeded;
          let ok = true;
          const toCast: SimCard[] = [];
          // The outlet, when the line needs one: any one that is around.
          if (line.anyOf.length) {
            const held = line.anyOf.find((k) => battlefieldKeys.has(k) || hand.some((c) => c.key === k) || commanderKeys.has(k));
            if (!held) continue;
            if (!battlefieldKeys.has(held)) {
              const inHand = hand.find((c) => c.key === held);
              const cz = commanders.find((c) => c.key === held);
              cost += inHand ? inHand.mv : cz ? commanderCost(cz) : 0;
            }
          }
          for (const key of line.pieces) {
            if (battlefieldKeys.has(key)) continue;
            const inHand = hand.find((c) => c.key === key);
            if (inHand) {
              cost += inHand.mv;
              toCast.push(inHand);
              continue;
            }
            const cz = commanders.find((c) => c.key === key);
            if (cz && !battlefieldKeys.has(key)) {
              cost += commanderCost(cz);
              toCast.push(cz);
              continue;
            }
            ok = false;
            break;
          }
          if (!ok) continue;
          // Spellbook's mana-needed already covers casting the pieces, so
          // the two are not summed: a line costs the larger of the two.
          cost = Math.max(cost - line.manaNeeded, line.manaNeeded);
          if (mana + ritualMana() >= cost) {
            spendRituals(cost);
            won = t;
            wonBy = "combo";
            if (trace && h < 3) trace(`  WIN via ${line.pieces.join("+")} cost ${cost}`);
            break;
          }
        }
        if (won) break;

        // 2. Lethal on board this turn, with what is in hand?
        {
          const base = combatDamage();
          const infectPower = attackers().filter((c) => c.infect).reduce((n, c) => n + c.power + c.bonus + anthems, 0);
          if (base >= life || infectPower >= 10 - poison) break; // combat will finish it
          const finisher = hand.find((c) => c.overrun && c.mv <= mana + ritualMana() && attackers().length > 0);
          if (finisher && finisher.overrun) {
            const dmg =
              finisher.overrun.kind === "craterhoof"
                ? combatDamage(0, true)
                : combatDamage(finisher.overrun.amount);
            const lethal =
              finisher.overrun.kind === "infect" ? dmg >= 10 - poison : dmg >= life;
            if (lethal) {
              spendRituals(finisher.mv);
              mana -= finisher.mv;
              hand.splice(hand.indexOf(finisher), 1);
              life = finisher.overrun.kind === "infect" ? life : 0;
              poison = finisher.overrun.kind === "infect" ? 10 : poison;
              won = t;
              break;
            }
          }
          const burn = hand.find((c) => (c.burn > 0 && c.burn + base >= life && c.mv <= mana + ritualMana()) || (c.drainX && mana + ritualMana() - c.mv + base >= life));
          if (burn) {
            spendRituals(burn.mv);
            mana -= burn.mv;
            hand.splice(hand.indexOf(burn), 1);
            life = 0;
            won = t;
            break;
          }
        }

        // 2b. A burst refill (Ad Nauseam, a wheel, Necropotence) before any
        // tutor: it is the strongest thing a hand can do, and chaining a
        // second tutor past it spends the mana it needs.
        {
          const burst = hand.find((c) => c.drawNow >= 6 && !c.creature && c.mv <= mana + ritualMana());
          if (burst) {
            if (trace && h < 3) trace(`  draw ${burst.name} (+${burst.drawNow})`);
            if (burst.mv > mana) spendRituals(burst.mv);
            mana -= burst.mv;
            hand.splice(hand.indexOf(burst), 1);
            if (burst.drawPerTurn) {
              battlefieldKeys.add(burst.key);
              drawEngines += burst.drawPerTurn;
            }
            draw(burst.drawNow);
            progress = true;
            continue;
          }
        }

        // 3. A tutor: for the missing piece of the closest lethal line, or
        // for a refill when nothing is close. Tutors chain as long as the
        // mana holds — a cEDH turn is Vampiric into Consultation into the
        // win — and a ritual pays for the tutor that completes a line.
        {
          const oneAway = lethalLines.some((line) => {
            const missing = line.pieces.filter((k) => !battlefieldKeys.has(k) && !hand.some((c) => c.key === k) && !commanderKeys.has(k));
            return missing.length === 1 && library.some((c) => c.key === missing[0]);
          });
          const tutor = hand.find((c) => c.tutor && c.mv <= mana + (oneAway ? ritualMana() : 0));
          if (tutor) {
            let fetched = false;
            // The line closest to assembled gets the tutor; its first
            // missing piece comes to hand. Two tutors over two turns finds a
            // two-card line from nothing, which is what a player does.
            const ranked = lethalLines
              .map((line) => {
                const missing = line.pieces.filter(
                  (k) => !battlefieldKeys.has(k) && !hand.some((c) => c.key === k) && !commanderKeys.has(k)
                );
                // An outlet counts as missing only when none is held.
                if (line.anyOf.length && !line.anyOf.some((k) => battlefieldKeys.has(k) || hand.some((c) => c.key === k) || commanderKeys.has(k))) {
                  const inLibrary = line.anyOf.find((k) => library.some((c) => c.key === k));
                  if (inLibrary) missing.push(inLibrary);
                }
                return { line, missing };
              })
              .filter((x) => x.missing.length > 0 && x.missing.every((k) => library.some((c) => c.key === k)))
              .sort((a, b) => a.missing.length - b.missing.length);
            const pick = ranked[0];
            if (pick) {
              const idx = library.findIndex((c) => c.key === pick.missing[0]);
              if (idx >= 0) {
                hand.push(...library.splice(idx, 1));
                fetched = true;
              }
            }
            // Two or more pieces short of every line: a tutor finds the
            // refill that digs for all of them at once, when it is castable
            // this turn or next.
            if (fetched && pick && pick.missing.length >= 2 && !hand.some((c) => c.drawNow >= 6)) {
              // Undo the piece fetch in favour of the refill, if one is there.
              const refill = library.findIndex((c) => c.drawNow >= 6 && c.mv <= mana + ritualMana() + 2);
              if (refill >= 0) {
                const piece = hand.pop()!;
                library.push(piece);
                hand.push(...library.splice(refill, 1));
              }
            }
            if (!fetched && lethalLines.length === 0) {
              // No lines: a tutor finds the biggest threat in the library.
              let best = -1;
              for (let i = 0; i < library.length; i++) {
                const c = library[i]!;
                if (c.creature && c.mv <= mana + 2 && (best < 0 || c.power > library[best]!.power)) best = i;
              }
              if (best >= 0) {
                hand.push(...library.splice(best, 1));
                fetched = true;
              }
            }
            if (fetched) {
              if (trace && h < 3) trace(`  tutor ${tutor.name} -> ${hand[hand.length - 1]!.name}`);
              if (tutor.mv > mana) spendRituals(tutor.mv);
              mana -= tutor.mv;
              hand.splice(hand.indexOf(tutor), 1);
              progress = true;
              continue;
            }
          }
        }

        // 4. Ramp, cheapest first, while it is early or the hand has nothing better.
        const rampable = hand
          .filter((c) => (c.rock > 0 || c.dork > 0 || c.landRamp > 0 || c.extraLandDrop) && c.mv <= mana)
          .sort((a, b) => a.mv - b.mv);
        const threatInHand = hand.some((c) => c.creature && c.power >= 3 && c.mv <= mana && c.mv > 2);
        if (rampable.length && (t <= 4 || !threatInHand)) {
          const c = rampable[0]!;
          mana -= c.mv;
          hand.splice(hand.indexOf(c), 1);
          if (c.rock > 0) rocks.push({ mana: c.rock, activeFrom: c.entersTapped ? t + 1 : t });
          if (c.dork > 0) {
            dorks.push({ mana: c.dork, castTurn: t });
            creatures.push({ power: c.power, castTurn: t, haste: c.haste, infect: c.infect, isCommander: false, bonus: 0 });
          }
          if (c.extraLandDrop) {
            extraLandDrops += 1;
            const extra = hand.findIndex((l) => l.isLand);
            if (extra >= 0) {
              const land = hand.splice(extra, 1)[0]!;
              lands.push({ mana: land.landMana, playedTurn: t, tapped: land.entersTapped });
              if (!land.entersTapped) mana += land.landMana;
            }
          }
          for (let i = 0; i < c.landRamp; i++) {
            const idx = library.findIndex((l) => l.isLand);
            if (idx < 0) break;
            const land = library.splice(idx, 1)[0]!;
            lands.push({ mana: land.landMana, playedTurn: t, tapped: true });
          }
          if (c.drawPerTurn) drawEngines += c.drawPerTurn;
          battlefieldKeys.add(c.key);
          progress = true;
          continue;
        }

        // 5. Draw, when the hand is thin enough to want it. A burst refill
        // (Ad Nauseam, a wheel) is worth a ritual.
        const drawSpell = hand.find(
          (c) => c.drawNow > 0 && !c.creature && (hand.length <= 4 || c.drawNow >= 3) && c.mv <= mana + (c.drawNow >= 6 ? ritualMana() : 0)
        );
        if (drawSpell) {
          if (trace && h < 3) trace(`  draw ${drawSpell.name} (+${drawSpell.drawNow})`);
          if (drawSpell.mv > mana) spendRituals(drawSpell.mv);
          mana -= drawSpell.mv;
          hand.splice(hand.indexOf(drawSpell), 1);
          draw(drawSpell.drawNow);
          progress = true;
          continue;
        }

        // 6. The commander, whenever it fits.
        const cz = commanders.find((c) => !battlefieldKeys.has(c.key) && commanderCost(c) <= mana);
        if (cz) {
          mana -= commanderCost(cz);
          commanderCasts += 1;
          battlefieldKeys.add(cz.key);
          if (cz.creature) creatures.push({ power: cz.power, castTurn: t, haste: cz.haste, infect: cz.infect, isCommander: true, bonus: 0 });
          if (cz.dork > 0) dorks.push({ mana: cz.dork, castTurn: t });
          if (cz.drawPerTurn) drawEngines += cz.drawPerTurn;
          if (cz.anthem) anthems += cz.anthem;
          if (cz.extraCombat === "permanent") extraCombatPerm = true;
          drainPerTurn += cz.drainPerTurn;
          if (cz.cheat === "turn") cheatEngines += 1;
          progress = true;
          continue;
        }

        // 6b. Show and Tell, Sneak Attack: the cheat itself, when there is
        // something worth cheating.
        const cheatSpell = hand.find((c) => c.cheat && c.mv <= mana && hand.some((o) => o !== c && !o.isLand && o.mv >= 5 && (o.creature || o.rock > 0 || o.drawPerTurn > 0)));
        if (cheatSpell) {
          mana -= cheatSpell.mv;
          if (cheatSpell.cheat === "turn") {
            materialise(cheatSpell);
          } else {
            hand.splice(hand.indexOf(cheatSpell), 1);
            const best = hand.filter((o) => !o.isLand && o.mv >= 5 && (o.creature || o.rock > 0 || o.drawPerTurn > 0)).sort((a, b) => b.mv - a.mv)[0];
            if (best) materialise(best);
          }
          progress = true;
          continue;
        }

        // 7. The best permanent that fits: a threat, an engine, a combo piece.
        const isPiece = (c: SimCard) => lethalLines.some((l) => l.pieces.includes(c.key) || l.anyOf.includes(c.key));
        const candidates = hand.filter(
          (c) =>
            !c.isLand &&
            c.mv <= mana &&
            (c.creature || c.anthem > 0 || c.extraCombat === "permanent" || c.drawPerTurn > 0 || c.drainPerTurn > 0 || c.equipBonus > 0 || isPiece(c))
        );
        if (candidates.length) {
          const score = (c: SimCard) =>
            (isPiece(c) ? 50 : 0) + c.power * 2 + c.anthem * Math.max(1, creatures.length) + c.drainPerTurn * 3 + c.drawPerTurn * 4 + (c.extraCombat ? 6 : 0) + c.equipBonus + c.mv;
          candidates.sort((a, b) => score(b) - score(a));
          const c = candidates[0]!;
          mana -= c.mv;
          hand.splice(hand.indexOf(c), 1);
          battlefieldKeys.add(c.key);
          if (c.creature) creatures.push({ power: c.power, castTurn: t, haste: c.haste, infect: c.infect, isCommander: false, bonus: 0 });
          if (c.anthem) anthems += c.anthem;
          if (c.extraCombat === "permanent") extraCombatPerm = true;
          if (c.drawPerTurn) drawEngines += c.drawPerTurn;
          drainPerTurn += c.drainPerTurn;
          if (c.equipBonus) equipmentOnBoard.push({ bonus: c.equipBonus, cost: c.equipCost, attached: false });
          if (c.cheat === "turn") cheatEngines += 1;
          progress = true;
          continue;
        }

        // 8. Equip whatever is lying around onto the biggest body.
        const eq = equipmentOnBoard.find((e) => !e.attached && e.cost <= mana);
        if (eq && creatures.length) {
          const target = creatures.find((c) => c.isCommander) ?? creatures.reduce((b, c) => (c.power > b.power ? c : b));
          target.bonus += eq.bonus;
          eq.attached = true;
          mana -= eq.cost;
          progress = true;
          continue;
        }

        // 9. Mana that would otherwise go unused buys cards.
        const spare = hand.find((c) => c.drawNow > 0 && c.mv <= mana && !c.creature);
        if (spare) {
          mana -= spare.mv;
          hand.splice(hand.indexOf(spare), 1);
          draw(spare.drawNow);
          progress = true;
          continue;
        }
      }
      if (won) break;

      // Combat and drains.
      const att = attackers();
      let damage = 0;
      let infectDamage = 0;
      for (const c of att) {
        const p = c.power + c.bonus + anthems;
        if (c.infect) infectDamage += p;
        else {
          damage += p;
          if (c.isCommander) commanderDamage += p * (extraCombatPerm ? 2 : 1);
        }
      }
      damage *= extraCombatPerm ? 2 : 1;
      infectDamage *= extraCombatPerm ? 2 : 1;
      life -= damage + drainPerTurn;
      poison += infectDamage;
      if (life <= 0 || poison >= 10 || commanderDamage >= 21) won = t;
    }

    if (won) {
      wonAt.push(won);
      if (wonBy === "combo") comboWins++;
      else combatWins++;
    }
  }

  const wonByTurn: number[] = new Array(MAX_TURN + 1).fill(0);
  for (const t of wonAt) for (let i = t; i <= MAX_TURN; i++) wonByTurn[i]! += 1 / hands;

  // The fundamental turn: the first turn half the hands have taken a player
  // out. When the turn before was already close, the deck straddles the two
  // and reads the half-step; "if you are torn, take the slower turn" is the
  // 0.35 below rather than 0.5.
  let T = MAX_TURN;
  for (let t = 1; t <= MAX_TURN; t++) {
    if (wonByTurn[t]! >= 0.5) {
      T = t;
      break;
    }
  }
  let fundamentalTurn = T;
  if (wonByTurn[T]! >= 0.5 && T > 1) {
    const before = wonByTurn[T - 1]!;
    const p = (0.5 - before) / Math.max(1e-9, wonByTurn[T]! - before);
    if (p <= 0.35) fundamentalTurn = T - 0.5;
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const manaOnTurn = { 3: mean(manaSamples[3]!), 4: mean(manaSamples[4]!), 5: mean(manaSamples[5]!) };
  const noWin = hands - wonAt.length;
  const pct = (n: number) => `${Math.round((n / hands) * 100)}%`;
  const notes: string[] = [];
  notes.push(
    `${hands} goldfish hands: a player out by turn ${Math.ceil(fundamentalTurn)} in ${pct(wonAt.filter((t) => t <= Math.ceil(fundamentalTurn)).length)} of them.`
  );
  if (comboWins > 0) notes.push(`${pct(comboWins)} of hands won with a combo line, ${pct(combatWins)} in combat.`);
  else notes.push(`Every kill was in combat or by drain; no combo line fired.`);
  notes.push(`Average mana on turn 4: ${manaOnTurn[4].toFixed(1)}.`);
  if (noWin > hands * 0.5) notes.push(`${pct(noWin)} of hands had not taken a player out by turn ${MAX_TURN}.`);

  return {
    fundamentalTurn,
    wonByTurn,
    hands,
    comboWins,
    combatWins,
    noWin,
    manaOnTurn,
    notes,
  };
}
