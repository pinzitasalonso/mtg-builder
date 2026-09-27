import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { getRun } from "@/lib/assistant-runner";

export const runtime = "nodejs";

// Stop a reply that's still being written. What it wrote so far stays, and
// no further tools run.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to use the assistant." }, { status: 401 });
  const id = Number((await params).id);
  const own = Number.isInteger(id)
    ? await prisma.assistantMessage.findFirst({ where: { id, thread: { userId: user.id } }, select: { id: true } })
    : null;
  if (!own) return NextResponse.json({ error: "not found" }, { status: 404 });
  getRun(id)?.stop();
  return NextResponse.json({ ok: true });
}
