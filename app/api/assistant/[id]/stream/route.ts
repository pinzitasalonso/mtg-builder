import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { getRun } from "@/lib/assistant-runner";

export const runtime = "nodejs";

// Follow a reply as the server writes it. Newline-delimited JSON:
//   {"t": "..."}      more text
//   {"decks": n}      a tool changed a deck (n counts them): refresh
//   {"end": status}   finished: done | stopped | failed | interrupted
//   {}                heartbeat, so idle proxies don't cut the connection
// ?from=N skips the first N characters, for a client picking up where it left
// off. Leaving doesn't stop the reply; only /stop does.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to use the assistant." }, { status: 401 });
  const id = Number((await params).id);
  const row = Number.isInteger(id)
    ? await prisma.assistantMessage.findFirst({ where: { id, thread: { userId: user.id } }, select: { content: true, status: true } })
    : null;
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const from = Math.max(0, Number(new URL(req.url).searchParams.get("from")) || 0);

  const encoder = new TextEncoder();
  const line = (o: object) => encoder.encode(JSON.stringify(o) + "\n");
  const headers = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" };

  const run = getRun(id);
  if (!run) {
    // Finished (or never ran in this process): what's stored is all there is.
    const rest = row.content.slice(from);
    const body = [rest ? line({ t: rest }) : null, line({ end: row.status === "running" ? "interrupted" : row.status })].filter(Boolean) as Uint8Array[];
    return new Response(new Blob(body as BlobPart[]).stream(), { headers });
  }

  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let sent = from;
      let decks = 0;
      let closed = false;
      const push = () => {
        if (closed) return;
        try {
          if (run.text.length > sent) {
            controller.enqueue(line({ t: run.text.slice(sent) }));
            sent = run.text.length;
          }
          if (run.decksChanged > decks) {
            decks = run.decksChanged;
            controller.enqueue(line({ decks }));
          }
          if (run.status !== "running") {
            controller.enqueue(line({ end: run.status }));
            cleanup();
            controller.close();
          }
        } catch {
          cleanup();
        }
      };
      const beat = setInterval(() => {
        try {
          controller.enqueue(line({}));
        } catch {
          cleanup();
        }
      }, 10000);
      cleanup = () => {
        closed = true;
        clearInterval(beat);
        run.listeners.delete(push);
      };
      run.listeners.add(push);
      push();
    },
    cancel() {
      cleanup();
    },
  });
  req.signal.addEventListener("abort", () => cleanup());
  return new Response(stream, { headers });
}
