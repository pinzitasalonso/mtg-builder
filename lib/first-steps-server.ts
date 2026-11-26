// Which of the free plan's three daily things an account has tried
// (lib/first-steps.ts has what they are), and whether home still shows them.

import prisma from "@/lib/prisma";
import { allTried, type FirstSteps } from "@/lib/first-steps";

/** What the account has tried: a question to the coach, a practice match
    (against either opponent), a scan of one of its decks. */
export async function firstStepsOf(userId: number): Promise<FirstSteps> {
  const [asked, played, scanned] = await Promise.all([
    prisma.assistantMessage.findFirst({ where: { role: "user", thread: { userId } }, select: { id: true } }),
    prisma.practiceGame.findFirst({ where: { userId }, select: { id: true } }),
    prisma.deck.findFirst({ where: { userId, analyzedAt: { not: null } }, select: { id: true } }),
  ]);
  return { coach: !!asked, match: !!played, score: !!scanned };
}

/** The block for home, or null when there's nothing to show: Pro has no
    daily limit to tell anyone about, an account that tried all three knows
    them, and one that put the block away said so. */
export async function stepsToShow(user: { id: number; tier: string }): Promise<FirstSteps | null> {
  if (user.tier === "pro") return null;
  const [row, steps] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { firstStepsOffAt: true } }),
    firstStepsOf(user.id),
  ]);
  return !row || row.firstStepsOffAt || allTried(steps) ? null : steps;
}

/** Put the block away, on every device the account signs in on. */
export async function putStepsAway(userId: number): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { firstStepsOffAt: new Date() } });
}
