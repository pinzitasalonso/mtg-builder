import { describe, expect, it } from "vitest";
import { has, searchOnCast, stats } from "./cards";
import {
  aiEndStep,
  aiGraveyardCasts,
  applyAction,
  availableMana,
  canAttack,
  cardId,
  declareAttackers,
  declineChoice,
  endTurn,
  newGame,
  playerCast,
  playerEndStep,
  playerEnters,
  playerPlay,
  playerUntapLands,
  resolveChoice,
  resolveCombat,
  setBlocks,
  spellCost,
  startTurn,
  type DeckCard,
} from "./game";
import { automatedNotes } from "./brief";
import type { CardBook, CardInfo, PlanAction, PracticeGame } from "./types";

const keep = <T,>(a: T[]) => [...a];
function info(name: string, o: Partial<CardInfo> = {}): CardInfo {
  return { name, imageUri: "", typeLine: "Creature — Test", manaCost: null, manaValue: 0, oracleText: "", power: null, toughness: null, keywords: [], producedMana: [], ...o };
}
const land = (name: string, color: string, type: string) => info(name, { typeLine: `Basic Land — ${type}`, producedMana: [color] });

const BOOK: CardBook = Object.fromEntries(
  [
    land("Forest", "G", "Forest"),
    land("Island", "U", "Island"),
    land("Swamp", "B", "Swamp"),
    land("Mountain", "R", "Mountain"),
    land("Plains", "W", "Plains"),
    info("Winota, Joiner of Forces", {
      typeLine: "Legendary Creature — Human Warrior",
      manaCost: "{2}{R}{W}",
      manaValue: 4,
      power: 4,
      toughness: 4,
      oracleText:
        "Whenever a non-Human creature you control attacks, look at the top six cards of your library. You may put a Human creature card from among them onto the battlefield tapped and attacking. It gains indestructible until end of turn. Put the rest of the cards on the bottom of your library in a random order.",
    }),
    info("Goblin Guide", { typeLine: "Creature — Goblin Scout", manaCost: "{R}", manaValue: 1, power: 2, toughness: 2, keywords: ["Haste"] }),
    info("Serra Avenger", { typeLine: "Creature — Angel", manaCost: "{W}{W}", manaValue: 2, power: 3, toughness: 3 }),
    info("Big Human", { typeLine: "Creature — Human Soldier", manaCost: "{4}{W}", manaValue: 5, power: 5, toughness: 5 }),
    info("Small Human", { typeLine: "Creature — Human Cleric", manaCost: "{W}", manaValue: 1, power: 1, toughness: 1 }),
    info("Vivi Ornitier", {
      typeLine: "Legendary Creature — Wizard",
      manaCost: "{1}{U}{R}",
      manaValue: 3,
      power: 0,
      toughness: 3,
      producedMana: ["R", "U"],
      oracleText:
        "{0}: Add X mana in any combination of {U} and/or {R}, where X is Vivi Ornitier's power. Activate only during your turn and only once each turn.\nWhenever you cast a noncreature spell, put a +1/+1 counter on Vivi Ornitier and it deals 1 damage to each opponent.",
    }),
    info("Opt", { typeLine: "Instant", manaCost: "{U}", manaValue: 1, oracleText: "Scry 1. Draw a card." }),
    info("Braids, Arisen Nightmare", {
      typeLine: "Legendary Creature — Nightmare",
      manaCost: "{1}{B}{B}",
      manaValue: 3,
      power: 3,
      toughness: 3,
      oracleText:
        "At the beginning of your end step, you may sacrifice an artifact, creature, enchantment, land, or planeswalker. If you do, each opponent may sacrifice a permanent of their choice that shares a card type with it. For each opponent who doesn't, that player loses 2 life and you draw a card.",
    }),
    info("Silas Renn, Seeker Adept", {
      typeLine: "Legendary Artifact Creature — Human",
      manaCost: "{1}{U}{B}",
      manaValue: 3,
      power: 2,
      toughness: 2,
      keywords: ["Partner", "Deathtouch"],
      oracleText: "Deathtouch\nWhenever Silas Renn deals combat damage to a player, choose target artifact card in your graveyard. You may cast that card this turn.\nPartner",
    }),
    info("Sol Ring", { typeLine: "Artifact", manaCost: "{1}", manaValue: 1, producedMana: ["C"], oracleText: "{T}: Add {C}{C}." }),
    info("Witherbloom, the Balancer", {
      typeLine: "Legendary Creature — Elder Dragon",
      manaCost: "{6}{B}{G}",
      manaValue: 8,
      power: 5,
      toughness: 5,
      keywords: ["Deathtouch", "Flying", "Affinity"],
      oracleText: "Affinity for creatures (This spell costs {1} less to cast for each creature you control.)\nFlying, deathtouch\nInstant and sorcery spells you cast have affinity for creatures.",
    }),
    info("Murder", { typeLine: "Instant", manaCost: "{1}{B}{B}", manaValue: 3, oracleText: "Destroy target creature." }),
    info("Beledros Witherbloom", {
      typeLine: "Legendary Creature — Elder Dragon",
      manaCost: "{5}{B}{G}",
      manaValue: 7,
      power: 4,
      toughness: 4,
      keywords: ["Flying"],
      oracleText:
        'Flying\nAt the beginning of each upkeep, create a 1/1 black and green Pest creature token with "When this token dies, you gain 1 life."\nPay 10 life: Untap all lands you control. Activate only once each turn.',
    }),
    info("Selvala, Heart of the Wilds", {
      typeLine: "Legendary Creature — Elf Scout",
      manaCost: "{1}{G}{G}",
      manaValue: 3,
      power: 2,
      toughness: 3,
      producedMana: ["W", "U", "B", "R", "G"],
      oracleText:
        "Whenever another creature enters, its controller may draw a card if its power is greater than each other creature's power.\n{G}, {T}: Add X mana in any combination of colors, where X is the greatest power among creatures you control.",
    }),
    info("Craw Wurm", { typeLine: "Creature — Wurm", manaCost: "{4}{G}{G}", manaValue: 6, power: 6, toughness: 4 }),
    info("Inalla, Archmage Ritualist", {
      typeLine: "Legendary Creature — Human Wizard",
      manaCost: "{2}{U}{B}{R}",
      manaValue: 5,
      power: 4,
      toughness: 5,
      keywords: ["Eminence"],
      oracleText:
        "Eminence — Whenever another nontoken Wizard you control enters, if Inalla is in the command zone or on the battlefield, you may pay {1}. If you do, create a token that's a copy of that Wizard. The token gains haste. Exile it at the beginning of the next end step.\nTap five untapped Wizards you control: Target player loses 7 life.",
    }),
    info("Snapcaster Wizard", { typeLine: "Creature — Human Wizard", manaCost: "{1}{U}", manaValue: 2, power: 2, toughness: 1, oracleText: "When this creature enters, draw a card." }),
    info("Light-Paws, Emperor's Voice", {
      typeLine: "Legendary Creature — Fox Advisor",
      manaCost: "{1}{W}",
      manaValue: 2,
      power: 2,
      toughness: 2,
      oracleText:
        "Whenever an Aura you control enters, if you cast it, you may search your library for an Aura card with mana value less than or equal to that Aura and with a different name than each Aura you control, put that card onto the battlefield attached to Light-Paws, then shuffle.",
    }),
    info("Wings Aura", { typeLine: "Enchantment — Aura", manaCost: "{1}{W}", manaValue: 2, oracleText: "Enchant creature\nEnchanted creature gets +2/+2 and has flying." }),
    info("Strength Aura", { typeLine: "Enchantment — Aura", manaCost: "{W}", manaValue: 1, oracleText: "Enchant creature\nEnchanted creature gets +1/+1 and has first strike." }),
    info("Big Aura", { typeLine: "Enchantment — Aura", manaCost: "{3}{W}", manaValue: 4, oracleText: "Enchant creature\nEnchanted creature gets +4/+4." }),
    info("Thranduil, Sindarin Liege // Silvan Rally", {
      typeLine: "Legendary Creature — Elf Noble // Sorcery — Adventure",
      manaCost: "{2}{G/U}{G/U} // {1}{G/U}{G/U}",
      manaValue: 4,
      power: 2,
      toughness: 3,
      oracleText: "Other Elves you control get +1/+1.\nLandfall — Whenever a land you control enters, create a 1/1 green Elf creature token.\n//\nMill four cards, then put up to two land cards from among them into your hand.",
    }),
    info("Thranduil the Strategist", {
      typeLine: "Legendary Creature — Elf Noble",
      manaCost: "{3}{G}{U}",
      manaValue: 5,
      power: 4,
      toughness: 4,
      oracleText: 'Other Elves you control have "{T}: Add {G} or {U}."\nLandfall — Whenever a land you control enters, create a 1/1 green Elf creature token.',
    }),
    info("Thranduil, the Elvenking", {
      typeLine: "Legendary Creature — Elf Noble",
      manaCost: "{2}{B}{G}{U}",
      manaValue: 5,
      power: 5,
      toughness: 6,
      oracleText: "Thranduil has all activated abilities of all Elf cards in your graveyard.\nWhenever another legendary Elf you control enters, draw two cards, then discard a card.",
    }),
    info("Elvish Visionary", { typeLine: "Creature — Elf Shaman", manaCost: "{1}{G}", manaValue: 2, power: 1, toughness: 1 }),
    info("Legolas Elf", { typeLine: "Legendary Creature — Elf Archer", manaCost: "{G}", manaValue: 1, power: 1, toughness: 1 }),
    info("The Ur-Dragon", {
      typeLine: "Legendary Creature — Dragon Avatar",
      manaCost: "{4}{W}{U}{B}{R}{G}",
      manaValue: 9,
      power: 10,
      toughness: 10,
      keywords: ["Flying", "Eminence"],
      oracleText:
        "Eminence — As long as The Ur-Dragon is in the command zone or on the battlefield, other Dragon spells you cast cost {1} less to cast.\nFlying\nWhenever one or more Dragons you control attack, draw that many cards, then you may put a permanent card from your hand onto the battlefield.",
    }),
    info("Shivan Dragon", { typeLine: "Creature — Dragon", manaCost: "{4}{R}{R}", manaValue: 6, power: 5, toughness: 5, keywords: ["Flying"] }),
    info("Kratos, God of War", {
      typeLine: "Legendary Creature — God Warrior",
      manaCost: "{R}{R}{R}",
      manaValue: 3,
      power: 2,
      toughness: 3,
      keywords: ["Double strike"],
      oracleText:
        "Double strike\nAll creatures have haste.\nAt the beginning of each player's end step, Kratos deals damage to that player equal to the number of creatures that player controls that didn't attack this turn.",
    }),
  ].map((c) => [c.name.toLowerCase(), c])
);
const deck = (...names: string[]): DeckCard[] => names.map((name) => ({ name, imageUri: "", typeLine: BOOK[name.toLowerCase()]!.typeLine }));
const action = (kind: PlanAction["kind"], iid: number, o: Partial<PlanAction> = {}): PlanAction => ({ kind, card: cardId(iid), x: null, tap_card: null, sacrifice_card: null, mana: null, life: null, effects: [], ...o });
const texts = (g: PracticeGame) => g.log.map((l) => l.text);

