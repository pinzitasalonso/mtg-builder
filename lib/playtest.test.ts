import { describe, expect, it } from "vitest";
import {
  adjustLife,
  bottomCard,
  draw,
  moveCard,
  mulligan,
  nextTurn,
  play,
  resolvesToGraveyard,
  shuffleLibrary,
  startGame,
  toggleTap,
  untapAll,
  zoneOf,
  type CardLike,
  type PlaytestState,
} from "./playtest";

// Deterministic "shuffles" so tests can reason about order.
const keep = <T,>(a: T[]) => [...a];
const reverse = <T,>(a: T[]) => [...a].reverse();

const card = (name: string, typeLine: string, quantity = 1): CardLike => ({ name, imageUri: `img:${name}`, typeLine, quantity });

function deck(): CardLike[] {
  return [
    card("Krenko, Mob Boss", "Legendary Creature — Goblin Warrior"),
    card("Mountain", "Basic Land — Mountain", 5),
    card("Lightning Bolt", "Instant", 2),
    card("Goblin Guide", "Creature — Goblin Scout", 3),
    card("Jwari Disruption // Jwari Ruins", "Instant // Land"),
  ];
}

const names = (cards: { name: string }[]) => cards.map((c) => c.name);

describe("startGame", () => {
  it("expands quantities into individual cards with unique ids and draws seven", () => {
    const s = startGame(deck(), { shuffle: keep });
    const all = [...s.library, ...s.hand, ...s.command];
    expect(all).toHaveLength(12);
    expect(new Set(all.map((c) => c.iid)).size).toBe(12);
    expect(s.hand).toHaveLength(7);
    expect(s.library).toHaveLength(5);
    expect(s.turn).toBe(1);
  });

  it("seats the commander in the command zone, out of the library", () => {
    const s = startGame(deck(), { commander: "krenko, mob boss", shuffle: keep, startingLife: 40 });
    expect(names(s.command)).toEqual(["Krenko, Mob Boss"]);
    expect(s.command[0]!.commander).toBe(true);
    expect([...s.library, ...s.hand].some((c) => c.name === "Krenko, Mob Boss")).toBe(false);
    expect(s.life).toBe(40);
    expect(s.oppLife).toBe(40);
  });

  it("seats each partner of an 'A + B' pair", () => {
    const s = startGame([...deck(), card("Thrasios", "Legendary Creature"), card("Tymna", "Legendary Creature")], {
      commander: "Thrasios + Tymna",
      shuffle: keep,
    });
    expect(names(s.command).sort()).toEqual(["Thrasios", "Tymna"]);
  });

  it("ignores a commander that isn't in the list", () => {
    const s = startGame(deck(), { commander: "Not Here", shuffle: keep });
    expect(s.command).toEqual([]);
  });
});

describe("draw", () => {
  it("takes from the top and stops at an empty library", () => {
    const s0 = startGame(deck(), { shuffle: keep });
    const top = s0.library[0]!;
    const s1 = draw(s0, 1);
    expect(s1.hand[s1.hand.length - 1]).toEqual(top);
    const s2 = draw(s1, 99);
    expect(s2.library).toHaveLength(0);
    expect(s2.hand).toHaveLength(12);
    expect(draw(s2, 1)).toBe(s2);
  });
});

describe("mulligan", () => {
  it("is a London mulligan: seven back, then one card owed to the bottom per mulligan", () => {
    const s0 = startGame(deck(), { shuffle: keep });
    const s1 = mulligan(s0, keep);
    expect(s1.hand).toHaveLength(7);
    expect(s1.mulligans).toBe(1);
    expect(s1.toBottom).toBe(1);
    const owed = s1.hand[2]!;
    const s2 = bottomCard(s1, owed.iid);
    expect(s2.hand).toHaveLength(6);
    expect(s2.toBottom).toBe(0);
    expect(s2.library[s2.library.length - 1]).toEqual(owed);
    // Nothing owed: bottomCard is a no-op.
    expect(bottomCard(s2, s2.hand[0]!.iid)).toBe(s2);
    const s3 = mulligan(s2, keep);
    expect(s3.toBottom).toBe(2);
    expect(s3.mulligans).toBe(2);
  });

  it("stops at six mulligans", () => {
    let s = startGame(deck(), { shuffle: keep });
    for (let i = 0; i < 6; i++) s = mulligan(s, keep);
    expect(s.mulligans).toBe(6);
    expect(mulligan(s, keep)).toBe(s);
  });
});

