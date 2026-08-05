// The cards the model has never seen.
//
// The assistant runs on a model with a fixed training cutoff. Magic ships a
// premier set roughly every three months, with Commander decks alongside it, so
// a few weeks after any release there are hundreds of cards the model cannot
// recognise. That breaks two different things, and only one of them is fixed by
// telling it to search harder:
//
//   RECOGNISING a card the player names. The model can look this up — but only
//   if something tells it to. It has no sense of its own edges, so an unknown
//   name reads as a typo or a fake, and the failure mode is confidently telling
//   a player their card doesn't exist.
//
//   SUGGESTING a card on its own. This one search cannot fix at all. A
//   recommendation comes out of memory, and for a set that shipped last month
//   the memory is empty. The model doesn't know the set exists, so nothing
//   prompts it to go looking, and it recommends the cards it does remember.
//
// So this module builds two prompt blocks. `buildRecentSetsBlock` names the
// sets past the cutoff, which is what gives the model a reason to search.
// `buildNewCardsBlock` puts actual cards from those sets in front of it, which
// is the only thing that makes a new card recommendable.
//
// Everything comes from Scryfall live. Nothing here names a set, because the
// next set is always about a week out — The Hobbit was on Scryfall with 321
// cards nine days before its release date, which is exactly when players start
// asking about it.

// Relative, not "@/lib/…": vitest resolves this module directly and does not
// carry the tsconfig path alias. The tested libs all import this way.
import { SCRYFALL_HEADERS, resolveNamed } from "./scryfall";

/**
 * Scryfall's card shape as this module needs it.
 *
 * Local rather than the shared `ScryfallCard`, which declares `card_faces` as
 * images only. A two-faced card carries an EMPTY top-level `oracle_text` and
 * puts the real text on the faces — mana cost and type line are joined with
 * " // " for us, but rules text is not. Reading only the top level, every
 * modal, split and adventure card in a new set would arrive as a bare name with
 * nothing to judge it by, which is worse than leaving it out.
 */
interface RawCard {
  name?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  set?: string;
  card_faces?: { name?: string; mana_cost?: string; type_line?: string; oracle_text?: string }[];
}

/** Top-level rules text, or the faces' text joined, or null. */
function oracleOf(c: RawCard): string | null {
  const top = c.oracle_text?.trim();
  if (top) return top;
  const faces = (c.card_faces ?? [])
    .map((f) => {
      const text = f.oracle_text?.trim();
      return text ? `${f.name ?? "—"}: ${text}` : "";
    })
    .filter(Boolean);
  return faces.length ? faces.join(" // ") : null;
}

/**
 * Sets released on or after this date are treated as unknown to the model.
 *
 * Deliberately set EARLIER than the model's nominal training cutoff. A set that
 * shipped a fortnight before the cutoff is in the training data only as spoiler
 * chatter and preview articles — the model half-knows a few marquee cards and
 * nothing else, which produces worse answers than knowing nothing, because it
 * doesn't hedge. Better to treat the last few weeks before the cutoff as a gap
 * too.
 *
 * Move this when the model moves. `MAX_SETS` below is the backstop for when
 * nobody does.
 */
export const TRAINING_CUTOFF = "2026-04-01";

/** Set types that contain cards a deckbuilder can actually play. */
const CARD_SET_TYPES = new Set([
  "core",
  "expansion",
  "commander",
  "draft_innovation",
  "masters",
  "eternal",
  "starter",
]);

/**
 * The cap that keeps a stale `TRAINING_CUTOFF` from turning into an ever-growing
 * prompt block. Magic ships premier sets about quarterly and most come with a
 * Commander product, so eight entries is roughly a year of releases.
 */
const MAX_SETS = 8;

/**
 * How far ahead a set counts as "coming".
 *
 * Scryfall lists sets from the moment they are announced, months before anyone
 * can play them, with a handful of preview cards each. Without this bound they
 * win the newest-first sort and eat the cap: the first live run of this module
 * spent five of its eight slots on Star Trek, Mystery Booster and Reality
 * Fracture — 2 to 3 months out, 197 spoiled cards between them — and pushed
 * Marvel Super Heroes, 453 cards and six weeks old, off the list entirely.
 *
 * Thirty days is about where spoiler season starts and players begin brewing.
 * The Hobbit was nine days out with 321 cards on Scryfall.
 */
const UPCOMING_HORIZON_DAYS = 30;

/**
 * How many new cards to put in front of the model.
 *
 * Every one of these is uncached prompt on every deck turn — the block is
 * filtered to the deck's colours, so it cannot ride in a shared cached block.
 * Forty ran about 2,700 tokens; this is the trim that keeps six sets meaningfully
 * represented without the grounding costing more than the answer.
 */
const MAX_NEW_CARDS = 36;

