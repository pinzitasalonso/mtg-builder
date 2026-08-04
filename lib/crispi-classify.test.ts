import { describe, it, expect } from "vitest";
import {
  classify,
  manaValue,
  isTutor,
  isCounterspell,
  isInteraction,
  isDrawish,
  isSymmetricWipe,
  type ClassifiableCard,
} from "./crispi-classify";
import { consistencyScore, interactionScore, crispiScore, speedFromFundamentalTurn, resilienceScore } from "./crispi";

const card = (over: Partial<ClassifiableCard> & { name: string }): ClassifiableCard => ({
  typeLine: "Sorcery",
  oracleText: "",
  manaCost: "{1}",
  quantity: 1,
  ...over,
});

const DEMONIC_TUTOR = card({
  name: "Demonic Tutor",
  manaCost: "{1}{B}",
  oracleText: "Search your library for a card, put that card into your hand, then shuffle.",
});
const SWORDS = card({
  name: "Swords to Plowshares",
  typeLine: "Instant",
  manaCost: "{W}",
  oracleText: "Exile target creature. Its controller gains life equal to its power.",
});
const COUNTERSPELL = card({
  name: "Counterspell",
  typeLine: "Instant",
  manaCost: "{U}{U}",
  oracleText: "Counter target spell.",
});
const FORCE_OF_WILL = card({
  name: "Force of Will",
  typeLine: "Instant",
  manaCost: "{0}",
  oracleText: "Counter target spell.",
});
const WRATH = card({
  name: "Wrath of God",
  manaCost: "{2}{W}{W}",
  oracleText: "Destroy all creatures. They can't be regenerated.",
});
const DIVINATION = card({
  name: "Divination",
  manaCost: "{2}{U}",
  oracleText: "Draw two cards.",
});
const ISLAND = card({ name: "Island", typeLine: "Basic Land — Island", manaCost: null, oracleText: "({T}: Add {U}.)" });

describe("manaValue", () => {
  it("adds generic and pips", () => {
    expect(manaValue("{2}{U}{U}")).toBe(4);
    expect(manaValue("{W}")).toBe(1);
    expect(manaValue("{0}")).toBe(0);
    expect(manaValue(null)).toBe(0);
  });

  it("treats X as zero, the way mana value does on the stack", () => {
    expect(manaValue("{X}{R}")).toBe(1);
  });

  it("counts hybrid and phyrexian pips as one each", () => {
    expect(manaValue("{W/U}{B/P}")).toBe(2);
  });
});

describe("text signals", () => {
  it("reads a tutor off 'search your library'", () => {
    expect(isTutor(DEMONIC_TUTOR)).toBe(true);
    expect(isTutor(DIVINATION)).toBe(false);
  });

  it("does not call a fetchland a tutor", () => {
    const fetch = card({
      name: "Polluted Delta",
      typeLine: "Land",
      manaCost: null,
      oracleText: "{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Swamp card...",
    });
    expect(isTutor(fetch)).toBe(false);
  });

  it("reads counterspells", () => {
    expect(isCounterspell(COUNTERSPELL)).toBe(true);
    expect(isCounterspell(SWORDS)).toBe(false);
  });

  it("counts a counterspell as interaction too", () => {
    expect(isInteraction(COUNTERSPELL)).toBe(true);
    expect(isInteraction(SWORDS)).toBe(true);
    expect(isInteraction(DIVINATION)).toBe(false);
  });

  it("reads draw but not a symmetric gift", () => {
    expect(isDrawish(DIVINATION)).toBe(true);
    const howling = card({ name: "Howling Mine", oracleText: "At the beginning of each opponent's draw step, each opponent draws an additional card." });
    expect(isDrawish(howling)).toBe(false);
  });

  it("spots a symmetric wipe", () => {
    expect(isSymmetricWipe(WRATH)).toBe(true);
    expect(isSymmetricWipe(SWORDS)).toBe(false);
  });

  it("never classifies a land as a spell", () => {
    expect(isTutor(ISLAND)).toBe(false);
    expect(isInteraction(ISLAND)).toBe(false);
    expect(isDrawish(ISLAND)).toBe(false);
  });
});

