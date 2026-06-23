// A tiny offline mutation queue for deck review. While offline, "promote to
// deck" (move) and "discard" (remove) decisions are stored locally and replayed
// against the API once the connection is back. Only moves/removes of EXISTING
// cards are queued — no offline card creation — so the row ids stay valid.

export interface PendingOp {
  id: string;
  deckId: string; // deck publicId
  kind: "move" | "remove";
  dbId: number;
  board?: "pool" | "deck";
}

const KEY = "sp_offline_queue";

function read(): PendingOp[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingOp[]) : [];
  } catch {
    return [];
  }
}

function write(ops: PendingOp[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ops));
  } catch {
    /* storage full / unavailable — best effort */
  }
}

export function enqueue(op: Omit<PendingOp, "id">): void {
  const ops = read();
  ops.push({ ...op, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
  write(ops);
}

export function pendingFor(deckId: string): PendingOp[] {
  return read().filter((o) => o.deckId === deckId);
}

// Overlay the queued moves/removes for a deck onto a freshly-loaded card list so
// the UI reflects offline decisions even after a (cached) refetch.
export function applyPending<T extends { dbId: number; board: "pool" | "deck" }>(
  deckId: string,
  cards: T[]
): T[] {
  const ops = pendingFor(deckId);
  if (ops.length === 0) return cards;
  let out = cards;
  for (const op of ops) {
    if (op.kind === "remove") out = out.filter((c) => c.dbId !== op.dbId);
    else out = out.map((c) => (c.dbId === op.dbId && op.board ? { ...c, board: op.board } : c));
  }
  return out;
}

async function sendOp(op: PendingOp): Promise<boolean> {
  try {
    if (op.kind === "remove") {
      const r = await fetch(`/api/decks/${op.deckId}/cards/${op.dbId}`, { method: "DELETE" });
      return r.ok || r.status === 404; // already gone = done
    }
    const r = await fetch(`/api/decks/${op.deckId}/cards/${op.dbId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board: op.board }),
    });
    return r.ok || r.status === 404;
  } catch {
    return false; // still offline
  }
}

// Replay every queued op. Stops keeping any that still fail. Returns true if the
// queue is now empty.
export async function flushQueue(): Promise<boolean> {
  const ops = read();
  if (ops.length === 0) return true;
  const remaining: PendingOp[] = [];
  for (const op of ops) {
    const ok = await sendOp(op);
    if (!ok) remaining.push(op);
  }
  write(remaining);
  return remaining.length === 0;
}