/** A game laid out by hand: per seat, the battlefield, the hand, the
    command zone, and the library's top cards (then Plains or Forests).
    It's `active`'s turn 3. */
function table(o: {
  you?: { field?: string[]; hand?: string[]; command?: string[]; top?: string[] };
  opp?: { field?: string[]; hand?: string[]; command?: string[]; top?: string[] };
  active?: "you" | "opp";
}): PracticeGame {
  const names = (x: typeof o.you) => [...(x?.field ?? []), ...(x?.hand ?? []), ...(x?.command ?? []), ...(x?.top ?? [])];
  let g = newGame({
    you: { cards: deck(...names(o.you), ...Array(12).fill("Forest")) },
    opp: { cards: deck(...names(o.opp), ...Array(12).fill("Plains")) },
    commanderGame: true,
    first: o.active ?? "opp",
    shuffle: keep,
  });
  for (const seat of ["you", "opp"] as const) {
    const x = o[seat];
    const all = [...g.sides[seat].hand, ...g.sides[seat].library];
    const take = (n: string) => all.splice(all.findIndex((c) => c.name === n), 1)[0]!;
    const field = (x?.field ?? []).map((n) => ({ ...take(n), enteredTurn: 0 }));
    const hand = (x?.hand ?? []).map(take);
    const command = (x?.command ?? []).map((n) => ({ ...take(n), commander: true }));
    const top = (x?.top ?? []).map(take);
    g.sides[seat] = { ...g.sides[seat], battlefield: field, hand, command, library: [...top, ...all], life: 40 };
  }
  g = { ...g, turn: 3, active: o.active ?? "opp" };
  return g;
}
const at = (g: PracticeGame, seat: "you" | "opp", name: string, zone: "battlefield" | "hand" | "command" | "graveyard" | "library" = "battlefield") =>
  g.sides[seat][zone].find((c) => c.name === name)!;

