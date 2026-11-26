import { beforeEach, describe, expect, it } from "vitest";
import { jsonRequest, makeUser, params, prisma, signIn, signOut } from "@/test/db";
import { GET as opponents } from "@/app/api/practice/opponents/route";
import { POST as result } from "@/app/api/practice/[id]/result/route";
import { POST as review } from "@/app/api/practice/[id]/review/route";
import { POST as turn } from "@/app/api/practice/[id]/turn/route";
import { POST as start } from "@/app/api/practice/start/route";
import { GET as adminMatches } from "@/app/api/analytics/practice/route";
import { GET as adminMatch } from "@/app/api/analytics/practice/[id]/route";
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
    // One of today's free games is spent, and the picker says what's left before another is tried.
    expect(body.free).toEqual({ perDay: FREE_PRACTICE_PER_DAY, left: FREE_PRACTICE_PER_DAY - 1 });
    const again = () => start(jsonRequest("/api/practice/start", { deck: mine.publicId, opponent: option }));
    for (let i = 1; i < FREE_PRACTICE_PER_DAY; i++) expect((await again()).status).toBe(200);
    expect((await again()).status).toBe(429);
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

describe("a game against the basic bot", () => {
  it("is free: it starts with today's game spent, and doesn't spend it", async () => {
    const user = await makeUser();
    await signIn(user);
    const mine = await makeDeck(user.id, "Mine", "Kefka, Court Mage");
    const foe = await makeDeck(user.id, "Foe", "Yuriko, the Tiger's Shadow");
    const opponent = { kind: "deck", deck: foe.publicId, label: "Foe", detail: "" };
    const play = (bot: boolean) => start(jsonRequest("/api/practice/start", { deck: mine.publicId, opponent, bot }));

    const first = await play(true);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ bot: true });
    // The bot's game didn't use the day's game against the AI…
    expect((await (await opponents(pick(mine.publicId!))).json()).free.left).toBe(FREE_PRACTICE_PER_DAY);
    for (let i = 0; i < FREE_PRACTICE_PER_DAY; i++) expect((await play(false)).status).toBe(200);
    // …and with those used, the bot still plays.
    expect((await play(false)).status).toBe(429);
    expect((await play(true)).status).toBe(200);
    expect(await prisma.practiceGame.count({ where: { userId: user.id, bot: true } })).toBe(2);
  });
});

describe("/api/practice/<id>/result", () => {
  it("writes a game's result once, and answers with the deck's record", async () => {
    const user = await makeUser({ tier: "pro" });
    await signIn(user);
    const mine = await makeDeck(user.id, "Mine", "Kefka, Court Mage");
    const foe = await makeDeck(user.id, "Foe", "Yuriko, the Tiger's Shadow");
    const newGame = async () => (await (await start(jsonRequest("/api/practice/start", { deck: mine.publicId, opponent: { kind: "deck", deck: foe.publicId, label: "Foe", detail: "" } }))).json()).id as string;
    const report = (id: string, body: unknown) => result(jsonRequest("/x", body), params({ id }));
    const a = await newGame();
    const b = await newGame();

    expect(await (await report(a, { result: "won", turn: 9 })).json()).toEqual({ ok: true, record: { won: 1, lost: 0 } });
    // Reported again (another tab, an undo): the first answer stands.
    expect(await (await report(a, { result: "lost", turn: 12 })).json()).toEqual({ ok: true, record: { won: 1, lost: 0 } });
    expect(await (await report(b, { result: "lost", turn: 6 })).json()).toEqual({ ok: true, record: { won: 1, lost: 1 } });
    expect(await prisma.practiceGame.findUniqueOrThrow({ where: { id: a }, select: { result: true, endTurn: true } })).toEqual({ result: "won", endTurn: 9 });
    // The picker shows it.
    expect((await (await opponents(pick(mine.publicId!))).json()).record).toEqual({ won: 1, lost: 1 });

    expect((await report(a, { result: "drew" })).status).toBe(400);
    await signIn(await makeUser());
    expect((await report(a, { result: "won" })).status).toBe(404);
  });
});

