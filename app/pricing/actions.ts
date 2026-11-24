"use server";

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { isPro } from "@/lib/limits";
import { createCheckout, hasPaidAccess } from "@/lib/stripe-billing";
import { siteOrigin } from "@/lib/site-origin";

// Opens Stripe's hosted Checkout for Pro. The account comes from the session
// on the server; the form only says which interval.
export async function startCheckout(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");
  // Already on Pro (from either store), or already subscribed on the web:
  // no second subscription.
  if (isPro(user) || (await hasPaidAccess(user))) redirect("/account");

  const interval = formData.get("interval") === "year" ? "year" : "month";
  let url: string;
  try {
    url = await createCheckout(user, interval, await siteOrigin());
  } catch (e) {
    console.error("Stripe checkout failed:", e instanceof Error ? e.message : e);
    redirect("/pricing?checkout=error");
  }
  redirect(url);
}
