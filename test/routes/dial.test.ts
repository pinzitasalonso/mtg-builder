import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { jsonRequest, makeUser, params, prisma, signIn, signOut } from "@/test/db";
import { POST as start } from "@/app/api/device/pair/start/route";
import { POST as claim } from "@/app/api/device/pair/claim/route";
import { POST as poll } from "@/app/api/device/pair/poll/route";
import { GET as deviceDecks } from "@/app/api/device/decks/route";
import { GET as deviceArt } from "@/app/api/device/art/[deck]/route";
import { GET as listDials } from "@/app/api/dials/route";
import { DELETE as removeDial, PATCH as renameDial } from "@/app/api/dials/[id]/route";
import { POST as sendDeck } from "@/app/api/dials/[id]/decks/route";
import { DEVICE_TOKEN_PREFIX, MAX_DECKS_PER_DEVICE } from "@/lib/device";
import { dialArt } from "@/lib/device-art";
import { tokenHash } from "@/lib/auth-core";

const SCAN = "https://cards.scryfall.io/normal/front/a/b/kefka.jpg";
let n = 0;
/** A request as a dial sends it: its own address, and its token if it has one. */
const asDial = (path: string, body?: unknown, token?: string) =>
  new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-forwarded-for": `10.9.${++n % 250}.${n % 200}`, ...(token ? { authorization: `Bearer ${token}`, "x-dial-firmware": "0.1.0" } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function deckOf(userId: number, name: string, commander: string | null = "Kefka, Court Mage") {
  const deck = await prisma.deck.create({ data: { name, userId, commander, publicId: `d-${userId}-${name.replace(/\W/g, "")}-${Math.random().toString(36).slice(2, 8)}` } });
  if (commander) await prisma.poolCard.create({ data: { deckId: deck.id, scryfallId: `c-${deck.id}`, name: commander, imageUri: SCAN, colorIdentity: "UBR", board: "deck" } });
  return deck;
}

/** A dial paired to a new account: the whole dance. */
async function pairedDial() {
  const user = await makeUser();
  const begun = await (await start(asDial("/api/device/pair/start", { firmware: "0.1.0" }))).json();
  await signIn(user);
  const claimed = await claim(jsonRequest("/api/device/pair/claim", { code: begun.code.toLowerCase(), name: "  Desk   dial " }));
  expect(claimed.status).toBe(200);
  const got = await (await poll(asDial("/api/device/pair/poll", { code: begun.code, secret: begun.secret }))).json();
  return { user, begun, token: got.token as string, deviceId: got.device.id as number, got };
}

describe("pairing a dial", () => {
  it("start gives a code and a secret; the poll waits until someone claims it", async () => {
    const res = await start(asDial("/api/device/pair/start", { firmware: "0.1.0" }));
    const begun = await res.json();
    expect(begun.code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    expect(begun.secret.length).toBeGreaterThan(30);
    expect(begun).toMatchObject({ pollEvery: 3, url: "spellpool.com/dial" });
    const waiting = await poll(asDial("/api/device/pair/poll", { code: begun.code, secret: begun.secret }));
    expect(waiting.status).toBe(202);
    // The secret is the dial's: another one learns nothing.
    expect((await poll(asDial("/api/device/pair/poll", { code: begun.code, secret: "guess" }))).status).toBe(404);
    // Only its hash is kept.
    const row = await prisma.devicePairing.findUnique({ where: { code: begun.code } });
    expect(row?.secretHash).toBe(tokenHash(begun.secret));
  });

  it("claim needs an account, and the dial then collects its token once", async () => {
    signOut();
    const begun = await (await start(asDial("/api/device/pair/start", {}))).json();
    expect((await claim(jsonRequest("/api/device/pair/claim", { code: begun.code }))).status).toBe(401);
    const { token, got, user, begun: mine } = await pairedDial();
    expect(token.startsWith(DEVICE_TOKEN_PREFIX)).toBe(true);
    expect(got).toMatchObject({ status: "paired", device: { name: "Desk dial" }, player: user.email.split("@")[0] });
    // The token isn't stored, and the pairing is gone: a second poll gets nothing.
    const device = await prisma.device.findFirst({ where: { userId: user.id } });
    expect(device).toMatchObject({ tokenHash: tokenHash(token), firmware: "0.1.0", name: "Desk dial" });
    expect((await poll(asDial("/api/device/pair/poll", { code: mine.code, secret: mine.secret }))).status).toBe(404);
    expect(await prisma.device.count({ where: { userId: user.id } })).toBe(1);
  });

  it("a code can't be claimed twice, a wrong one isn't found, an expired one neither", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const begun = await (await start(asDial("/api/device/pair/start", {}))).json();
    await signIn(a);
    expect((await claim(jsonRequest("/api/device/pair/claim", { code: begun.code }))).status).toBe(200);
    await signIn(b);
    expect((await claim(jsonRequest("/api/device/pair/claim", { code: begun.code }))).status).toBe(409);
    expect((await claim(jsonRequest("/api/device/pair/claim", { code: "ZZZZZZ" }))).status).toBe(404);
    const old = await (await start(asDial("/api/device/pair/start", {}))).json();
    await prisma.devicePairing.update({ where: { code: old.code }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await claim(jsonRequest("/api/device/pair/claim", { code: old.code }))).status).toBe(404);
    expect((await poll(asDial("/api/device/pair/poll", { code: old.code, secret: old.secret }))).status).toBe(404);
  });
});

