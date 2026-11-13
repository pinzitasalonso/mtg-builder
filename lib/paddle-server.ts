// The server-side Paddle SDK. Server-only: it holds PADDLE_API_KEY, which must
// never reach the browser — never import this from a "use client" file.

import { Environment, LogLevel, Paddle } from "@paddle/paddle-node-sdk";
import { paddleEnv } from "@/lib/paddle-config";

let instance: Paddle | null = null;

/** One SDK instance per process. Throws when the key or environment is unset. */
export function paddle(): Paddle {
  if (instance) return instance;
  const key = process.env.PADDLE_API_KEY;
  if (!key) throw new Error("PADDLE_API_KEY is not set");
  const env = paddleEnv();
  // A sandbox key is pdl_sdbx_…, a live one pdl_live_…: a mismatch means the
  // key and the environment point at different accounts.
  const expected = env === "sandbox" ? "pdl_sdbx_" : "pdl_live_";
  if (!key.startsWith(expected)) throw new Error(`PADDLE_API_KEY must start with ${expected} for ${env}`);
  instance = new Paddle(key, {
    environment: env === "sandbox" ? Environment.sandbox : Environment.production,
    logLevel: LogLevel.error,
  });
  return instance;
}

/** The signing secret of the notification destination (pdl_ntfset_…). Not the API key. */
export function webhookSecret(): string {
  const secret = process.env.PADDLE_NOTIFICATION_WEBHOOK_SECRET;
  if (!secret) throw new Error("PADDLE_NOTIFICATION_WEBHOOK_SECRET is not set");
  return secret;
}
