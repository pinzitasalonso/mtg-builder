import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";

// How a practice game ended, as the table reports it: "won" or "lost" (the
// player's side) and the turn. Written once: a game's result doesn't change.
// It's the player's own record of their own practice, so it's taken at their
// word. The answer has the deck's record so far.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const id = (await params).id;
  const body = (await req.json().catch(() => null)) as { result?: unknown; turn?: unknown } | null;
  const result = body?.result === "won" || body?.result === "lost" ? body.result : null;
  if (!result) return NextResponse.json({ error: "result required" }, { status: 400 });
  const turn = Number.isInteger(body?.turn) && (body!.turn as number) > 0 ? Math.min(body!.turn as number, 999) : null;
  const row = await prisma.practiceGame.findFirst({ where: { id, userId: user.id }, select: { deck: true } });
  if (!row) return NextResponse.json({ error: "game not found" }, { status: 404 });
  await prisma.practiceGame.updateMany({ where: { id, userId: user.id, result: null }, data: { result, endTurn: turn } });
  const results = row.deck ? await prisma.practiceGame.groupBy({ by: ["result"], where: { userId: user.id, deck: row.deck, result: { not: null } }, _count: true }) : [];
  const count = (r: string) => results.find((x) => x.result === r)?._count ?? 0;
  return NextResponse.json({ ok: true, record: { won: count("won"), lost: count("lost") } });
}
