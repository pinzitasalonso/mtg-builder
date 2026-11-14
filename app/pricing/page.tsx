import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import Logo from "@/components/Logo";
import { currentUser } from "@/lib/auth";
import { customerIdsFor } from "@/lib/paddle-billing";
import { countryFromHeaders, paddleClientConfig } from "@/lib/paddle-config";
import { tiersFor } from "@/lib/pricing-tiers";
import PricingClient from "./PricingClient";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Spellpool Pro, monthly or yearly: unlimited AI, deck scans and practice games.",
};

// Rendered per request (it reads the visitor's country and session). Never
// prerendered at build: a missing Paddle variable must fail this page when
// it's opened, not every deploy of the site.
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const [h, user] = await Promise.all([headers(), currentUser()]);
  const paddle = paddleClientConfig();
  const country = countryFromHeaders(h);
  // Paddle Retain wants the signed-in player's Paddle customer id, once they have one.
  const [customerId] = user ? await customerIdsFor(user) : [];

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 20px 80px", width: "100%" }}>
      <Link href="/" style={{ textDecoration: "none" }}><Logo size={18} /></Link>
      <h1 className="id-display" style={{ fontSize: "clamp(34px,6vw,52px)", margin: "26px 0 6px", color: "var(--t1)" }}>
        Pricing
      </h1>
      <p style={{ margin: "0 0 26px", color: "var(--t2)", fontSize: 15.5 }}>
        Spellpool without the daily limits, monthly or yearly. Cancel any time.
      </p>
      <PricingClient
        paddle={paddle}
        tiers={tiersFor(paddle.environment)}
        customerId={customerId}
        country={country}
        email={user?.email}
        userId={user?.id}
      />
    </main>
  );
}
