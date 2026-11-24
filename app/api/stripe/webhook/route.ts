// Stripe's webhook deliveries. The signature must match the RAW body before
// anything is read; only then is the event applied to the mirror
// (lib/stripe-webhook.ts).
//
// Only a 2xx tells Stripe a delivery arrived. A missing or bad signature
// answers 400; anything else that goes wrong (a missing secret, a database
// error) answers 500. Stripe retries both for up to three days, so a secret
// rotated before it's deployed loses nothing.

import Stripe from "stripe";
import { stripe, webhookSecret } from "@/lib/stripe";
import { processStripeEvent } from "@/lib/stripe-webhook";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature") ?? "";
  const rawBody = await request.text();
  if (!signature || !rawBody) {
    return Response.json({ error: "Missing signature or body" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(rawBody, signature, webhookSecret());
  } catch (e) {
    if (e instanceof Stripe.errors.StripeSignatureVerificationError) {
      return Response.json({ error: "Bad signature" }, { status: 400 });
    }
    console.error("Stripe webhook failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Not processed" }, { status: 500 });
  }

  try {
    await processStripeEvent(event);
    return Response.json({ received: true });
  } catch (e) {
    console.error(`Stripe webhook ${event.type} failed:`, e instanceof Error ? e.message : e);
    return Response.json({ error: "Not processed" }, { status: 500 });
  }
}