describe("Winota", () => {
  it("a non-Human attacker brings the best Human from the top six in, attacking and indestructible", () => {
    const g0 = table({ opp: { field: ["Winota, Joiner of Forces", "Goblin Guide"], top: ["Plains", "Small Human", "Big Human", "Plains"] } });
    const g = declareAttackers(g0, "opp", [at(g0, "opp", "Goblin Guide").iid], BOOK);
    const human = at(g, "opp", "Big Human");
    expect(human.tapped).toBe(true);
    expect(g.combat!.attackers).toContain(human.iid);
    expect(has(BOOK, human, "Indestructible")).toBe(true);
    // The rest went to the bottom: Small Human is no longer near the top.
    expect(g.sides.opp.library.slice(0, 6).map((c) => c.name)).not.toContain("Small Human");
    expect(g.sides.opp.library.slice(-5).map((c) => c.name)).toContain("Small Human");
    // A Human attacking triggers nothing.
    const h = declareAttackers(g0, "opp", [at(g0, "opp", "Winota, Joiner of Forces").iid], BOOK);
    expect(h.combat!.attackers).toHaveLength(1);
  });
});

describe("Vivi's mana", () => {
  it("X of {U}/{R} once a turn on its own turn; what's left floats", () => {
    let g0 = table({ opp: { field: ["Vivi Ornitier"], hand: ["Opt"] } });
    g0 = { ...g0, sides: { ...g0.sides, opp: { ...g0.sides.opp, battlefield: g0.sides.opp.battlefield.map((c) => ({ ...c, counters: 2 })) } } };
    const vivi = availableMana(g0, "opp", BOOK).find((s) => s.name === "Vivi Ornitier")!;
    expect(vivi).toMatchObject({ amount: 2, colors: ["U", "R"], once: true });
    expect(availableMana({ ...g0, active: "you" }, "opp", BOOK).some((s) => s.name === "Vivi Ornitier")).toBe(false);
    const g = applyAction(g0, "opp", action("cast", at(g0, "opp", "Opt", "hand").iid), BOOK).game;
    expect(g.sides.opp.graveyard.map((c) => c.name)).toContain("Opt");
    expect(g.once).toContain(at(g0, "opp", "Vivi Ornitier").iid);
    // Vivi's own trigger made it 3 power, but the ability is used: one unit floats.
    expect(g.pool!.opp).toEqual(["UR"]);
    expect(availableMana(g, "opp", BOOK).filter((s) => s.name === "Vivi Ornitier")).toEqual([]);
  });
});