/** Oracle text longer than this is cut — enough to judge a card, not to read it. */
const ORACLE_CHARS = 190;

/**
 * How long the route will wait for new-set cards before answering without them.
 *
 * Staggered, the six requests measured about one second cold and nothing warm,
 * so this should never fire — it is here for the day Scryfall is slow, not for
 * the normal path. (Sequentially the same six took nine seconds, which is what
 * prompted both the stagger and this deadline.)
 *
 * The route is repeatedly tuned against dead air before the first byte, and new
 * cards are grounding rather than a feature: an answer without them is the
 * answer we shipped last week, while an answer nine seconds late is a complaint.
 *
 * Missing the deadline is not a failure. The fetch keeps running and fills the
 * cache, so it costs exactly one player one block, once every six hours.
 */
const CARD_DEADLINE_MS = 2500;

const SETS_TTL_MS = 6 * 60 * 60_000;
const CARDS_TTL_MS = 6 * 60 * 60_000;

export interface RecentSet {
  code: string;
  name: string;
  releasedAt: string;
  cardCount: number;
  /** Release date still in the future — spoiled, previewed, not yet legal. */
  upcoming: boolean;
}

export interface NewCard {
  name: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
  set: string;
}

// ---------------------------------------------------------------------------
// Selection — pure, so the interesting decisions are testable without a network.
// ---------------------------------------------------------------------------

interface RawSet {
  code?: string;
  name?: string;
  released_at?: string;
  card_count?: number;
  set_type?: string;
  digital?: boolean;
}

/**
 * The sets past the cutoff, newest first.
 *
 * `today` is a parameter rather than a `new Date()` call so a test can pin it.
 * Upcoming sets are kept, not filtered: a set spoiled but unreleased is the one
 * players ask about most, and Scryfall carries its cards weeks early.
 */
export function selectRecentSets(raw: unknown, today: string): RecentSet[] {
  const list = Array.isArray((raw as { data?: unknown })?.data) ? ((raw as { data: RawSet[] }).data) : [];
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + UPCOMING_HORIZON_DAYS);
  const latest = horizon.toISOString().slice(0, 10);
  return list
    .filter(
      (s) =>
        typeof s.code === "string" &&
        typeof s.name === "string" &&
        typeof s.released_at === "string" &&
        s.released_at >= TRAINING_CUTOFF &&
        s.released_at <= latest &&
        !s.digital &&
        (s.card_count ?? 0) > 0 &&
        CARD_SET_TYPES.has(s.set_type ?? "")
    )
    .map((s) => ({
      code: s.code!,
      name: s.name!,
      releasedAt: s.released_at!,
      cardCount: s.card_count ?? 0,
      upcoming: s.released_at! > today,
    }))
    .sort((a, b) => (a.releasedAt < b.releasedAt ? 1 : a.releasedAt > b.releasedAt ? -1 : a.code.localeCompare(b.code)))
    .slice(0, MAX_SETS);
}

/**
 * The Scryfall query for new cards a deck could actually play.
 *
 * `-is:reprint` is the load-bearing clause. Half of a set is reprints, and a
 * reprint is by definition a card the model already knows — listing Settle the
 * Wreckage as "new" spends tokens telling it something it can quote already.
 *
 * `identity` is a WUBRG string; `id<=` is Scryfall's colour-identity subset
 * operator, which is the Commander legality rule exactly. An empty or null
 * identity means we don't know, so we don't filter — a wrong filter silently
 * hides the cards this whole module exists to surface.
 */
export function newCardsQuery(set: RecentSet, identity: string | null): string {
  const parts = [`set:${set.code}`, "-is:reprint", "game:paper", "-t:basic"];
  if (identity) parts.push(`id<=${identity.toLowerCase()}`);
  return parts.join(" ");
}

/**
 * Take from each set in turn until we have `limit` cards.
 *
 * A straight top-N off an EDHREC-ordered result would be almost entirely the
 * OLDEST set in the list, because EDHREC rank is a popularity measure and a set
 * released next week has no play data to be popular in. Its cards are all
 * ranked ~20,000 and sort last. Round-robin guarantees the newest set — the one
 * the player is actually asking about — is represented.
 */
