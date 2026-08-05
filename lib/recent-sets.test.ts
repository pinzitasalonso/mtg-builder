import { describe, expect, it } from "vitest";
import {
  TRAINING_CUTOFF,
  buildNewCardsBlock,
  buildRecentSetsBlock,
  newCardsQuery,
  roundRobinBySet,
  selectRecentSets,
  type NewCard,
  type RecentSet,
} from "./recent-sets";

const set = (over: Partial<Record<string, unknown>> = {}) => ({
  code: "xxx",
  name: "A Set",
  released_at: "2026-06-26",
  card_count: 300,
  set_type: "expansion",
  digital: false,
  ...over,
});

const recent = (over: Partial<RecentSet> = {}): RecentSet => ({
  code: "hob",
  name: "The Hobbit",
  releasedAt: "2026-08-14",
  cardCount: 321,
  upcoming: true,
  ...over,
});

const card = (over: Partial<NewCard> = {}): NewCard => ({
  name: "Smaug the Magnificent",
  manaCost: "{2}{R}{R}",
  typeLine: "Legendary Creature — Dragon",
  oracleText: "Flying.",
  set: "hob",
  ...over,
});

describe("selectRecentSets", () => {
  const today = "2026-08-05";

  it("keeps card-bearing sets released after the cutoff, newest first", () => {
    const out = selectRecentSets(
      { data: [set({ code: "msh", released_at: "2026-06-26" }), set({ code: "hob", released_at: "2026-08-14" })] },
      today
    );
    expect(out.map((s) => s.code)).toEqual(["hob", "msh"]);
  });

  // The whole point: a set spoiled but not yet legal is the one players ask
  // about most, and Scryfall carries its cards weeks ahead of release.
  it("keeps unreleased sets and marks them upcoming", () => {
    const [hob] = selectRecentSets({ data: [set({ code: "hob", released_at: "2026-08-14" })] }, today);
    expect(hob.upcoming).toBe(true);
    const [msh] = selectRecentSets({ data: [set({ code: "msh", released_at: "2026-06-26" })] }, today);
    expect(msh.upcoming).toBe(false);
  });

  it("drops anything the model already knows or cannot play", () => {
    const out = selectRecentSets(
      {
        data: [
          set({ code: "old", released_at: "2025-01-01" }), // before the cutoff
          set({ code: "dig", digital: true }), // Arena-only
          set({ code: "tok", set_type: "token" }), // no playable cards
          set({ code: "emp", card_count: 0 }), // announced, nothing spoiled
          set({ code: "keep" }),
        ],
      },
      today
    );
    expect(out.map((s) => s.code)).toEqual(["keep"]);
  });

  // The regression from the first live run: sets announced months out, with a
  // handful of preview cards each, won the newest-first sort and ate the cap —
  // pushing the 453-card set that shipped six weeks ago off the list.
  it("ignores sets too far out for anyone to be brewing with", () => {
    const out = selectRecentSets(
      {
        data: [
          set({ code: "trk", released_at: "2026-11-13", card_count: 61 }),
          set({ code: "fra", released_at: "2026-10-02", card_count: 43 }),
          set({ code: "hob", released_at: "2026-08-14", card_count: 321 }),
          set({ code: "msh", released_at: "2026-06-26", card_count: 453 }),
        ],
      },
      today
    );
    expect(out.map((s) => s.code)).toEqual(["hob", "msh"]);
  });

  it("caps the list so a stale cutoff cannot balloon the prompt", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      set({ code: `s${i}`, released_at: `2026-06-${String((i % 28) + 1).padStart(2, "0")}` })
    );
    expect(selectRecentSets({ data: many }, today).length).toBeLessThanOrEqual(8);
  });

  it("survives a shape it did not expect", () => {
    expect(selectRecentSets(null, today)).toEqual([]);
    expect(selectRecentSets({}, today)).toEqual([]);
    expect(selectRecentSets({ data: "nope" }, today)).toEqual([]);
    expect(selectRecentSets({ data: [{}, { code: "x" }] }, today)).toEqual([]);
  });

  it("has a cutoff that is a plain ISO date, so string compare is date compare", () => {
    expect(TRAINING_CUTOFF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("newCardsQuery", () => {
  it("asks one set at a time for new printings only, in paper", () => {
    const q = newCardsQuery(recent(), "WUB");
    // Per set, not pooled: a pooled query orders by EDHREC rank, and the set
    // that isn't out yet has no play data to rank on, so it loses every slot.
    expect(q).toContain("set:hob");
    // A reprint is by definition a card the model already knows.
    expect(q).toContain("-is:reprint");
    expect(q).toContain("game:paper");
    expect(q).toContain("-t:basic");
    expect(q).toContain("id<=wub");
  });

  // Filtering on a colour identity we never established would hide exactly the
  // cards this module exists to surface.
  it("omits the identity filter when the identity is unknown", () => {
    expect(newCardsQuery(recent(), null)).not.toContain("id<=");
    expect(newCardsQuery(recent(), "")).not.toContain("id<=");
  });
});

describe("roundRobinBySet", () => {
  // The regression this function exists for. EDHREC rank measures play, and a
  // set released next week has none, so its cards all sort last — a plain
  // top-N would be entirely the oldest set in the list.
  it("represents every set even when one sorts last", () => {
    const cards = [
      ...Array.from({ length: 20 }, (_, i) => card({ name: `msh ${i}`, set: "msh" })),
      ...Array.from({ length: 20 }, (_, i) => card({ name: `hob ${i}`, set: "hob" })),
    ];
    const out = roundRobinBySet(cards, ["hob", "msh"], 6);
    expect(out.map((c) => c.set)).toEqual(["hob", "msh", "hob", "msh", "hob", "msh"]);
  });

  it("keeps each set's own order", () => {
    const cards = [card({ name: "first", set: "hob" }), card({ name: "second", set: "hob" })];
    expect(roundRobinBySet(cards, ["hob"], 5).map((c) => c.name)).toEqual(["first", "second"]);
  });

  it("drains a short set without stalling on it", () => {
    const cards = [
      card({ name: "only hob", set: "hob" }),
      ...Array.from({ length: 4 }, (_, i) => card({ name: `msh ${i}`, set: "msh" })),
    ];
    const out = roundRobinBySet(cards, ["hob", "msh"], 5);
    expect(out.map((c) => c.name)).toEqual(["only hob", "msh 0", "msh 1", "msh 2", "msh 3"]);
  });

  it("stops at the limit and copes with nothing to take", () => {
    expect(roundRobinBySet([], ["hob"], 10)).toEqual([]);
    expect(roundRobinBySet([card()], ["hob"], 0)).toEqual([]);
    // A set in the result that nobody asked for is simply skipped.
    expect(roundRobinBySet([card({ set: "zzz" })], ["hob"], 5)).toEqual([]);
  });
});

describe("buildRecentSetsBlock", () => {
  it("names each set and says which are out and which are coming", () => {
    const text = buildRecentSetsBlock([
      recent(),
      recent({ code: "msh", name: "Marvel Super Heroes", releasedAt: "2026-06-26", cardCount: 453, upcoming: false }),
    ]);
    expect(text).toContain("The Hobbit (HOB) — 321 cards, releases 2026-08-14");
    expect(text).toContain("Marvel Super Heroes (MSH) — 453 cards, released 2026-06-26");
  });

  // The failure this is here to stop: the model deciding a real card is made
  // up, because a name it has never seen reads as a typo.
  it("forbids telling a player their card isn't real", () => {
    expect(buildRecentSetsBlock([recent()])).toContain("NEVER tell a player a card doesn't exist");
  });

  it("is empty when there is nothing past the cutoff", () => {
    expect(buildRecentSetsBlock([])).toBe("");
  });
});

describe("buildNewCardsBlock", () => {
  it("gives the set name, cost, type and text for each card", () => {
    const text = buildNewCardsBlock([card()], [recent()]);
    expect(text).toContain("[The Hobbit] Smaug the Magnificent");
    expect(text).toContain("{2}{R}{R}");
    expect(text).toContain("Legendary Creature — Dragon");
    expect(text).toContain("Flying.");
  });

  // A list of cards next to a request for recommendations reads as a shortlist
  // unless it says otherwise, and novelty is not a reason to play a card.
  it("says the list is a sample and not a ranking", () => {
    const text = buildNewCardsBlock([card()], [recent()]);
    expect(text).toContain("not a shortlist");
    expect(text).toContain("never reach for one just because it is new");
  });

  it("truncates long oracle text and keeps each card on one line", () => {
    const text = buildNewCardsBlock([card({ oracleText: `${"a".repeat(400)}\nsecond line` })], [recent()]);
    expect(text).toContain("…");
    expect(text.split("\n").filter((l) => l.includes("Smaug"))).toHaveLength(1);
  });

  // "Flying, haste Whenever Smaug attacks" — one ability running into the next
  // is how the first live run read.
  it("separates abilities instead of running them together", () => {
    const text = buildNewCardsBlock([card({ oracleText: "Flying, haste\nWhenever Smaug attacks, draw." })], [recent()]);
    expect(text).toContain("Flying, haste · Whenever Smaug attacks, draw.");
  });

  it("falls back to the set code when the set is not in the list", () => {
    expect(buildNewCardsBlock([card({ set: "zzz" })], [])).toContain("[ZZZ]");
  });

  it("is empty when no cards came back", () => {
    expect(buildNewCardsBlock([], [recent()])).toBe("");
  });
});
