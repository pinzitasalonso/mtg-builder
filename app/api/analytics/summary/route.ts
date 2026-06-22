import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { EVENT_TYPES, isAnalyticsAdmin } from "@/lib/analytics";

export const runtime = "nodejs";

// Admin-only analytics summary: lifetime totals per event, a last-30-day daily
// series, and live counts of users/decks. Gated to ANALYTICS_ADMIN_EMAIL.
export async function GET() {
  const user = await currentUser();
  if (!isAnalyticsAdmin(user?.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rows = await prisma.analyticsDaily.findMany({ orderBy: { day: "asc" } });

  const totals: Record<string, number> = {};
  for (const t of EVENT_TYPES) totals[t] = 0;
  for (const r of rows) totals[r.type] = (totals[r.type] ?? 0) + r.count;

  // Last 30 days (UTC), filled so gaps render as zero.
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }
  const byDay = new Map<string, Record<string, number>>();
  for (const d of days) byDay.set(d, Object.fromEntries(EVENT_TYPES.map((t) => [t, 0])));
  for (const r of rows) {
    const bucket = byDay.get(r.day);
    if (bucket) bucket[r.type] = r.count;
  }
  const series = days.map((day) => ({ day, ...byDay.get(day)! }));

  const [users, decks] = await Promise.all([prisma.user.count(), prisma.deck.count()]);

  return NextResponse.json({ totals, series, users, decks, types: EVENT_TYPES });
}
