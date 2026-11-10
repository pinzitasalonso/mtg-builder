import { beforeEach, describe, expect, it } from "vitest";
import { jsonRequest, makeUser, prisma, signIn, signOut } from "@/test/db";
import { GET as opponents } from "@/app/api/practice/opponents/route";
import { POST as start } from "@/app/api/practice/start/route";
import { FREE_PRACTICE_PER_DAY } from "@/lib/limits";

// MTGTop8, EDHREC and Scryfall are down in tests (fetch fails): the picker
// has the player's own decks, and a game between two of them still starts.

let seq = 0;
async function makeDeck(userId: number, name: string, commander: string) {
  seq += 1;
  return prisma.deck.create({
    data: {
      name,
      userId,
      publicId: `p-${seq}`,
      format: "commander",
      commander,
      cards: {
        create: [
          { scryfallId: `c-${seq}`, name: commander, imageUri: `https://cards.scryfall.io/normal/front/a/b/cmdr-${seq}.jpg`, typeLine: "Legendary Creature — Human", colorIdentity: "UB", board: "deck" },
          { scryfallId: `i-${seq}`, name: "Island", imageUri: "https://cards.scryfall.io/normal/front/a/b/island.jpg", typeLine: "Basic Land — Island", colorIdentity: "U", board: "deck", quantity: 30 },
        ],
      },
    },
  });
}
const pick = (deck: string) => jsonRequest(`/api/practice/opponents?deck=${deck}`);

describe("/api/practice/opponents", () => {
  let user: { id: number };
  beforeEach(async () => {
    user = await makeUser();
    await signIn(user);
  });

  it("needs an account, and a deck you may open", async () => {
    const other = await makeDeck((await makeUser()).id, "Theirs", "Yuriko, the Tiger's Shadow");
    expect((await opponents(pick(other.publicId!))).status).toBe(404);
    signOut();
    expect((await opponents(pick(other.publicId!))).status).toBe(401);
  });

  it("offers your decks with their commander's art and colours, the mirror first", async () => {
    const mine = await makeDeck(user.id, "Mine", "Kefka, Court Mage");
    const second = await makeDeck(user.id, "Second", "Yuriko, the Tiger's Shadow");
    await makeDeck((await makeUser()).id, "Theirs", "Atraxa, Praetors' Voice");
    const body = await (await opponents(pick(mine.publicId!))).json();
    expect(body).toMatchObject({ commanderGame: true, bracket: null, recent: [], more: false, free: { perDay: FREE_PRACTICE_PER_DAY, left: FREE_PRACTICE_PER_DAY } });
    // The sources that are down leave their tabs out.
    expect(body.tabs.map((t: { id: string }) => t.id)).toEqual(["mine"]);
    expect(body.tabs[0].options).toEqual([
      { kind: "deck", deck: mine.publicId, label: "Mirror match", detail: "Mine against itself", image: expect.stringContaining("/art_crop/front/a/b/cmdr-"), colors: "UB" },
      { kind: "deck", deck: second.publicId, label: "Second", detail: "Yuriko, the Tiger's Shadow", image: expect.stringContaining("/art_crop/"), colors: "UB" },
    ]);
  });

  it("has no allowance to show on Pro", async () => {
    const pro = await makeUser({ tier: "pro" });
    await signIn(pro);
    const deck = await makeDeck(pro.id, "Mine", "Kefka, Court Mage");
    expect((await (await opponents(pick(deck.publicId!))).json()).free).toBeNull();
  });
});

describe("/api/practice/start", () => {
  it("keeps the deck and the opponent, so the picker offers it again", async () => {
    const user = await makeUser();
    await signIn(user);
    const mine = await makeDeck(user.id, "Mine", "Kefka, Court Mage");
    const foe = await makeDeck(user.id, "Foe", "Yuriko, the Tiger's Shadow");
    const option = { kind: "deck", deck: foe.publicId, label: "Foe", detail: "Yuriko, the Tiger's Shadow", colors: "UB", junk: "x".repeat(5000) };

    const res = await start(jsonRequest("/api/practice/start", { deck: mine.publicId, opponent: option }));
    expect(res.status).toBe(200);
    const row = await prisma.practiceGame.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.deck).toBe(mine.publicId);
    // Cleaned, and with a picture (the tile sent none): the opponent's commander.
    expect(JSON.parse(row.opponent!)).toEqual({ kind: "deck", deck: foe.publicId, label: "Foe", detail: "Yuriko, the Tiger's Shadow", colors: "UB", image: expect.stringContaining("/art_crop/") });

    const body = await (await opponents(pick(mine.publicId!))).json();
    expect(body.recent.map((o: { label: string }) => o.label)).toEqual(["Foe"]);
    // Today's free game is spent, and the picker says so before another is tried.
    expect(body.free).toEqual({ perDay: FREE_PRACTICE_PER_DAY, left: FREE_PRACTICE_PER_DAY - 1 });
    expect((await start(jsonRequest("/api/practice/start", { deck: mine.publicId, opponent: option }))).status).toBe(429);
  });

  it("refuses an opponent that isn't one, and gives the game back when its deck won't load", async () => {
    const user = await makeUser();
    await signIn(user);
    const mine = await makeDeck(user.id, "Mine", "Kefka, Court Mage");
    expect((await start(jsonRequest("/api/practice/start", { deck: mine.publicId, opponent: { kind: "nope" } }))).status).toBe(400);
    expect((await start(jsonRequest("/api/practice/start", { deck: mine.publicId, opponent: { kind: "deck", deck: "no-such-deck", label: "", detail: "" } }))).status).toBe(502);
    expect(await prisma.practiceGame.count({ where: { userId: user.id } })).toBe(0);
  });
});
