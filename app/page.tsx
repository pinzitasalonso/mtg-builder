import { currentUser } from "@/lib/auth";
import { ownDecks } from "@/lib/deck-list";
import { collectionSummary } from "@/lib/collection-summary";
import prisma from "@/lib/prisma";
import { meOf } from "@/lib/me";
import HomeClient, { type HomeStart } from "./HomeClient";

// Home is drawn on the server with the session it was asked with: a
// signed-in player gets their decks in the first paint, and anyone else the
// landing. (As a page drawn only in the browser, it showed the landing to
// everyone first, then swapped to the decks once it had asked who it was.)
// Reading the session makes the page dynamic: rendered per request, and
// never cached for anyone else.
export default async function HomePage() {
  const user = await currentUser();
  if (!user) return <HomeClient start={{ me: null, decks: null }} />;
  // What the home shows above the public decks: the decks, the collection
  // block and the wishlist count. A part that fails is left to the browser
  // to fetch, as before.
  const [me, decks, collection, wishlist] = await Promise.all([
    meOf(user),
    ownDecks(user.id).catch(() => null),
    collectionSummary(user.id).catch(() => null),
    prisma.wishlistCard.count({ where: { userId: user.id } }).catch(() => null),
  ]);
  // Dates as the API sends them (JSON strings).
  const start: HomeStart = { me, decks: decks ? (JSON.parse(JSON.stringify(decks)) as HomeStart["decks"]) : null, collection, wishlist };
  return <HomeClient start={start} />;
}