describe("classify", () => {
  const deck = [DEMONIC_TUTOR, SWORDS, COUNTERSPELL, FORCE_OF_WILL, WRATH, DIVINATION, ISLAND];

  it("prices tutors and draw at the standard tier", () => {
    const c = classify(deck);
    expect(c.consistency.tutorPoints).toBe(4); // one tutor
    expect(c.consistency.drawPoints).toBe(4); // one draw source
  });

  it("counts interaction and the stack column", () => {
    const c = classify(deck);
    // Swords, Counterspell, Force of Will, Wrath.
    expect(c.interaction.pieces).toBe(4);
    expect(c.interaction.counterspells).toBe(2);
    // 2 counters x2 + 1 free spell x2 + 3 instant-speed pieces = 9.
    expect(c.interaction.stackPoints).toBe(9);
  });

  it("reports answer scope from what the text can touch", () => {
    const c = classify(deck);
    expect(c.interaction.answersCreatures).toBe(true);
    expect(c.interaction.answersArtifacts).toBe(false);
  });

  it("respects quantity", () => {
    const c = classify([{ ...DEMONIC_TUTOR, quantity: 3 }]);
    expect(c.consistency.tutorPoints).toBe(12);
  });

  it("excludes lands from the mana average", () => {
    const c = classify([ISLAND, DIVINATION]); // Divination is 3
    expect(c.averageManaValue).toBe(3);
    expect(c.landCount).toBe(1);
  });

  it("never claims a premium tutor or a combo line", () => {
    const c = classify(deck);
    expect(c.consistency.premiumTutors).toBe(0);
    expect(c.resilience.comboLines).toBe(0);
  });

  it("names every estimate and every stub", () => {
    const c = classify(deck);
    expect(c.notes.estimated.length).toBeGreaterThan(0);
    expect(c.notes.stubbed.length).toBeGreaterThan(0);
    expect(c.notes.stubbed.join(" ")).toMatch(/premiumTutors/);
    expect(c.notes.stubbed.join(" ")).toMatch(/comboLines/);
    expect(c.notes.stubbed.join(" ")).toMatch(/fundamentalTurn/);
  });
});

describe("end to end, the way the route runs it", () => {
  const score = (cards: ClassifiableCard[]) => {
    const p = classify(cards);
    return crispiScore({
      consistency: consistencyScore(p.consistency),
      interaction: interactionScore(p.interaction),
      resilience: resilienceScore(p.resilience),
      speed: speedFromFundamentalTurn(p.fundamentalTurn),
    });
  };

  it("produces a score on the 1–10 scale", () => {
    const r = score([DEMONIC_TUTOR, SWORDS, COUNTERSPELL, WRATH, DIVINATION, ISLAND]);
    expect(r.crispi).toBeGreaterThanOrEqual(1);
    expect(r.crispi).toBeLessThanOrEqual(10);
    expect(r.display).toMatch(/^\d+\.\d{2}$/);
  });

  it("cannot exceed Consistency 8 while premium tutors are stubbed", () => {
    // Forty tutors and forty draw spells — both columns would otherwise max.
    const many: ClassifiableCard[] = [
      ...Array.from({ length: 40 }, (_, i) => ({ ...DEMONIC_TUTOR, name: `Tutor ${i}` })),
      ...Array.from({ length: 40 }, (_, i) => ({ ...DIVINATION, name: `Draw ${i}` })),
    ];
    expect(score(many).consistency).toBe(8);
  });

  it("rates a deck that answers nothing below one that does", () => {
    const vanilla = Array.from({ length: 20 }, (_, i) =>
      card({ name: `Bear ${i}`, typeLine: "Creature — Bear", oracleText: "" })
    );
    const answers = [...vanilla, ...Array.from({ length: 10 }, (_, i) => ({ ...COUNTERSPELL, name: `Counter ${i}` }))];
    expect(score(answers).interaction).toBeGreaterThan(score(vanilla).interaction);
  });
});
