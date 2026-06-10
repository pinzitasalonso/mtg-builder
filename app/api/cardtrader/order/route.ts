import { NextRequest, NextResponse } from "next/server";
import { mapPool } from "@/lib/async";
import { currentUser } from "@/lib/auth";
import { CtProduct, blueprintIdFor, ct, ctConfigured, resolveDecklist } from "@/lib/cardtrader";

export const runtime = "nodejs";

const MAX_CARDS = 200;
const LOOKUP_CONCURRENCY = 4;

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
   names → blueprints (throwaway wishlist) → cheapest Zero-eligible listing
   per card → POST /cart/add with via_cardtrader_zero. */
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
    // 1 — resolve names on CardTrader's side; unmatched lines vanish silently.
    const text = cards.map((c) => `${c.quantity} ${c.name}`).join("\n");
    const items = await resolveDecklist(text);
    const resolvedNames = new Set(items.map((i) => (i.meta_name ?? i.name ?? "").toLowerCase()));
    const notFound = cards.filter((c) => !resolvedNames.has(c.name.toLowerCase())).map((c) => c.name);

    // 2 — cheapest CardTrader Zero listing per card (bounded concurrency).
    const looked = await mapPool(items, LOOKUP_CONCURRENCY, async (item) => {
      const name = item.meta_name ?? item.name ?? "?";
      try {
        const bpId = await blueprintIdFor(item);
        if (bpId === null) return { name, status: "notfound" as const };
        const byBlueprint = await ct<Record<string, CtProduct[]>>(`/marketplace/products?blueprint_id=${bpId}`);
        const products = Object.values(byBlueprint).flat();
        const eligible = products
          .filter((p) => p.user?.can_sell_via_hub && p.quantity > 0 && (p.bundle_size ?? 1) === 1)
          .sort((a, b) => a.price.cents - b.price.cents);
        if (eligible.length === 0) return { name, status: "nozero" as const };
        return { name, status: "ok" as const, product: eligible[0], quantity: item.quantity };
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
        if (!notFound.includes(r.name)) notFound.push(r.name);
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
      cartUrl: "https://www.cardtrader.com/cart",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "CardTrader request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