describe("/api/practice/<id>/turn and /review", () => {
  const side = (o: Record<string, unknown> = {}) => ({ library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [], life: 40, turn: 1, oppLife: 40, mulligans: 0, toBottom: 0, ...o });
  const table = (o: Record<string, unknown> = {}) => ({ turn: 1, active: "opp", first: "opp", winner: null, commanderGame: false, landPlayed: false, cmdDamage: { you: 0, opp: 0 }, tax: { you: 0, opp: 0 }, combat: null, log: [], sides: { you: side(), opp: side() }, ...o });

  it("plays a turn with nothing to decide without the model, and without counting it", async () => {
    const user = await makeUser({ tier: "pro" });
    await signIn(user);
    const mine = await makeDeck(user.id, "Mine", "Kefka, Court Mage");
    const id = (await (await start(jsonRequest("/api/practice/start", { deck: mine.publicId, opponent: { kind: "deck", deck: mine.publicId, label: "", detail: "" } }))).json()).id as string;
    const island = { iid: 100_001, name: "Island", imageUri: "", typeLine: "Basic Land — Island" };
    const res = await turn(jsonRequest("/x", { game: table({ sides: { you: side(), opp: side({ hand: [island] }) } }) }), params({ id }));
    expect(await res.json()).toMatchObject({ source: "simple", plan: { main: [{ kind: "land", card: "c100001" }], attack: [] } });
    expect((await prisma.practiceGame.findUniqueOrThrow({ where: { id } })).turns).toBe(0);
  });

  it("reviews only a finished game of yours, and serves a kept review as it is", async () => {
    const user = await makeUser({ tier: "pro" });
    await signIn(user);
    const mine = await makeDeck(user.id, "Mine", "Kefka, Court Mage");
    const id = (await (await start(jsonRequest("/api/practice/start", { deck: mine.publicId, opponent: { kind: "deck", deck: mine.publicId, label: "", detail: "" } }))).json()).id as string;
    const ask = (game: unknown) => review(jsonRequest("/x", { game }), params({ id }));
    expect((await ask(table())).status).toBe(400);
    await prisma.practiceGame.update({ where: { id }, data: { review: "## What decided it\nKept." } });
    const kept = await ask(null);
    expect(kept.status).toBe(200);
    expect(await kept.text()).toBe("## What decided it\nKept.");
    await signIn(await makeUser());
    expect((await ask(table({ winner: "you" }))).status).toBe(404);
  });
});

