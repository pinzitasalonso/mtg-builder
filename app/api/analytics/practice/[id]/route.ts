import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { isAnalyticsAdmin } from "@/lib/analytics";
import { traceText, type TraceRow, type TurnTrace } from "@/lib/practice/trace";

export const runtime = "nodejs";

// Admin only: one practice match's kept turns as plain text, to read or to
// paste to whoever is tuning the opponent (lib/practice/trace.ts).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!isAnalyticsAdmin(user?.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const game = await prisma.practiceGame.findUnique({
    where: { id: (await params).id },
    select: { label: true, bot: true, result: true, endTurn: true, createdAt: true, trace: { orderBy: { id: "asc" }, select: { turn: true, source: true, data: true } } },
  });
  if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });
  const rows: TraceRow[] = game.trace.flatMap((t) => {
    try {
      return [{ turn: t.turn, source: t.source, data: JSON.parse(t.data) as TurnTrace }];
    } catch {
      return [];
    }
  });
  return new NextResponse(traceText(game, rows), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
}
