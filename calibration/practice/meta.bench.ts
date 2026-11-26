// LIST=1 npm run practice:bench: the cEDH archetypes MTGTop8 lists now,
// with their share, to pick what to add to decks/. Needs the network.

import { it } from "vitest";
import { fetchMetagame } from "@/lib/mtgtop8";

it.skipIf(!process.env.LIST)("lists the metagame", async () => {
  const meta = await fetchMetagame("cedh");
  for (const a of meta?.meta.archetypes.slice(0, 40) ?? []) console.log(`${String(a.share ?? "").padStart(6)}  ${a.name}`);
});
