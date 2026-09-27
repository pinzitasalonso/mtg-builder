import Anthropic from "@anthropic-ai/sdk";
import prisma from "@/lib/prisma";
import type { TierFields } from "@/lib/limits";
import { ASSISTANT_TOOLS, runAssistantTool } from "@/lib/assistant-tools";
import { buildAssistantSystem } from "@/lib/assistant-context";
import { historyForModel } from "@/lib/assistant-history";

/* Writes the assistant's answers on the server, detached from any request.

   The request that asks a question only starts a run and returns. The run
   calls the model, runs the tools it asks for, and keeps the reply in memory
   (for anyone watching live) and in the database (for anyone who comes back
   later). So closing the chat, moving to another deck, reloading, or a phone
   suspending the tab doesn't cut an answer off: the client reconnects to the
   run, or reads the finished reply.

   Runs live in this process. Spellpool runs one server, so that is all of
   them; a deploy restarts it, and a reply that was mid-run is then marked
   "interrupted" the next time the thread is read. */

export type RunStatus = "running" | "done" | "stopped" | "failed" | "interrupted";

export interface Run {
  messageId: number;
  userId: number;
  text: string;
  status: RunStatus;
  /** Bumped each time a tool changes a deck, so watchers can refresh. */
  decksChanged: number;
  stop: () => void;
  /** Called on every change; each watcher reads what it needs from the run. */
  listeners: Set<() => void>;
}

// On globalThis so a dev-server module reload doesn't orphan running answers.
const g = globalThis as unknown as { __spAssistantRuns?: Map<number, Run> };
const runs: Map<number, Run> = (g.__spAssistantRuns ??= new Map());

export function getRun(messageId: number): Run | undefined {
  return runs.get(messageId);
}

export function runningForUser(userId: number): Run | undefined {
  for (const r of runs.values()) if (r.userId === userId && r.status === "running") return r;
  return undefined;
}

// Model passes per question: pause_turn resumes plus rounds of tool calls.
const MAX_PASSES = 8;
// How many pause_turn resumes, of those passes, before stopping the research.
const MAX_RESUMES = 3;
// How often a running reply is written to the database.
const FLUSH_MS = 1000;

export const INTERRUPTED_NOTE = "_(This answer was cut off when the server restarted. Ask again to pick it up.)_";

function stopNote(stop: Anthropic.Message["stop_reason"]): string | null {
  switch (stop) {
    case "max_tokens":
      return "_(That hit the length limit — ask me to continue and I'll pick up where I left off.)_";
    case "refusal":
      return "_(I stopped there and can't continue that one. Try rephrasing it?)_";
    case "pause_turn":
      return "_(I ran out of research time on that one — ask again and I'll keep going.)_";
    case "tool_use":
      return "_(I ran out of steps on that one — ask me to continue and I'll pick up where I left off.)_";
    default:
      return null;
  }
}

export function startRun(opts: {
  user: { id: number } & TierFields;
  threadId: number;
  messageId: number;
  focusDeckId: number | null;
  latestUser: string;
}): Run {
  const { user, messageId } = opts;
  let current: { abort(): void } | null = null;
  let stopped = false;
  const run: Run = {
    messageId,
    userId: user.id,
    text: "",
    status: "running",
    decksChanged: 0,
    listeners: new Set(),
    // Ends the reply at once, even mid-research before the model has been
    // called: the player sees it stop when they press Stop, not later.
    stop: () => {
      stopped = true;
      current?.abort();
      void finish("stopped");
    },
  };
  runs.set(messageId, run);
  const notify = () => run.listeners.forEach((l) => l());

  let lastFlush = 0;
  let flushing: Promise<unknown> = Promise.resolve();
  const flush = (force = false) => {
    const now = Date.now();
    if (!force && now - lastFlush < FLUSH_MS) return;
    lastFlush = now;
    const content = run.text;
    const status = run.status;
    // Chained, so an older write can never land after a newer one.
    flushing = flushing
      .then(() => prisma.assistantMessage.update({ where: { id: messageId }, data: { content, status } }))
      .catch((e) => console.error("[assistant] flush failed", e instanceof Error ? e.message : e));
  };
  const append = (s: string) => {
    if (finished) return;
    run.text += s;
    notify();
    flush();
  };
  // The one way a reply ends. Idempotent: Stop may get here first, and the
  // loop, winding down after it, then changes nothing.
  let finished = false;
  async function finish(status: RunStatus, tail = "") {
    if (finished) return;
    finished = true;
    run.text += tail;
    run.status = status;
    flush(true);
    await flushing;
    // Watchers read the final state from the run before it goes; anyone
    // later reads the database, which now has it.
    notify();
    runs.delete(messageId);
  }

  void (async () => {
    const anthropic = new Anthropic();
    try {
      const rows = await prisma.assistantMessage.findMany({
        where: { threadId: opts.threadId, id: { lt: messageId } },
        orderBy: { id: "asc" },
        select: { role: true, content: true, deck: { select: { publicId: true, name: true } } },
      });
      const { system, stats } = await buildAssistantSystem(anthropic, user.id, opts.focusDeckId, opts.latestUser);
      const convo: Anthropic.MessageParam[] = historyForModel(rows);
      let finalStop: Anthropic.Message["stop_reason"] = null;
      for (let pass = 0; pass < MAX_PASSES && !stopped; pass++) {
        const ai = anthropic.messages.stream({
          model: "claude-opus-5-5",
          max_tokens: 32000,
          output_config: { effort: "medium" },
          system,
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }, ...ASSISTANT_TOOLS],
          messages: convo,
        });
        current = ai;
        for await (const event of ai) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") append(event.delta.text);
        }
        const final = await ai.finalMessage();
        const u = final.usage;
        console.log(
          `[assistant] pass=${pass} decks=${stats.decks} owned=${stats.owned} researched=${stats.researched} ` +
            `fresh=${u.input_tokens} cache_write=${u.cache_creation_input_tokens ?? 0} ` +
            `cache_read=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens} stop=${final.stop_reason}`
        );
        finalStop = final.stop_reason;
        if (final.stop_reason === "pause_turn") {
          if (pass >= MAX_RESUMES) break;
          convo.push({ role: "assistant", content: final.content });
          continue;
        }
        if (final.stop_reason !== "tool_use" || stopped) break;

        // Run the tools the model asked for, show the player what they did,
        // and hand the results back for the next pass.
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")) {
          const out = await runAssistantTool(user, use.name, use.input);
          if (out.note) append(`\n\n**${out.note}**\n\n`);
          if (out.changed) {
            run.decksChanged++;
            notify();
          }
          results.push({ type: "tool_result", tool_use_id: use.id, content: out.result, is_error: out.isError || undefined });
        }
        convo.push({ role: "assistant", content: final.content });
        convo.push({ role: "user", content: results });
      }
      if (stopped) {
        await finish("stopped");
      } else {
        const note = stopNote(finalStop);
        await finish("done", note ? `\n\n${note}` : "");
      }
    } catch (e) {
      if (stopped) {
        await finish("stopped");
      } else {
        // The detail goes to the logs; the player gets a sentence to act on.
        console.error("[assistant] failed", e instanceof Error ? e.message : e);
        const busy = e instanceof Anthropic.APIError && (e.status === 429 || e.status === 529 || (e.status ?? 0) >= 500);
        await finish(
          "failed",
          busy
            ? "\n\n_The assistant is busy right now. Give it a moment and ask again._"
            : "\n\n_Sorry — the assistant hit an error. Try asking again._"
        );
      }
    }
  })();

  return run;
}
