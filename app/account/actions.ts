"use server";

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { customerIdsFor, subscriptionsFor } from "@/lib/paddle-billing";
import { paddle } from "@/lib/paddle-server";

// Opens the Paddle-hosted customer portal (payment method, cancel, invoices).
// Takes no input: the customer is resolved from the session on the server, so
// no one can ask for another customer's portal. A portal link is single-use
// and short-lived, so a fresh one is minted on every click.
export async function openBillingPortal(): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");

  const [customerId] = await customerIdsFor(user);
  if (!customerId) redirect("/account?billing=none");

  const subscriptionIds = (await subscriptionsFor(user))
    .filter((s) => s.customerId === customerId)
    .map((s) => s.subscriptionId);

  let url: string;
  try {
    const session = await paddle().customerPortalSessions.create(customerId, subscriptionIds);
    url = session.urls.general.overview;
  } catch (e) {
    console.error("Paddle portal session failed:", e instanceof Error ? e.message : e);
    redirect("/account?billing=error");
  }
  redirect(url);
}