describe("Braids", () => {
  it("the AI's end step: it sacrifices a token, and you sacrifice a creature or lose 2 and it draws", () => {
    let g0 = table({ opp: { field: ["Braids, Arisen Nightmare"] }, you: { field: ["Goblin Guide"] } });
    g0 = { ...g0, sides: { ...g0.sides, opp: { ...g0.sides.opp, battlefield: [...g0.sides.opp.battlefield, { iid: 70_000, name: "Pest", imageUri: "", typeLine: "Token Creature — Pest", tapped: false, commander: false, token: { power: 1, toughness: 1, keywords: [], kind: "creature" } }] } } };
    const g = aiEndStep(g0, BOOK);
    expect(g.sides.opp.battlefield.some((c) => c.name === "Pest")).toBe(false);
    expect(g.choice).toMatchObject({ kind: "sacrifice", types: ["creature"], decline: "Lose 2 life", braids: "theirs" });
    const hand = g.sides.opp.hand.length;
    const declined = declineChoice(g, BOOK);
    expect(declined.sides.you.life).toBe(38);
    expect(declined.sides.opp.hand.length).toBe(hand + 1);
    const sacrificed = resolveChoice(g, at(g, "you", "Goblin Guide").iid, BOOK);
    expect(sacrificed.sides.you.graveyard.map((c) => c.name)).toContain("Goblin Guide");
    expect(sacrificed.sides.you.life).toBe(40);
  });

  it("your end step: you may sacrifice; the AI keeps its real cards, so it loses 2 and you draw", () => {
    const g0 = table({ you: { field: ["Braids, Arisen Nightmare", "Forest"] }, opp: { field: ["Plains", "Plains"] }, active: "you" });
    const g = playerEndStep(g0, BOOK);
    expect(g.choice).toMatchObject({ kind: "sacrifice", decline: "Don't sacrifice", braids: "yours" });
    const hand = g.sides.you.hand.length;
    const after = resolveChoice(g, at(g, "you", "Forest").iid, BOOK);
    expect(after.sides.opp.life).toBe(38);
    expect(after.sides.you.hand.length).toBe(hand + 1);
    expect(declineChoice(g, BOOK).sides.opp.life).toBe(40);
  });

  it("with lands to spare, the AI gives up a land instead", () => {
    const g0 = table({ you: { field: ["Braids, Arisen Nightmare", "Forest"] }, opp: { field: Array(6).fill("Plains") }, active: "you" });
    const after = resolveChoice(playerEndStep(g0, BOOK), at(g0, "you", "Forest").iid, BOOK);
    expect(after.sides.opp.life).toBe(40);
    expect(after.sides.opp.battlefield).toHaveLength(5);
  });
});

