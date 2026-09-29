import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { aiLimitMsg } from "@/lib/limits";
import { proOnSale } from "@/lib/revenuecat";
import { consumeAi } from "@/lib/limits-db";
import { INTERRUPTED_NOTE, getRun, runningForUser, startRun } from "@/lib/assistant-runner";

export const runtime = "nodejs";

// Spellpool's one assistant, as a conversation kept on the server.
//
//   GET     the current thread (the latest one), with any reply still running
//   POST    ask: { content, deckId? } — deckId is the deck on screen, if any.
//           Starts the reply on the server and returns at once; the client
//           follows it at /api/assistant/<id>/stream.
//   DELETE  start a new conversation
//
// The iOS app and signed-out visitors keep using /api/chat, which is
// stateless and streams in the response.

const MAX_MESSAGE_CHARS = 8000;

const messageSelect = {
  id: true,
  role: true,
  content: true,
  status: true,
  deck: { select: { publicId: true, name: true } },
} as const;

type Row = { id: number; role: string; content: string; status: string; deck: { publicId: string | null; name: string } | null };

function shape(m: Row) {
  return { id: m.id, role: m.role, content: m.content, status: m.status, deck: m.deck?.publicId ? { publicId: m.deck.publicId, name: m.deck.name } : null };
}

async function latestThread(userId: number) {
  return prisma.assistantThread.findFirst({ where: { userId }, orderBy: { id: "desc" }, select: { id: true } });
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to use the assistant." }, { status: 401 });
  const thread = await latestThread(user.id);
  if (!thread) return NextResponse.json({ messages: [] });
  const rows = await prisma.assistantMessage.findMany({ where: { threadId: thread.id }, orderBy: { id: "asc" }, select: messageSelect });
  const messages = await Promise.all(
    rows.map(async (m) => {
      if (m.status !== "running") return shape(m);
      const run = getRun(m.id);
      if (run) return shape({ ...m, content: run.text });
      // Marked running, but no run in this process: the server restarted under
      // it. Say so, once, in the reply itself.
      const content = (m.content ? `${m.content}\n\n` : "") + INTERRUPTED_NOTE;
      await prisma.assistantMessage.update({ where: { id: m.id }, data: { content, status: "interrupted" } });
      return shape({ ...m, content, status: "interrupted" });
    })
  );
  return NextResponse.json({ messages });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to use the assistant." }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "AI is not configured." }, { status: 503 });

  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim().slice(0, MAX_MESSAGE_CHARS) : "";
  if (!content) return NextResponse.json({ error: "Say something first." }, { status: 400 });
  // One answer at a time: the next question waits for it, or for Stop.
  if (runningForUser(user.id)) {
    return NextResponse.json({ error: "Still answering — wait for it or press Stop." }, { status: 409 });
  }
  const focus =
    typeof body?.deckId === "string"
      ? await prisma.deck.findFirst({ where: { publicId: body.deckId, userId: user.id }, select: { id: true } })
      : null;
  // Metered after validation, so a malformed request doesn't cost a question.
  if (!(await consumeAi(user))) {
    return NextResponse.json({ error: aiLimitMsg(proOnSale()), code: "ai_limit" }, { status: 429 });
  }

  const thread = (await latestThread(user.id)) ?? (await prisma.assistantThread.create({ data: { userId: user.id }, select: { id: true } }));
  const asked = await prisma.assistantMessage.create({
    data: { threadId: thread.id, role: "user", content, deckId: focus?.id ?? null },
    select: messageSelect,
  });
  const reply = await prisma.assistantMessage.create({
    data: { threadId: thread.id, role: "assistant", status: "running", deckId: focus?.id ?? null },
    select: messageSelect,
  });
  startRun({ user, threadId: thread.id, messageId: reply.id, focusDeckId: focus?.id ?? null, latestUser: content });
  return NextResponse.json({ user: shape(asked), assistant: shape(reply) });
}

export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to use the assistant." }, { status: 401 });
  runningForUser(user.id)?.stop();
  await prisma.assistantThread.create({ data: { userId: user.id } });
  return NextResponse.json({ ok: true });
}
