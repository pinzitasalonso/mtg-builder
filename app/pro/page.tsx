import type { Metadata } from "next";
import ProView from "./ProView";

export const metadata: Metadata = {
  title: "Spellpool Pro",
  description: "Unlimited decks, AI asks and deck scans on Spellpool.",
};

// spellpool.com/pro: the paywall as a page, for links from anywhere (and for
// the sign-in round trip — buying needs an account, so a signed-out Get Pro
// comes back here). Signed in, it opens the paywall at once; on Pro, it's the
// subscription's page, the web's stand-in for the iOS Customer Center.
export default function ProPage() {
  return <ProView />;
}