export function roundRobinBySet(cards: NewCard[], order: string[], limit: number): NewCard[] {
  const buckets = new Map<string, NewCard[]>();
  for (const c of cards) {
    const bucket = buckets.get(c.set);
    if (bucket) bucket.push(c);
    else buckets.set(c.set, [c]);
  }
  const out: NewCard[] = [];
  for (let round = 0; out.length < limit; round++) {
    let took = false;
    for (const code of order) {
      const bucket = buckets.get(code);
      if (!bucket || round >= bucket.length) continue;
      out.push(bucket[round]);
      took = true;
      if (out.length >= limit) break;
    }
    if (!took) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prompt blocks
// ---------------------------------------------------------------------------

/**
 * "You have a gap, and here is where it starts."
 *
 * This is the cheap half of the fix and the one that changes behaviour most,
 * because a model cannot decide to look something up when it doesn't know
 * there's anything to look up. Byte-identical for every player and changes at
 * most daily, so it rides in the cached instructions block.
 */
export function buildRecentSetsBlock(sets: RecentSet[]): string {
  if (sets.length === 0) return "";
  const lines = sets
    .map(
      (s) =>
        `  - ${s.name} (${s.code.toUpperCase()}) — ${s.cardCount} cards, ` +
        `${s.upcoming ? `releases ${s.releasedAt}` : `released ${s.releasedAt}`}`
    )
    .join("\n");
  return (
    "SETS YOU HAVE NEVER SEEN — READ THIS BEFORE YOU NAME OR DISMISS A CARD. Magic ships a premier set about " +
    "every three months, with Commander decks alongside, and your training data stops before the sets below. " +
    "You do not know these cards. You cannot quote their text, you do not know what they cost, and — the part " +
    "that matters most — you will not think of them when you reach for a recommendation, because there is " +
    "nothing there to reach for. The gap is silent: it feels exactly like knowing.\n\n" +
    lines +
    "\n\n" +
    "So: when the player names a card you don't recognise, assume it is real and from one of these sets, and " +
    "look it up. NEVER tell a player a card doesn't exist, isn't a real card, or that they have misremembered " +
    "the name — on a card from these sets you would simply be wrong. Never claim a set is unreleased or " +
    "upcoming beyond what is written above. When a question turns on what is new, current, or recently " +
    "printed, search before you answer."
  );
}

/**
 * The candidates themselves, in the deck's colours.
 *
 * The awareness block gets the model to look up what the player mentions; this
 * is what lets it bring up a new card unprompted. Per-deck, so it belongs in
 * the volatile tail of the prompt rather than a cached block.
 */
export function buildNewCardsBlock(cards: NewCard[], sets: RecentSet[]): string {
  if (cards.length === 0) return "";
  const names = new Map(sets.map((s) => [s.code, s.name]));
  const lines = cards
    .map((c) => {
      // Rules text is line-per-ability. Collapsing straight to spaces runs them
      // together — "Flying, haste Whenever Smaug attacks" — so keep the breaks
      // visible as a separator while still fitting on one line.
      const oracle = (c.oracleText ?? "").replace(/\s*\n+\s*/g, " · ").replace(/[ \t]+/g, " ").trim();
      const text = oracle.length > ORACLE_CHARS ? `${oracle.slice(0, ORACLE_CHARS)}…` : oracle;
      const bits = [c.manaCost, c.typeLine, text].filter(Boolean).join(" — ");
      return `  [${names.get(c.set) ?? c.set.toUpperCase()}] ${c.name}${bits ? ` — ${bits}` : ""}`;
    })
    .join("\n");
  return (
    "\n\nNEW CARDS FROM THOSE SETS, IN THIS DECK'S COLOURS. You have never seen any of these, so read the text " +
    "below rather than recalling it — what is written here is the card. This is a sample of what is new and " +
    "legal for this deck, not a shortlist and not a ranking, and it is ordered by overall popularity rather " +
    "than by fit. Consider them alongside everything you already know: recommend one when it genuinely beats " +
    "the alternatives, ignore the rest, and never reach for one just because it is new. If a card here looks " +
    "close but you need the exact wording or a ruling, search for it.\n\n" +
    lines
  );
}

// ---------------------------------------------------------------------------
// Fetching. Per-process caches, like lib/research and lib/ratelimit: right on
// one long-lived Railway instance, and a miss on a second costs one request.
// ---------------------------------------------------------------------------

let setsCache: { at: number; value: RecentSet[] } | null = null;
const cardsCache = new Map<string, { at: number; value: NewCard[] }>();
const identityCache = new Map<string, string | null>();

/* Test seam: drop everything cached. */
export function resetRecentSetsCache(): void {
  setsCache = null;
  cardsCache.clear();
  identityCache.clear();
}

async function fetchJson(url: string, timeoutMs = 6000): Promise<unknown | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: SCRYFALL_HEADERS, signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Sets past the cutoff. Empty on any failure — this is grounding, not a feature. */
export async function recentSets(): Promise<RecentSet[]> {
  if (setsCache && Date.now() - setsCache.at < SETS_TTL_MS) return setsCache.value;
  const raw = await fetchJson("https://api.scryfall.com/sets");
  if (!raw) return setsCache?.value ?? [];
  const value = selectRecentSets(raw, new Date().toISOString().slice(0, 10));
  setsCache = { at: Date.now(), value };
  return value;
}

/**
 * New cards playable in `identity`, sampled across the recent sets.
 *
 * ONE REQUEST PER SET, deliberately, and not one pooled query.
 *
 * A pooled query looked obviously better and is quietly broken. Scryfall
 * returns 175 cards per page ordered by EDHREC rank, and EDHREC rank measures
 * how much a card is PLAYED — so a set that isn't out yet has no rank worth the
 * name. The Hobbit's cards all sit around 18,000-20,000; a Mardu deck matched
 * 677 cards across the recent sets and page one ran out at rank 16,133. The
 * Hobbit got ONE card in, out of 321. The set releasing next week, the one
 * players are actually asking about, was the one thing the pooled query could
 * not see. Paginating to reach it would mean four requests for a three-colour
 * deck and nine for a five-colour one.
 *
 * Per set, every set gets its own page and its own fair share, at a fixed cost
 * that doesn't grow with the deck's colours. Cached six hours, and it runs
 * concurrently with the community research the route is already waiting on.
 */
export async function newCards(sets: RecentSet[], identity: string | null): Promise<NewCard[]> {
  if (sets.length === 0) return [];
  const key = `${sets.map((s) => s.code).join("|")}::${identity ?? "*"}`;
  const hit = cardsCache.get(key);
  if (hit && Date.now() - hit.at < CARDS_TTL_MS) return hit.value;

  // Staggered rather than a flat Promise.all: Scryfall asks for 50-100ms
  // between requests, and a stagger honours that while still overlapping the
  // six round trips instead of paying for them end to end.
  const work = Promise.all(
    sets.map(async (s, i) => {
      await new Promise((r) => setTimeout(r, i * 80));
      const query = newCardsQuery(s, identity);
      const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards`;
      // A search with no matches is a 404, which fetchJson turns into null — the
      // normal answer for a mono-white deck against a colourless set, not an error.
      const raw = (await fetchJson(url)) as { data?: RawCard[] } | null;
      const found = Array.isArray(raw?.data) ? raw.data : [];
      return found
        .filter((c) => typeof c.name === "string")
        .map((c) => ({
          name: c.name!,
          manaCost: c.mana_cost ?? null,
          typeLine: c.type_line ?? null,
          oracleText: oracleOf(c),
          // The set we asked for, not the one on the card: a card can be
          // printed in two of these sets at once, and we want it filed under
          // the query that found it so the round-robin buckets stay even.
          set: s.code,
        }));
    })
  )
    .then((perSet) => {
      const value = roundRobinBySet(perSet.flat(), sets.map((s) => s.code), MAX_NEW_CARDS);
      // Cache even an empty result, or a deck with no matches re-asks every turn.
      cardsCache.set(key, { at: Date.now(), value });
      return value;
    })
    .catch(() => [] as NewCard[]);

  // Whichever comes first. When the deadline wins, `work` is still running and
  // will populate the cache for the next request — that is the point of racing
  // rather than aborting.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<NewCard[]>((resolve) => {
    timer = setTimeout(() => resolve([]), CARD_DEADLINE_MS);
  });
  return Promise.race([work.finally(() => clearTimeout(timer)), deadline]);
}

/**
 * A commander's colour identity, cached for the life of the process.
 *
 * Identity is a property of a printed card and never changes, so this is one of
 * the few things safe to cache without a TTL. A failed lookup caches as null so
 * a misspelled commander doesn't re-ask Scryfall on every turn of a
 * conversation.
 */
async function commanderIdentity(commander: string): Promise<string | null> {
  const key = commander.trim().toLowerCase();
  if (!key) return null;
  if (identityCache.has(key)) return identityCache.get(key) ?? null;
  const card = await resolveNamed(commander.trim()).catch(() => null);
  // "" is a real answer — a colourless commander — but as a query filter it
  // would mean "colourless cards only", which is not what an unknown identity
  // should do. Both empty and unresolved store as null: don't filter.
  const identity = card?.colorIdentity ? card.colorIdentity : null;
  identityCache.set(key, identity);
  return identity;
}

export interface RecentCardContext {
  sets: RecentSet[];
  cards: NewCard[];
}

/**
 * Both halves of the fix, for one request.
 *
 * Best-effort throughout: every failure path here returns fewer cards or no
 * block at all, never an error. This is grounding for an answer the model can
 * still give without it.
 *
 * `wantCards` is false for the build-from-collection flow, which recommends
 * from cards the player already owns — a list of new cards they don't own is
 * noise there, and the fetch would put back the dead air that flow skips
 * research to avoid. It still gets the awareness block, because the player may
 * well own cards from those sets and the model needs to not deny they exist.
 */
export async function recentCardContext(
  commander: string | null,
  wantCards: boolean
): Promise<RecentCardContext> {
  const sets = await recentSets();
  if (!wantCards || sets.length === 0) return { sets, cards: [] };
  const identity = commander ? await commanderIdentity(commander) : null;
  return { sets, cards: await newCards(sets, identity) };
}
