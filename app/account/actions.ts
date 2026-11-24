"use server";

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { portalUrl } from "@/lib/stripe-billing";
import { siteOrigin } from "@/lib/site-origin";

// Opens Stripe's customer portal (card, cancel, invoices). Takes no input:
// the customer is resolved from the session on the server, so no one can ask
// for another customer's portal. A portal link is short-lived, so a fresh one
// is minted on every click.
export async function openBillingPortal(): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");

  let url: string | null;
  try {
    url = await portalUrl(user, await siteOrigin());
  } catch (e) {
    console.error("Stripe portal session failed:", e instanceof Error ? e.message : e);
    redirect("/account?billing=error");
  }
  if (!url) redirect("/account?billing=none");
  redirect(url);
}