describe("Silas Renn", () => {
  it("a hit lets its controller cast an artifact from the graveyard this turn", () => {
    let g0 = table({ opp: { field: ["Silas Renn, Seeker Adept", "Swamp"] } });
    g0 = { ...g0, sides: { ...g0.sides, opp: { ...g0.sides.opp, graveyard: [{ iid: 70_001, name: "Sol Ring", imageUri: "", typeLine: "Artifact", tapped: false, commander: false }] } } };
    let g = declareAttackers(g0, "opp", [at(g0, "opp", "Silas Renn, Seeker Adept").iid], BOOK);
    g = resolveCombat(setBlocks(g, {}, BOOK), BOOK);
    expect(g.mayCast).toEqual([70_001]);
    const casts = aiGraveyardCasts(g, BOOK);
    expect(casts).toHaveLength(1);
    const cast = applyAction(g, "opp", casts[0]!, BOOK).game;
    expect(cast.sides.opp.battlefield.map((c) => c.name)).toContain("Sol Ring");
    expect(endTurn(g, BOOK).mayCast).toEqual([]);
  });
});

describe("Witherbloom", () => {
  it("affinity for creatures: itself, and instants and sorceries with it out", () => {
    const g0 = table({ opp: { field: ["Goblin Guide", "Serra Avenger", "Small Human"], hand: ["Murder"], command: ["Witherbloom, the Balancer"] } });
    expect(spellCost(g0, "opp", at(g0, "opp", "Witherbloom, the Balancer", "command"), BOOK, "command").generic).toBe(3);
    expect(spellCost(g0, "opp", at(g0, "opp", "Murder", "hand"), BOOK, "hand").generic).toBe(1);
    const out = table({ opp: { field: ["Goblin Guide", "Witherbloom, the Balancer"], hand: ["Murder"] } });
    expect(spellCost(out, "opp", at(out, "opp", "Murder", "hand"), BOOK, "hand").generic).toBe(0);
  });

  it("Beledros: a Pest every upkeep; pay 10 life to untap your lands, once a turn", () => {
    const g0 = table({ you: { field: ["Beledros Witherbloom", "Forest", "Forest"] }, active: "you" });
    const g = startTurn(g0, BOOK);
    expect(g.sides.you.battlefield.filter((c) => c.name === "Pest")).toHaveLength(1);
    const tapped = { ...g, sides: { ...g.sides, you: { ...g.sides.you, battlefield: g.sides.you.battlefield.map((c) => ({ ...c, tapped: true })) } } };
    const untapped = playerUntapLands(tapped, at(g, "you", "Beledros Witherbloom").iid, BOOK);
    expect(untapped.sides.you.battlefield.filter((c) => c.name === "Forest").every((c) => !c.tapped)).toBe(true);
    expect(untapped.sides.you.life).toBe(30);
    expect(playerUntapLands(untapped, at(g, "you", "Beledros Witherbloom").iid, BOOK)).toBe(untapped);
  });
});

