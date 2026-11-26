// The home page's collection block: the counts and a few pictured cards.
// GET /api/collection?summary=1 answers with it, and the home page renders
// with it on the server.

import prisma from "@/lib/prisma";

// Cards the summary shows.
const SAMPLE = 7;

export async function collectionSummary(userId: number) {
  const where = { userId };
  const [unique, sum, pending] = await Promise.all([
    prisma.collectionCard.count({ where }),
    prisma.collectionCard.aggregate({ where, _sum: { quantity: true } }),
    prisma.collectionCard.count({ where: { ...where, enriched: false } }),
  ]);
  // A few cards to show, from a different place in the collection each time.
  const withArt = { ...where, imageUri: { not: null } };
  const pictured = unique ? await prisma.collectionCard.count({ where: withArt }) : 0;
  const sample = pictured
    ? await prisma.collectionCard.findMany({ where: withArt, select: { name: true, imageUri: true }, orderBy: { id: "asc" }, skip: Math.floor(Math.random() * Math.max(1, pictured - SAMPLE + 1)), take: SAMPLE })
    : [];
  return { unique, total: sum._sum.quantity ?? 0, pending, sample };
}
