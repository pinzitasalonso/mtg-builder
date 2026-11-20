// Spellpool Dial: the server side of a dial (docs/dial-device-api.md).
// Pairing codes, the dial's token, and the decks sent to it.

import prisma from "@/lib/prisma";
import { newToken, tokenHash } from "@/lib/auth-core";
import { scanSummary } from "@/lib/deck-analysis";
import { newPlayCode, normalizePlayCode } from "@/lib/play-code";

// A pairing code is typed across a room once: the game codes' alphabet (no
// 0/O, 1/I/L) and length, and the same ten minutes.
export const PAIRING_TTL_MS = 10 * 60 * 1000;
/** How often the dial asks whether its code was claimed, in seconds. */
export const PAIRING_POLL_SECONDS = 3;
export const MAX_DEVICES_PER_USER = 10;
/** What a dial's flash holds comfortably (a deck is a name and a 30 KB picture). */
export const MAX_DECKS_PER_DEVICE = 40;
export const DEVICE_NAME_MAX = 40;
export const DEFAULT_DEVICE_NAME = "Spellpool Dial";
/** A dial's token starts with this, so one found in a log is recognisable. */
export const DEVICE_TOKEN_PREFIX = "spd_";

export const normalizePairingCode = normalizePlayCode;

export function cleanDeviceName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, DEVICE_NAME_MAX) : "";
  return name || DEFAULT_DEVICE_NAME;
}

const cleanFirmware = (raw: unknown) => (typeof raw === "string" && /^[\w.+-]{1,32}$/.test(raw) ? raw : null);

/** The dial asks to be paired: a code to show, and a secret to collect its
    token with. Old pairings are swept here. */
export async function startPairing(firmware: unknown): Promise<{ code: string; secret: string; expiresAt: Date } | null> {
  await prisma.devicePairing.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
  const secret = newToken();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const row = await prisma.devicePairing.create({
        data: { code: newPlayCode(), secretHash: tokenHash(secret), firmware: cleanFirmware(firmware), expiresAt: new Date(Date.now() + PAIRING_TTL_MS) },
      });
      return { code: row.code, secret, expiresAt: row.expiresAt };
    } catch {
      // A code in use: roll again.
    }
  }
  return null;
}

export type ClaimResult = "ok" | "not-found" | "taken" | "too-many";

/** A signed-in player types the code their dial shows: the pairing is
    theirs, and the dial's next poll makes the device. */
export async function claimPairing(userId: number, rawCode: unknown, name: unknown): Promise<ClaimResult> {
  const code = normalizePairingCode(rawCode);
  if (!code) return "not-found";
  if ((await prisma.device.count({ where: { userId } })) >= MAX_DEVICES_PER_USER) return "too-many";
  // Only an unclaimed, unexpired code: two accounts can't both take it.
  const claimed = await prisma.devicePairing.updateMany({
    where: { code, userId: null, expiresAt: { gt: new Date() } },
    data: { userId, name: cleanDeviceName(name) },
  });
  if (claimed.count) return "ok";
  const row = await prisma.devicePairing.findUnique({ where: { code } });
  return row && row.expiresAt > new Date() ? "taken" : "not-found";
}

export type PollResult =
  | { status: "pending" }
  | { status: "gone" }
  | { status: "paired"; token: string; device: { id: number; name: string }; player: string };

/** The dial asks whether its code was claimed. Once it was, the device is
    made and its token handed over, once: the pairing is deleted with it. */
export async function pollPairing(rawCode: unknown, secret: unknown): Promise<PollResult> {
  const code = normalizePairingCode(rawCode);
  if (!code || typeof secret !== "string" || !secret) return { status: "gone" };
  const row = await prisma.devicePairing.findUnique({ where: { code } });
  if (!row || row.secretHash !== tokenHash(secret) || row.expiresAt < new Date()) return { status: "gone" };
  if (row.userId === null) return { status: "pending" };
  const token = DEVICE_TOKEN_PREFIX + newToken();
  const made = await prisma.$transaction(async (tx) => {
    // The pairing goes first: a second poll finds nothing, and makes no second device.
    const gone = await tx.devicePairing.deleteMany({ where: { code, secretHash: row.secretHash } });
    if (!gone.count) return null;
    const user = await tx.user.findUnique({ where: { id: row.userId! }, select: { email: true } });
    if (!user) return null;
    const device = await tx.device.create({ data: { userId: row.userId!, name: row.name ?? DEFAULT_DEVICE_NAME, tokenHash: tokenHash(token), firmware: row.firmware, lastSeenAt: new Date() } });
    return { device, player: playerNameOf(user.email) };
  });
  if (!made) return { status: "gone" };
  return { status: "paired", token, device: { id: made.device.id, name: made.device.name }, player: made.player };
}

/** The name a table sees: the part of the address before the @, as game codes use. */
export const playerNameOf = (email: string) => email.split("@")[0]!;

export interface AuthedDevice {
  id: number;
  userId: number;
  name: string;
  player: string;
}

// "Last seen" is for the dials page: written at most once a minute a dial.
const SEEN_EVERY_MS = 60_000;

/** The dial a request is from, by its bearer token; null when there's none
    or it was removed. `firmware` (the X-Dial-Firmware header) is kept when
    it changes. */