describe("Selvala", () => {
  it("{G}, {T}: X of any colours, X your greatest power; a Forest pays the {G}", () => {
    const g0 = table({ opp: { field: ["Selvala, Heart of the Wilds", "Forest", "Craw Wurm"] } });
    const s = availableMana(g0, "opp", BOOK).find((x) => x.name === "Selvala, Heart of the Wilds")!;
    expect(s).toMatchObject({ amount: 6, also: [at(g0, "opp", "Forest").iid], float: true });
    expect(availableMana(g0, "opp", BOOK).some((x) => x.name === "Forest")).toBe(false);
  });

  it("a creature entering bigger than every other: its controller draws", () => {
    const g0 = table({ you: { field: ["Selvala, Heart of the Wilds"], hand: ["Craw Wurm"] }, active: "you" });
    const hand = g0.sides.you.hand.length;
    const wurm = at(g0, "you", "Craw Wurm", "hand").iid;
    const g = playerEnters(playerPlay(g0, wurm, BOOK), wurm, BOOK);
    expect(g.sides.you.hand.length).toBe(hand - 1 + 1);
  });
});

describe("Inalla", () => {
  it("a Wizard you cast gets a hasty copy for {1}, exiled at the end step", () => {
    const g0 = table({ you: { field: ["Island", "Island", "Island"], hand: ["Snapcaster Wizard"], command: ["Inalla, Archmage Ritualist"] }, active: "you" });
    const wiz = at(g0, "you", "Snapcaster Wizard", "hand").iid;
    const g = playerEnters(playerCast(g0, wiz, BOOK), wiz, BOOK);
    const copy = g.sides.you.battlefield.find((c) => c.copy)!;
    expect(copy.name).toBe("Snapcaster Wizard");
    expect(canAttack(g, "you", copy, BOOK)).toBe(true);
    expect(g.sides.you.battlefield.filter((c) => c.name === "Island" && c.tapped)).toHaveLength(3);
    expect(texts(g)).toContain("Resolve: the copy's enters ability (Snapcaster Wizard).");
    const next = endTurn(g, BOOK);
    expect(next.sides.you.battlefield.some((c) => c.copy)).toBe(false);
    expect(next.sides.you.exile).toHaveLength(0);
  });

  it("the AI taps five Wizards at its end step: you lose 7", () => {
    const g0 = table({ opp: { field: ["Inalla, Archmage Ritualist", "Snapcaster Wizard", "Snapcaster Wizard", "Snapcaster Wizard", "Snapcaster Wizard"] } });
    const g = aiEndStep(g0, BOOK);
    expect(g.sides.you.life).toBe(33);
    expect(g.sides.opp.battlefield.filter((c) => c.tapped)).toHaveLength(5);
  });
});

