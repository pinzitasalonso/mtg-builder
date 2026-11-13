// Plan limits — the DB half. Server-only (imports Prisma).

import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { FREE_AI_PER_DAY, FREE_PRACTICE_PER_DAY, FREE_SCANS_PER_DAY, isPro, utcDay, type TierFields } from "@/lib/limits";

/* Spend one AI call from the user's daily budget. Returns false when the
   budget is exhausted (free tier only — pro never runs out). Each UPDATE's
   WHERE clause makes it a compare-and-set, so two parallel requests can't
   spend the same unit or slip past the cap. */
export async function consumeAi(user: { id: number } & TierFields): Promise<boolean> {
  if (isPro(user)) return true;
  const day = utcDay();
  // First claim of a new day resets the meter to 1…
  const freshDay = await prisma.user.updateMany({
    where: { id: user.id, OR: [{ aiDay: null }, { aiDay: { not: day } }] },
    data: { aiDay: day, aiCount: 1 },
  });
  if (freshDay.count === 1) return true;
  // …otherwise spend one unit only while under the cap.
  const spent = await prisma.user.updateMany({
    where: { id: user.id, aiDay: day, aiCount: { lt: FREE_AI_PER_DAY } },
    data: { aiCount: { increment: 1 } },
  });
  return spent.count === 1;
}

/* Spend one deck scan from the user's daily budget. Same compare-and-set
   shape as consumeAi, on its own columns. */
export async function consumeScan(user: { id: number } & TierFields): Promise<boolean> {
  if (isPro(user)) return true;
  const day = utcDay();
  const freshDay = await prisma.user.updateMany({
    where: { id: user.id, OR: [{ scanDay: null }, { scanDay: { not: day } }] },
    data: { scanDay: day, scanCount: 1 },
  });
  if (freshDay.count === 1) return true;
  const spent = await prisma.user.updateMany({
    where: { id: user.id, scanDay: day, scanCount: { lt: FREE_SCANS_PER_DAY } },
    data: { scanCount: { increment: 1 } },
  });
  return spent.count === 1;
}

/* Give a scan back — the analysis failed, and a failed scan is not one the
   player used. Only today's meter, only above zero. */
export async function refundScan(user: { id: number } & TierFields): Promise<void> {
  if (isPro(user)) return;
  await prisma.user.updateMany({
    where: { id: user.id, scanDay: utcDay(), scanCount: { gt: 0 } },
    data: { scanCount: { decrement: 1 } },
  });
}

/* Claim a practice game for today: its row is created (empty, to be filled
   once the decks have loaded) in the same transaction that counts the games
   started since midnight UTC, so parallel requests can't all get under the
   free allowance. Returns the game's id, or null when today's are used up.
   A game that fails to start is deleted, which gives the claim back.
   A game against the basic bot (no model call) is free: it isn't counted,
   and doesn't count. */
export async function claimPractice(user: { id: number } & TierFields, bot = false): Promise<string | null> {
  const id = randomUUID();
  const since = new Date(`${utcDay()}T00:00:00.000Z`);
  return prisma.$transaction(async (tx) => {
    if (!bot && !isPro(user)) {
      const started = await tx.practiceGame.count({ where: { userId: user.id, bot: false, createdAt: { gte: since } } });
      if (started >= FREE_PRACTICE_PER_DAY) return null;
    }
    await tx.practiceGame.create({ data: { id, userId: user.id, label: "", setup: "{}", bot } });
    return id;
  });
}