describe("a paired dial", () => {
  it("lists the decks sent to it, and only those", async () => {
    const { user, token, deviceId } = await pairedDial();
    const kefka = await deckOf(user.id, "Kefka storm");
    await deckOf(user.id, "Not sent");
    const bare = await deckOf(user.id, "No commander", null);
    expect((await sendDeck(jsonRequest("/x", { deck: kefka.publicId }), params({ id: String(deviceId) }))).status).toBe(200);
    expect((await sendDeck(jsonRequest("/x", { deck: bare.publicId, on: true }), params({ id: String(deviceId) }))).status).toBe(200);
    const res = await deviceDecks(asDial("/api/device/decks", undefined, token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.device).toMatchObject({ name: "Desk dial" });
    expect(body.decks).toHaveLength(2);
    expect(body.decks[0]).toMatchObject({ id: kefka.publicId, name: "Kefka storm", commander: "Kefka, Court Mage", colors: "UBR", bracket: null, gamesPlayed: 0 });
    expect(body.decks[0].art).toMatch(/^[0-9a-f]{12}$/);
    expect(body.decks[1]).toMatchObject({ name: "No commander", art: null, colors: "" });
    // Nothing new: the same tag back costs a 304.
    const again = await deviceDecks(new Request("http://localhost/api/device/decks", { headers: { authorization: `Bearer ${token}`, "if-none-match": res.headers.get("etag")!, "x-forwarded-for": "10.1.1.1" } }));
    expect(again.status).toBe(304);
    // Taken off again.
    await sendDeck(jsonRequest("/x", { deck: bare.publicId, on: false }), params({ id: String(deviceId) }));
    expect((await (await deviceDecks(asDial("/api/device/decks", undefined, token))).json()).decks).toHaveLength(1);
  });

  it("needs its token: none, a wrong one or a session cookie get a 401", async () => {
    const { token } = await pairedDial();
    expect((await deviceDecks(asDial("/api/device/decks"))).status).toBe(401);
    expect((await deviceDecks(asDial("/api/device/decks", undefined, `${DEVICE_TOKEN_PREFIX}nope`))).status).toBe(401);
    expect((await deviceDecks(asDial("/api/device/decks", undefined, token.slice(DEVICE_TOKEN_PREFIX.length)))).status).toBe(401);
  });

  it("only the owner's decks go on it, and only onto the owner's dial", async () => {
    const { deviceId } = await pairedDial();
    const stranger = await makeUser();
    const theirs = await deckOf(stranger.id, "Theirs");
    // Still signed in as the dial's owner: a stranger's deck isn't found.
    expect((await sendDeck(jsonRequest("/x", { deck: theirs.publicId }), params({ id: String(deviceId) }))).status).toBe(404);
    await signIn(stranger);
    expect((await sendDeck(jsonRequest("/x", { deck: theirs.publicId }), params({ id: String(deviceId) }))).status).toBe(404);
    expect((await renameDial(jsonRequest("/x", { name: "Mine now" }), params({ id: String(deviceId) }))).status).toBe(404);
    expect((await removeDial(jsonRequest("/x", {}), params({ id: String(deviceId) }))).status).toBe(404);
    expect((await (await listDials()).json()).dials).toEqual([]);
  });

  it("holds a limited number of decks", async () => {
    const { user, deviceId } = await pairedDial();
    const p = params({ id: String(deviceId) });
    for (let i = 0; i < MAX_DECKS_PER_DEVICE; i++) {
      const d = await prisma.deck.create({ data: { name: `Deck ${i}`, userId: user.id, publicId: `full-${user.id}-${i}` } });
      await prisma.deviceDeck.create({ data: { deviceId, deckId: d.id } });
    }
    const extra = await deckOf(user.id, "One too many");
    expect((await sendDeck(jsonRequest("/x", { deck: extra.publicId }), p)).status).toBe(409);
  });

  it("is renamed and removed from the web; removed, its token stops working", async () => {
    const { token, deviceId } = await pairedDial();
    const p = params({ id: String(deviceId) });
    expect(await (await renameDial(jsonRequest("/x", { name: "  Game night  " }), p)).json()).toMatchObject({ name: "Game night" });
    const listed = (await (await listDials()).json()).dials;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: deviceId, name: "Game night", firmware: "0.1.0", decks: [] });
    expect((await removeDial(jsonRequest("/x", {}), p)).status).toBe(200);
    expect((await deviceDecks(asDial("/api/device/decks", undefined, token))).status).toBe(401);
  });

  it("art is only for a deck on the dial (and there's no network in tests: 502)", async () => {
    const { user, token, deviceId } = await pairedDial();
    const on = await deckOf(user.id, "On it");
    const off = await deckOf(user.id, "Off it");
    await sendDeck(jsonRequest("/x", { deck: on.publicId }), params({ id: String(deviceId) }));
    expect((await deviceArt(asDial("/x", undefined, token), params({ deck: off.publicId! }))).status).toBe(404);
    expect((await deviceArt(asDial("/x"), params({ deck: on.publicId! }))).status).toBe(401);
    expect((await deviceArt(asDial("/x", undefined, token), params({ deck: on.publicId! }))).status).toBe(502);
  });
});