export async function deviceFromRequest(req: Request): Promise<AuthedDevice | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m || !m[1]!.startsWith(DEVICE_TOKEN_PREFIX)) return null;
  const device = await prisma.device.findUnique({ where: { tokenHash: tokenHash(m[1]!) }, include: { user: { select: { email: true } } } });
  if (!device) return null;
  const firmware = cleanFirmware(req.headers.get("x-dial-firmware"));
  const stale = !device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > SEEN_EVERY_MS;
  if (stale || (firmware && firmware !== device.firmware)) {
    await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), ...(firmware ? { firmware } : {}) } }).catch(() => {});
  }
  return { id: device.id, userId: device.userId, name: device.name, player: playerNameOf(device.user.email) };
}

export interface DialDeck {
  /** The deck's public id: what the art route and a game report name it by. */
  id: string;
  name: string;
  format: string;
  commander: string | null;
  /** Colour identity, in WUBRG order: "UBR". */
  colors: string;
  bracket: number | null;
  score: number | null;
  gamesPlayed: number;
  gamesWon: number;
  /** Changes when the picture would: the dial downloads the art again only then. Null: no art. */
  art: string | null;
}

/** The first commander's stored scan (a partner pair is "A + B"). */
function coverOf(commander: string | null, cards: { name: string; imageUri: string }[]): string | null {
  const want = (commander ?? "").split("+")[0]!.trim().toLowerCase();
  if (!want) return null;
  return cards.find((c) => c.imageUri && c.name.toLowerCase() === want)?.imageUri ?? null;
}

/** A short tag of a picture's source: the art changes when this does. */
export const artTag = (src: string) => tokenHash(src).slice(0, 12);

/** The decks sent to a dial, as it shows them. A deck its owner has since
    deleted is gone from here (the row cascades). */
export async function decksForDevice(deviceId: number): Promise<DialDeck[]> {
  const rows = await prisma.deviceDeck.findMany({
    where: { deviceId },
    orderBy: { addedAt: "asc" },
    include: { deck: { select: { id: true, publicId: true, name: true, format: true, commander: true, analysis: true, gamesPlayed: true, gamesWon: true } } },
  });
  const decks = rows.map((r) => r.deck).filter((d) => d.publicId);
  const cards = await prisma.poolCard.findMany({ where: { deckId: { in: decks.map((d) => d.id) } }, select: { deckId: true, name: true, imageUri: true, colorIdentity: true } });
  return decks.map((d) => {
    const mine = cards.filter((c) => c.deckId === d.id);
    const ids = new Set(mine.flatMap((c) => [...(c.colorIdentity ?? "")]));
    const scan = scanSummary(d.analysis);
    const cover = coverOf(d.commander, mine);
    return {
      id: d.publicId!,
      name: d.name,
      format: d.format,
      commander: d.commander,
      colors: [..."WUBRG"].filter((c) => ids.has(c)).join(""),
      bracket: scan?.bracket ?? null,
      score: scan ? Number(scan.score.toFixed(2)) : null,
      gamesPlayed: d.gamesPlayed,
      gamesWon: d.gamesWon,
      art: cover ? artTag(cover) : null,
    };
  });
}

/** The stored scan of a deck's commander, when the deck is on this dial. */
export async function coverForDevice(deviceId: number, publicId: string): Promise<string | null> {
  const row = await prisma.deviceDeck.findFirst({ where: { deviceId, deck: { publicId } }, include: { deck: { select: { id: true, commander: true } } } });
  if (!row) return null;
  const cards = await prisma.poolCard.findMany({ where: { deckId: row.deck.id }, select: { name: true, imageUri: true } });
  return coverOf(row.deck.commander, cards);
}

// ── The owner's side (the /dial page, a deck's "Send to dial") ─────────

export interface DialSummary {
  id: number;
  name: string;
  firmware: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  /** Public ids of the decks on it. */
  decks: string[];
}

export async function dialsOf(userId: number): Promise<DialSummary[]> {
  const rows = await prisma.device.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { decks: { orderBy: { addedAt: "asc" }, include: { deck: { select: { publicId: true } } } } },
  });
  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    firmware: d.firmware,
    createdAt: d.createdAt.toISOString(),
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    decks: d.decks.flatMap((x) => (x.deck.publicId ? [x.deck.publicId] : [])),
  }));
}

export type SendResult = "ok" | "no-dial" | "no-deck" | "full";

/** Put one of your decks on one of your dials, or take it off. */
export async function setDeckOnDial(userId: number, deviceId: number, publicId: string, on: boolean): Promise<SendResult> {
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId }, select: { id: true } });
  if (!device) return "no-dial";
  // Your own decks only: a dial reports games onto them.
  const deck = await prisma.deck.findFirst({ where: { publicId, userId }, select: { id: true } });
  if (!deck) return "no-deck";
  if (!on) {
    await prisma.deviceDeck.deleteMany({ where: { deviceId, deckId: deck.id } });
    return "ok";
  }
  const have = await prisma.deviceDeck.findMany({ where: { deviceId }, select: { deckId: true } });
  if (have.some((x) => x.deckId === deck.id)) return "ok";
  if (have.length >= MAX_DECKS_PER_DEVICE) return "full";
  await prisma.deviceDeck.create({ data: { deviceId, deckId: deck.id } }).catch(() => {});
  return "ok";
}
