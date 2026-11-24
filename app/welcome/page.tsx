import type { Metadata } from "next";
import WelcomeClient from "./WelcomeClient";

export const metadata: Metadata = {
  title: "Welcome to Pro",
  robots: { index: false },
};

// Where checkout lands after a successful payment. Access comes from
// RevenueCat, which reads the purchase from Stripe, never from a visit to
// this page: the page only asks the server to re-check, and says when Pro is on.
export default function WelcomePage() {
  return <WelcomeClient />;
}
