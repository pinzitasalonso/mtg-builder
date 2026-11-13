// Paddle's webhook deliveries. Two checks come before anything is read:
// the sender must be one of Paddle's published webhook addresses
// (lib/paddle-ips.ts), and the signature must match the RAW body. Only then
// is the event applied to the mirror.
//
// Only a 2xx tells Paddle a delivery arrived, so anything that goes wrong
// (a bad signature, a missing secret, a database error) answers 500 and
// Paddle retries. A bad signature can't be told apart from a rotated secret
// that isn't deployed yet, so retrying is the safe answer for both. A sender
// that isn't Paddle gets a 403.

import { paddleEnv } from "@/lib/paddle-config";
import { fromPaddle } from "@/lib/paddle-ips";
import { processPaddleEvent } from "@/lib/paddle-webhook";
import { paddle, webhookSecret } from "@/lib/paddle-server";

export async function POST(request: Request) {
  try {
    if (!(await fromPaddle(request, paddleEnv()))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch (e) {
    console.error("Paddle webhook IP check failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Not processed" }, { status: 500 });
  }

  const signature = request.headers.get("paddle-signature") ?? "";
  const rawBody = await request.text();
  if (!signature || !rawBody) {
    return Response.json({ error: "Missing signature or body" }, { status: 400 });
  }

  try {
    const event = await paddle().webhooks.unmarshal(rawBody, webhookSecret(), signature);
    await processPaddleEvent(event);
    return Response.json({ received: true });
  } catch (e) {
    console.error("Paddle webhook failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Not processed" }, { status: 500 });
  }
}
