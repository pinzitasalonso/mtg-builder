import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { isAnalyticsAdmin } from "@/lib/analytics";
import { latest, summarize, type AccountRow } from "@/lib/admin-stats";
import { lastNDays } from "@/lib/admin-stats";

export const runtime = "nodejs";

// Admin only: every account with its email and what it has done, plus the
// numbers the dashboard draws from them (activity, signups, the funnel, deck
// formats). Gated to ANALYTICS_ADMIN_EMAIL, like the event summary.
export async function GET() {
  const user = await currentUser();
  if (!isAnalyticsAdmin(user?.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [users, decks, deckCards, lastCard, versions, collection, sessions, threads] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, displayName: true, createdAt: true, tier: true, emailVerifiedAt: true, passwordHash: true, accounts: { select: { provider: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.deck.findMany({
      where: { userId: { not: null } },
      select: { id: true, publicId: true, name: true, userId: true, format: true, createdAt: true, gamesPlayed: true, analyzedAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.poolCard.groupBy({ by: ["deckId"], where: { board: "deck" }, _sum: { quantity: true } }),
    prisma.poolCard.groupBy({ by: ["deckId"], _max: { addedAt: true } }),
    prisma.deckVersion.groupBy({ by: ["deckId"], _count: { _all: true } }),
    prisma.collectionCard.groupBy({ by: ["userId"], _count: { _all: true } }),
    prisma.session.groupBy({ by: ["userId"], _max: { createdAt: true } }),
    prisma.assistantThread.findMany({ select: { id: true, userId: true } }),
  ]);
  const [asked, asked7d] = await Promise.all([
    prisma.assistantMessage.groupBy({ by: ["threadId"], where: { role: "user" }, _count: { _all: true }, _max: { createdAt: true } }),
    prisma.assistantMessage.groupBy({ by: ["threadId"], where: { role: "user", createdAt: { gte: weekAgo } }, _count: { _all: true } }),
  ]);

  const cardsBy = new Map(deckCards.map((d) => [d.deckId, d._sum.quantity ?? 0]));
  const lastCardBy = new Map(lastCard.map((d) => [d.deckId, d._max.addedAt]));
  const versionsBy = new Map(versions.map((d) => [d.deckId, d._count._all]));
  const collectionBy = new Map(collection.map((c) => [c.userId, c._count._all]));
  const sessionBy = new Map(sessions.map((s) => [s.userId, s._max.createdAt]));
  const threadUser = new Map(threads.map((t) => [t.id, t.userId]));
  const askedBy = new Map<number, { n: number; last: Date | null }>();
  for (const a of asked) {
    const uid = threadUser.get(a.threadId);
    if (uid === undefined) continue;
    const cur = askedBy.get(uid) ?? { n: 0, last: null };
    cur.n += a._count._all;
    if (a._max.createdAt && (!cur.last || a._max.createdAt > cur.last)) cur.last = a._max.createdAt;
    askedBy.set(uid, cur);
  }
  const asked7dBy = new Map<number, number>();
  for (const a of asked7d) {
    const uid = threadUser.get(a.threadId);
    if (uid !== undefined) asked7dBy.set(uid, (asked7dBy.get(uid) ?? 0) + a._count._all);
  }
  const decksBy = new Map<number, typeof decks>();
  for (const d of decks) {
    const list = decksBy.get(d.userId!) ?? [];
    list.push(d);
    decksBy.set(d.userId!, list);
  }

  const rows: AccountRow[] = users.map((u) => {
    const own = decksBy.get(u.id) ?? [];
    const cards = own.map((d) => cardsBy.get(d.id) ?? 0);
    const providers = u.accounts.map((a) => a.provider);
    return {
      id: u.id,
      email: u.email,
      name: u.displayName,
      createdAt: u.createdAt.toISOString(),
      tier: u.tier,
      verified: Boolean(u.emailVerifiedAt) || providers.length > 0,
      signIn: [...(u.passwordHash ? ["password"] : []), ...new Set(providers)],
      decks: own.length,
      builtDecks: cards.filter((n) => n >= 60).length,
      cards: cards.reduce((a, b) => a + b, 0),
      collection: collectionBy.get(u.id) ?? 0,
      aiQuestions: askedBy.get(u.id)?.n ?? 0,
      aiQuestions7d: asked7dBy.get(u.id) ?? 0,
      scans: own.filter((d) => d.analyzedAt).length,
      versions: own.reduce((n, d) => n + (versionsBy.get(d.id) ?? 0), 0),
      games: own.reduce((n, d) => n + d.gamesPlayed, 0),
      deckList: own.slice(0, 25).map((d) => ({
        publicId: d.publicId ?? "",
        name: d.name,
        format: d.format,
        cards: cardsBy.get(d.id) ?? 0,
        scanned: Boolean(d.analyzedAt),
        createdAt: d.createdAt.toISOString(),
      })),
      lastActive: latest(u.createdAt, sessionBy.get(u.id), askedBy.get(u.id)?.last, ...own.map((d) => d.createdAt), ...own.map((d) => lastCardBy.get(d.id))),
    };
  });

  // Questions per day, the last 30 days, from the assistant's thread.
  const days = lastNDays(30);
  const recent = await prisma.assistantMessage.findMany({
    where: { role: "user", createdAt: { gte: new Date(days[0] + "T00:00:00Z") } },
    select: { createdAt: true },
  });
  const perDay = new Map(days.map((d) => [d, 0]));
  for (const m of recent) {
    const d = m.createdAt.toISOString().slice(0, 10);
    if (perDay.has(d)) perDay.set(d, perDay.get(d)! + 1);
  }
  // Decks made per day, the same 30 days.
  const deckPerDay = new Map(days.map((d) => [d, 0]));
  for (const d of decks) {
    const k = d.createdAt.toISOString().slice(0, 10);
    if (deckPerDay.has(k)) deckPerDay.set(k, deckPerDay.get(k)! + 1);
  }

  const formats = new Map<string, number>();
  for (const d of decks) formats.set(d.format, (formats.get(d.format) ?? 0) + 1);

  return NextResponse.json({
    summary: summarize(rows),
    aiDays: days.map((day) => ({ day, count: perDay.get(day)! })),
    deckDays: days.map((day) => ({ day, count: deckPerDay.get(day)! })),
    formats: [...formats].map(([format, count]) => ({ format, count })).sort((a, b) => b.count - a.count),
    accounts: rows,
  });
}
