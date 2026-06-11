import { NextRequest, NextResponse } from "next/server";
import { mapPool } from "@/lib/async";
import { currentUser } from "@/lib/auth";
import { CtProduct, ct, ctConfigured, findBlueprintId } from "@/lib/cardtrader";
import { ScryfallPrinting, defaultPrintingsByName, printingsOf } from "@/lib/scryfall";

export const runtime = "nodejs";

const MAX_CARDS = 200;
const LOOKUP_CONCURRENCY = 4;
// When the default printing has no Zero listing, how many other printings
// (newest first) to try before giving up on the card.
const MAX_FALLBACK_PRINTINGS = 6;

interface ReqCard {
  name: string;
  quantity: number;
}

interface AddedLine {
  name: string;
  quantity: number;
  priceCents: number;
  currency: string;
  seller: string | null;
}

/* Fill the user's CardTrader Zero cart with the deck:
   names → printings (Scryfall) → blueprints (CardTrader catalog) → cheapest
   Zero-eligible listing per card → POST /cart/add with via_cardtrader_zero. */
export async function POST(req: NextRequest) {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  if (!ctConfigured()) {
    return NextResponse.json(
      { configured: false, error: "CardTrader is not configured — add CARDTRADER_API_TOKEN to .env (cardtrader.com → Settings → API)." },
      { status: 501 }
    );
  }

  let body: { cards?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const cards: ReqCard[] = Array.isArray(body.cards)
    ? body.cards
        .filter((c): c is { name: string; quantity?: number } => typeof c === "object" && c !== null && typeof (c as { name?: unknown }).name === "string")
        .map((c) => ({ name: c.name.trim(), quantity: Math.max(1, Math.floor(Number(c.quantity) || 1)) }))
        .filter((c) => c.name)
        .slice(0, MAX_CARDS)
    : [];
  if (cards.length === 0) {
    return NextResponse.json({ error: "No cards to order" }, { status: 400 });
  }

  try {
    // 1 — resolve names to concrete printings via Scryfall (batched).
    const printings = await defaultPrintingsByName(cards.map((c) => c.name));
    const notFound: string[] = [];
    const resolved: { card: ReqCard; printing: ScryfallPrinting }[] = [];
    for (const c of cards) {
      const p = printings.get(c.name.toLowerCase());
      if (p) resolved.push({ card: c, printing: p });
      else notFound.push(c.name);
    }

    // 2 — cheapest CardTrader Zero listing per card (bounded concurrency).
    // Try the default printing first; if it isn't on CardTrader or has no
    // Zero listing, walk other printings newest-first.
    type Looked =
      | { name: string; status: "ok"; product: CtProduct; quantity: number }
      | { name: string; status: "nozero" }
      | { name: string; status: "notfound" }
      | { name: string; status: "failed" };
    const looked = await mapPool(resolved, LOOKUP_CONCURRENCY, async ({ card, printing }): Promise<Looked> => {
      const name = printing.name;
      let sawBlueprint = false;
      const cheapestZero = async (p: ScryfallPrinting): Promise<CtProduct | null> => {
        const bpId = await findBlueprintId(p.set, p.collectorNumber, p.name);
        if (bpId === null) return null;
        sawBlueprint = true;
        const byBlueprint = await ct<Record<string, CtProduct[]>>(`/marketplace/products?blueprint_id=${bpId}`);
        const eligible = Object.values(byBlueprint)
          .flat()
          .filter((pr) => pr.user?.can_sell_via_hub && pr.quantity > 0 && (pr.bundle_size ?? 1) === 1)
          .sort((a, b) => a.price.cents - b.price.cents);
        return eligible[0] ?? null;
      };
      try {
        let product = await cheapestZero(printing);
        if (!product) {
          const others = (await printingsOf(name))
            .filter((p) => !(p.set === printing.set && p.collectorNumber === printing.collectorNumber))
            .slice(0, MAX_FALLBACK_PRINTINGS);
          for (const p of others) {
            product = await cheapestZero(p);
            if (product) break;
          }
        }
        if (product) return { name, status: "ok" as const, product, quantity: card.quantity };
        return { name, status: sawBlueprint ? ("nozero" as const) : ("notfound" as const) };
      } catch {
        return { name, status: "failed" as const };
      }
    });

    // 3 — add to cart sequentially (the cart endpoint mutates shared state).
    const added: AddedLine[] = [];
    const noZero: string[] = [];
    const failed: string[] = [];
    for (const r of looked) {
      if (r.status === "failed") {
        failed.push(r.name);
        continue;
      }
      if (r.status === "notfound") {
        notFound.push(r.name);
        continue;
      }
      if (r.status === "nozero") {
        noZero.push(r.name);
        continue;
      }
      const qty = Math.min(r.quantity, r.product.quantity);
      try {
        await ct("/cart/add", {
          method: "POST",
          json: { product_id: r.product.id, quantity: qty, via_cardtrader_zero: true },
        });
        added.push({
          name: r.name,
          quantity: qty,
          priceCents: r.product.price.cents * qty,
          currency: r.product.price.currency,
          seller: r.product.user?.username ?? null,
        });
      } catch {
        failed.push(r.name);
      }
    }

    const currencies = [...new Set(added.map((a) => a.currency))];
    const totalCents = currencies.length === 1 ? added.reduce((s, a) => s + a.priceCents, 0) : null;

    return NextResponse.json({
      configured: true,
      added,
      notFound,
      noZero,
      failed,
      totalCents,
      currency: currencies.length === 1 ? currencies[0] : null,
      cartUrl: "https://www.cardtrader.com/cart/edit",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "CardTrader request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
