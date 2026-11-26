import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { isAnalyticsAdmin } from "@/lib/analytics";
import { traceStats, type TraceRow, type TurnTrace } from "@/lib/practice/trace";

export const runtime = "nodejs";

// Admin only: the latest practice matches with what their kept turns say
// (lib/practice/trace.ts): how long the match took, who planned the
// opponent's turns, and how many of them cast nothing. Each one's turns can
// be read as text at /api/analytics/practice/<id>.
export async function GET() {
  const user = await currentUser();
  if (!isAnalyticsAdmin(user?.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const games = await prisma.practiceGame.findMany({
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true, createdAt: true, label: true, bot: true, result: true, endTurn: true, turns: true, user: { select: { email: true } }, trace: { orderBy: { id: "asc" }, select: { turn: true, source: true, data: true } } },
  });
  const matches = games.map((g) => {
    const rows: TraceRow[] = g.trace.flatMap((t) => {
      try {
        return [{ turn: t.turn, source: t.source, data: JSON.parse(t.data) as TurnTrace }];
      } catch {
        return [];
      }
    });
    const stats = traceStats(rows);
    return { id: g.id, at: g.createdAt, email: g.user.email, opponent: g.label, bot: g.bot, result: g.result, endTurn: g.endTurn, aiTurns: g.turns, traced: rows.length, ...stats };
  });
  // Finished matches against the smart opponent with their turns kept: how
  // long they take, and how many of the opponent's turns do nothing.
  const smart = matches.filter((m) => !m.bot && m.result && m.known > 0);
  const sorted = smart.map((m) => m.endTurn ?? 0).sort((a, b) => a - b);
  const summary = {
    matches: smart.length,
    medianEndTurn: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null,
    idle: smart.reduce((n, m) => n + m.idle, 0),
    known: smart.reduce((n, m) => n + m.known, 0),
  };
  return NextResponse.json({ matches, summary });
}
