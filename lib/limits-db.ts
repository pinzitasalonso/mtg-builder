// Plan limits — the DB half. Server-only (imports Prisma).

import prisma from "@/lib/prisma";
import { FREE_AI_PER_DAY, FREE_DECK_LIMIT, isPro, utcDay, type TierFields } from "@/lib/limits";

/* Spend one AI call from the user's daily budget. Returns false when the
   budget is exhausted (free tier only — pro never runs out). */
export async function consumeAi(user: { id: number } & TierFields): Promise<boolean> {
  if (isPro(user)) return true;
  const day = utcDay();
  const fresh = await prisma.user.findUnique({
    where: { id: user.id },
    select: { aiDay: true, aiCount: true },
  });
  const used = fresh?.aiDay === day ? fresh.aiCount : 0;
  if (used >= FREE_AI_PER_DAY) return false;
  await prisma.user.update({ where: { id: user.id }, data: { aiDay: day, aiCount: used + 1 } });
  return true;
}

/* Whether the user may create (or duplicate into) another deck. */
export async function canCreateDeck(user: { id: number } & TierFields): Promise<boolean> {
  if (isPro(user)) return true;
  const count = await prisma.deck.count({ where: { userId: user.id } });
  return count < FREE_DECK_LIMIT;
}