describe("play", () => {
  const withHand = (): PlaytestState => {
    // keep-order shuffle: the hand is the first seven of the list in order.
    return startGame(deck(), { commander: "Krenko, Mob Boss", shuffle: keep });
  };

  it("puts a land or creature onto the battlefield and resolves an instant to the graveyard", () => {
    const s = withHand();
    const mountain = s.hand.find((c) => c.name === "Mountain")!;
    const bolt = s.hand.find((c) => c.name === "Lightning Bolt")!;
    const s1 = play(s, mountain.iid);
    expect(zoneOf(s1, mountain.iid)).toBe("battlefield");
    const s2 = play(s1, bolt.iid);
    expect(zoneOf(s2, bolt.iid)).toBe("graveyard");
    expect(s2.graveyard[s2.graveyard.length - 1]!.iid).toBe(bolt.iid);
  });

  it("casts the commander from the command zone", () => {
    const s = withHand();
    const k = s.command[0]!;
    const s1 = play(s, k.iid);
    expect(zoneOf(s1, k.iid)).toBe("battlefield");
    expect(s1.command).toEqual([]);
    expect(s1.battlefield[0]!.commander).toBe(true);
  });

  it("reads a modal instant // land as a spell for its default play", () => {
    expect(resolvesToGraveyard("Instant // Land")).toBe(true);
    expect(resolvesToGraveyard("Land // Instant")).toBe(false);
    expect(resolvesToGraveyard("Creature — Elf")).toBe(false);
  });
});

describe("moveCard", () => {
  it("moves between any zones, arriving untapped, and honours top/bottom of library", () => {
    const s0 = startGame(deck(), { shuffle: keep });
    const c = s0.hand[0]!;
    const s1 = toggleTap(moveCard(s0, c.iid, "battlefield"), c.iid);
    expect(s1.battlefield[0]!.tapped).toBe(true);
    const s2 = moveCard(s1, c.iid, "exile");
    expect(zoneOf(s2, c.iid)).toBe("exile");
    expect(s2.exile[0]!.tapped).toBe(false);
    const s3 = moveCard(s2, c.iid, "library");
    expect(s3.library[0]!.iid).toBe(c.iid);
    const s4 = moveCard(s3, c.iid, "library", { position: "bottom" });
    expect(s4.library[s4.library.length - 1]!.iid).toBe(c.iid);
    expect(s4.library.filter((x) => x.iid === c.iid)).toHaveLength(1);
  });

  it("can return a commander to the command zone", () => {
    const s0 = startGame(deck(), { commander: "Krenko, Mob Boss", shuffle: keep });
    const k = s0.command[0]!;
    const s1 = moveCard(play(s0, k.iid), k.iid, "command");
    expect(names(s1.command)).toEqual(["Krenko, Mob Boss"]);
    expect(s1.battlefield).toEqual([]);
  });

  it("ignores an unknown card", () => {
    const s = startGame(deck(), { shuffle: keep });
    expect(moveCard(s, 999, "hand")).toBe(s);
  });
});

describe("turns", () => {
  it("toggles tap only on the battlefield, and next turn untaps everything and draws", () => {
    const s0 = startGame(deck(), { shuffle: keep });
    const inHand = s0.hand[0]!;
    expect(toggleTap(s0, inHand.iid)).toBe(s0);
    const s1 = play(s0, inHand.iid);
    const s2 = toggleTap(s1, inHand.iid);
    expect(s2.battlefield[0]!.tapped).toBe(true);
    expect(untapAll(s2).battlefield[0]!.tapped).toBe(false);
    const s3 = nextTurn(s2);
    expect(s3.turn).toBe(2);
    expect(s3.battlefield[0]!.tapped).toBe(false);
    expect(s3.hand).toHaveLength(s2.hand.length + 1);
  });

  it("shuffles without losing cards and adjusts life totals", () => {
    const s0 = startGame(deck(), { shuffle: keep });
    const s1 = shuffleLibrary(s0, reverse);
    expect(names(s1.library)).toEqual(names(s0.library).reverse());
    const s2 = adjustLife(adjustLife(s1, "opp", -5), "you", 3);
    expect(s2.oppLife).toBe(15);
    expect(s2.life).toBe(23);
  });
});