describe("a match's turns are kept", () => {
  const side = (o: Record<string, unknown> = {}) => ({ library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [], life: 40, turn: 1, oppLife: 40, mulligans: 0, toBottom: 0, ...o });
  const line = (text: string, seat: string | null = "opp") => ({ seat, text });
  const table = (o: Record<string, unknown> = {}) => ({ turn: 4, active: "opp", first: "you", winner: null, commanderGame: false, landPlayed: false, cmdDamage: { you: 0, opp: 0 }, tax: { you: 0, opp: 0 }, combat: null, log: [], sides: { you: side(), opp: side() }, ...o });
  const island = (iid: number) => ({ iid, name: "Island", imageUri: "", typeLine: "Basic Land — Island" });

  it("each turn the server plans, and the table's closing log, read back by the admin only", async () => {
    const user = await makeUser({ tier: "pro" });
    await signIn(user);
    const mine = await makeDeck(user.id, "Mine", "Kefka, Court Mage");
    const id = (await (await start(jsonRequest("/api/practice/start", { deck: mine.publicId, opponent: { kind: "deck", deck: mine.publicId, label: "Mirror match", detail: "" } }))).json()).id as string;

    // Its turn 2: a land in hand, nothing else. Then turn 4, after a turn where it only played that land.
    await turn(jsonRequest("/x", { game: table({ turn: 2, log: [line("Turn 2 — the opponent's turn.")], sides: { you: side(), opp: side({ hand: [island(100_001)], life: 38 }) } }) }), params({ id }));
    const log = [line("Turn 2 — the opponent's turn."), line("The opponent plays Island."), line("Turn 3 — your turn.", "you"), line("You cast Bear.", "you"), line("Turn 4 — the opponent's turn.")];
    await turn(jsonRequest("/x", { game: table({ turn: 4, log, sides: { you: side(), opp: side({ hand: [island(100_002)], battlefield: [{ ...island(100_001), tapped: false }] }) } }) }), params({ id }));
    await result(jsonRequest("/x", { result: "won", turn: 9, log: ["Turn 9 — your turn.", "You attack.", "The opponent is out of life. You win!", 7, null] }), params({ id }));
    // A second report changes nothing, and adds no second ending.
    await result(jsonRequest("/x", { result: "lost", turn: 11, log: ["again"] }), params({ id }));

    // Rows are written without being waited for.
    await new Promise((r) => setTimeout(r, 50));
    const rows = await prisma.practiceTurn.findMany({ where: { gameId: id }, orderBy: { id: "asc" } });
    expect(rows.map((r) => [r.turn, r.source])).toEqual([[2, "simple"], [4, "simple"], [9, "end"]]);
    const second = JSON.parse(rows[1]!.data);
    expect(second).toMatchObject({ life: { opp: 40, you: 40 }, hand: ["Island*"], field: ["Island"], line: expect.stringMatching(/^play c100002 Island\.$/) });
    expect(second.since).toEqual(["Turn 2 — the opponent's turn.", "The opponent plays Island.", "Turn 3 — your turn.", "You cast Bear."]);
    expect(JSON.parse(rows[2]!.data).since).toEqual(["Turn 9 — your turn.", "You attack.", "The opponent is out of life. You win!"]);

    // Not the player's to read: the admin's.
    expect((await adminMatches()).status).toBe(403);
    expect((await adminMatch(jsonRequest("/x"), params({ id }))).status).toBe(403);
    const admin = await makeUser({ email: "boss@example.com" });
    process.env.ANALYTICS_ADMIN_EMAIL = "boss@example.com";
    await signIn(admin);
    const list = await (await adminMatches()).json();
    const m = list.matches.find((x: { id: string }) => x.id === id);
    // Two turns planned; the first is known to have cast nothing (a land only).
    expect(m).toMatchObject({ opponent: expect.stringContaining("Mine"), bot: false, result: "won", endTurn: 9, traced: 3, turns: 2, known: 1, idle: 1, bySource: { simple: 2 } });
    expect(list.summary).toMatchObject({ matches: 1, medianEndTurn: 9, idle: 1, known: 1 });
    const text = await (await adminMatch(jsonRequest("/x"), params({ id }))).text();
    expect(text).toMatch(/^Practice match against Mine/);
    expect(text).toMatch(/Result: the player won on turn 9\./);
    expect(text).toMatch(/=== Turn 4 · planned by: simple · life 40 \(player 40\)/);
    expect(text).toMatch(/hand: Island\*/);
    expect(text).toMatch(/the app's line: play c100002 Island\./);
    expect(text).toMatch(/=== How it ended \(won\) ===\n   Turn 9 — your turn\./);
    expect((await adminMatch(jsonRequest("/x"), params({ id: "nope" }))).status).toBe(404);
    delete process.env.ANALYTICS_ADMIN_EMAIL;
  });

  it("go with the match when its account is deleted", async () => {
    const user = await makeUser({ tier: "pro" });
    await signIn(user);
    const mine = await makeDeck(user.id, "Mine", "Kefka, Court Mage");
    const id = (await (await start(jsonRequest("/api/practice/start", { deck: mine.publicId, opponent: { kind: "deck", deck: mine.publicId, label: "", detail: "" } }))).json()).id as string;
    await turn(jsonRequest("/x", { game: table({ sides: { you: side(), opp: side({ hand: [island(100_001)] }) } }) }), params({ id }));
    await new Promise((r) => setTimeout(r, 50));
    expect(await prisma.practiceTurn.count({ where: { gameId: id } })).toBe(1);
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.practiceTurn.count({ where: { gameId: id } })).toBe(0);
  });
});
