import type { MetadataRoute } from "next";
import prisma from "@/lib/prisma";
import { SITE_URL } from "@/lib/landing";

// Rendered per request, not at build time: the build has no database, so a
// prerendered sitemap would list no decks at all. The query is one indexed
// read, and crawlers fetch this rarely.
export const dynamic = "force-dynamic";

// The deck pages anyone can open: ownerless public decks and decks their
// owner shared. Private decks are never listed. Capped, newest first — the
// sitemap is a hint to crawlers, not an index of everything.
const MAX_DECKS = 2000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.2 },
  ];
  const decks = await prisma.deck
    .findMany({
      where: { publicId: { not: null }, OR: [{ userId: null }, { shared: true }], cards: { some: {} } },
      select: { publicId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: MAX_DECKS,
    })
    .catch(() => []);
  return [
    ...pages,
    ...decks.map((d) => ({ url: `${SITE_URL}/deck/${d.publicId}`, lastModified: d.createdAt, changeFrequency: "weekly" as const, priority: 0.5 })),
  ];
}