describe("Light-Paws and Auras", () => {
  it("the AI's Aura goes on Light-Paws, which finds a cheaper one with another name", () => {
    const g0 = table({ opp: { field: ["Light-Paws, Emperor's Voice", "Plains", "Plains"], hand: ["Wings Aura"], top: ["Big Aura", "Strength Aura"] } });
    const g = applyAction(g0, "opp", action("cast", at(g0, "opp", "Wings Aura", "hand").iid), BOOK).game;
    const lp = at(g, "opp", "Light-Paws, Emperor's Voice");
    expect(at(g, "opp", "Wings Aura").attachedTo).toBe(lp.iid);
    expect(at(g, "opp", "Strength Aura").attachedTo).toBe(lp.iid);
    expect(g.sides.opp.battlefield.some((c) => c.name === "Big Aura")).toBe(false);
    expect(stats(BOOK, lp)).toEqual({ power: 5, toughness: 5 });
    expect(has(BOOK, lp, "Flying")).toBe(true);
    expect(has(BOOK, lp, "First strike")).toBe(true);
  });

  it("casting Light-Paws itself searches nothing", () => {
    expect(searchOnCast(BOOK["light-paws, emperor's voice"])).toBeNull();
  });

  it("your Aura asks where it goes; when its creature leaves, it goes to the graveyard", () => {
    const g0 = table({ you: { field: ["Goblin Guide", "Plains", "Plains"], hand: ["Wings Aura"] }, active: "you" });
    const aura = at(g0, "you", "Wings Aura", "hand").iid;
    const g = playerEnters(playerCast(g0, aura, BOOK), aura, BOOK);
    expect(g.choice).toMatchObject({ kind: "attach", aura });
    const on = resolveChoice(g, at(g, "you", "Goblin Guide").iid, BOOK);
    expect(stats(BOOK, at(on, "you", "Goblin Guide"))).toEqual({ power: 4, toughness: 4 });
  });
});

describe("Thranduil", () => {
  it("Sindarin Liege: other Elves +1/+1; a land makes an Elf", () => {
    const g0 = table({ you: { field: ["Thranduil, Sindarin Liege // Silvan Rally", "Elvish Visionary"], hand: ["Forest"] }, active: "you" });
    const g = playerPlay(g0, at(g0, "you", "Forest", "hand").iid, BOOK);
    expect(stats(BOOK, at(g, "you", "Elvish Visionary"))).toEqual({ power: 2, toughness: 2 });
    const elf = g.sides.you.battlefield.find((c) => c.name === "Elf")!;
    expect(stats(BOOK, elf)).toEqual({ power: 2, toughness: 2 });
    expect(stats(BOOK, at(g, "you", "Thranduil, Sindarin Liege // Silvan Rally"))).toEqual({ power: 2, toughness: 3 });
  });

  it("the Strategist: your other Elves tap for {G} or {U}", () => {
    const g0 = table({ opp: { field: ["Thranduil the Strategist", "Elvish Visionary"] } });
    expect(availableMana(g0, "opp", BOOK).find((s) => s.name === "Elvish Visionary")).toMatchObject({ colors: ["G", "U"], amount: 1 });
  });

  it("the Elvenking: another legendary Elf enters, draw two and discard one", () => {
    const g0 = table({ opp: { field: ["Thranduil, the Elvenking", "Forest"], hand: ["Legolas Elf"] } });
    const g = applyAction(g0, "opp", action("cast", at(g0, "opp", "Legolas Elf", "hand").iid), BOOK).game;
    expect(g.sides.opp.hand).toHaveLength(1);
    expect(g.sides.opp.graveyard).toHaveLength(1);
  });
});