describe("a deck's art, with the network there", () => {
  it("is fetched from Scryfall's image host with a User-Agent, resized, and tagged", async () => {
    const { user, token, deviceId } = await pairedDial();
    const deck = await deckOf(user.id, "With art");
    await sendDeck(jsonRequest("/x", { deck: deck.publicId }), params({ id: String(deviceId) }));
    const source = await sharp({ create: { width: 626, height: 457, channels: 3, background: { r: 10, g: 120, b: 200 } } }).jpeg().toBuffer();
    // Scryfall's image host answers 400 to a library's default User-Agent.
    vi.mocked(fetch).mockImplementationOnce(async (url, init) => {
      expect(String(url)).toBe("https://cards.scryfall.io/art_crop/front/a/b/kefka.jpg");
      expect(new Headers(init?.headers).get("user-agent")).toBeTruthy();
      return new Response(new Uint8Array(source), { status: 200, headers: { "content-type": "image/jpeg" } });
    });
    const res = await deviceArt(asDial("/x", undefined, token), params({ deck: deck.publicId! }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(await sharp(Buffer.from(await res.arrayBuffer())).metadata()).toMatchObject({ width: 360, height: 360, isProgressive: false });
    // The tag the deck list gave: the same one back costs nothing.
    const tag = res.headers.get("etag")!;
    const listed = (await (await deviceDecks(asDial("/api/device/decks", undefined, token))).json()).decks[0];
    expect(tag).toBe(`"${listed.art}"`);
    const again = await deviceArt(new Request("http://localhost/x", { headers: { authorization: `Bearer ${token}`, "if-none-match": tag, "x-forwarded-for": "10.2.2.2" } }), params({ deck: deck.publicId! }));
    expect(again.status).toBe(304);
  });
});

describe("the dial's picture", () => {
  it("is a 360 × 360 baseline JPEG, or raw RGB565", async () => {
    // An art crop's shape, in one colour: red 248, green 0, blue 0.
    const source = await sharp({ create: { width: 626, height: 457, channels: 3, background: { r: 248, g: 0, b: 0 } } }).jpeg().toBuffer();
    const jpeg = await dialArt(source, "jpeg");
    const meta = await sharp(jpeg).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 360, height: 360, isProgressive: false, chromaSubsampling: "4:2:0" });
    expect(jpeg.length).toBeLessThan(60_000);
    const raw = await dialArt(source, "rgb565");
    expect(raw.length).toBe(360 * 360 * 2);
    // Pure red is 0xF800: little-endian 00 F8.
    expect([raw[0], raw[1]]).toEqual([0x00, 0xf8]);
  });
});