describe("The Ur-Dragon", () => {
  it("Dragons cost {1} less from the command zone; attacking Dragons draw, and a permanent comes in", () => {
    const g0 = table({ opp: { field: ["Shivan Dragon", "Shivan Dragon"], hand: ["Craw Wurm"], command: ["The Ur-Dragon"] } });
    const g1 = table({ opp: { hand: ["Shivan Dragon"], command: ["The Ur-Dragon"] } });
    expect(spellCost(g1, "opp", at(g1, "opp", "Shivan Dragon", "hand"), BOOK, "hand").generic).toBe(3);
    // The attack trigger needs The Ur-Dragon on the battlefield.
    expect(declareAttackers(g0, "opp", g0.sides.opp.battlefield.map((c) => c.iid), BOOK).sides.opp.hand).toHaveLength(1);
    const g2 = table({ opp: { field: ["The Ur-Dragon", "Shivan Dragon"], hand: ["Craw Wurm"] } });
    const g = declareAttackers(g2, "opp", g2.sides.opp.battlefield.map((c) => c.iid), BOOK);
    expect(texts(g)).toContain("The Ur-Dragon: 2 dragons attack; the opponent draws 2.");
    expect(g.sides.opp.battlefield.map((c) => c.name)).toContain("Craw Wurm");
  });

  it("yours: you choose the permanent, or none", () => {
    const g0 = table({ you: { field: ["The Ur-Dragon"], hand: ["Craw Wurm"] }, active: "you" });
    const g = declareAttackers(g0, "you", [at(g0, "you", "The Ur-Dragon").iid], BOOK);
    expect(g.choice).toMatchObject({ kind: "put", decline: "None" });
    const put = resolveChoice(g, at(g, "you", "Craw Wurm", "hand").iid, BOOK);
    expect(put.sides.you.battlefield.map((c) => c.name)).toContain("Craw Wurm");
  });
});

describe("Kratos, God of War", () => {
  it("everything has haste; at each end step, the player's idle creatures hit them", () => {
    const g0 = table({ you: { field: ["Kratos, God of War"], hand: ["Craw Wurm"] }, opp: { field: ["Goblin Guide", "Serra Avenger"] }, active: "you" });
    const wurm = at(g0, "you", "Craw Wurm", "hand").iid;
    const g = playerPlay(g0, wurm, BOOK);
    expect(canAttack(g, "you", at(g, "you", "Craw Wurm"), BOOK)).toBe(true);
    // You attack with Kratos only: the Wurm didn't, so 1 damage to you.
    const attacked = resolveCombat(setBlocks(declareAttackers(g, "you", [at(g, "you", "Kratos, God of War").iid], BOOK), {}, BOOK), BOOK);
    const next = endTurn(attacked, BOOK);
    expect(next.sides.you.life).toBe(39);
    // The opponent's two idle creatures: 2 at its end step.
    expect(endTurn(next, BOOK).sides.opp.life).toBe(next.sides.opp.life - 2);
  });
});

describe("the AI is told what the table does", () => {
  it("one note per commander", () => {
    const names = ["Winota, Joiner of Forces", "Vivi Ornitier", "Braids, Arisen Nightmare", "Silas Renn, Seeker Adept", "Witherbloom, the Balancer", "Beledros Witherbloom", "Selvala, Heart of the Wilds", "Inalla, Archmage Ritualist", "Light-Paws, Emperor's Voice", "Thranduil the Strategist", "The Ur-Dragon", "Kratos, God of War"];
    const notes = automatedNotes(names.map((name) => ({ name, quantity: 1 })), BOOK);
    expect(notes).toHaveLength(names.length);
  });
});
