import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { fetchMetagame, MTGTOP8_FORMATS } from "@/lib/mtgtop8";
import { mtgtop8FormatFor } from "@/lib/practice/decks";

export const runtime = "nodejs";

export interface OpponentOption {
  kind: "mtgtop8" | "deck";
  /** mtgtop8: the format and archetype. deck: the deck's id. */
  format?: string;
  archetype?: string;
  deck?: string;
  label: string;
  detail: string;
}

// Who a deck can practise against: the format's top tournament archetypes
// on MTGTop8 (for Commander, cEDH's most played commanders), a mirror
// match, and the player's other decks of the same format.
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to play against the AI." }, { status: 401 });
  const publicId = new URL(req.url).searchParams.get("deck") ?? "";
  const deck = await prisma.deck.findFirst({
    where: { publicId, OR: [{ userId: user.id }, { userId: null }, { shared: true }] },
    select: { publicId: true, name: true, format: true },
  });
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });

  const groups: { title: string; options: OpponentOption[] }[] = [];
  const f = mtgtop8FormatFor(deck.format);
  if (f) {
    const got = await fetchMetagame(f);
    const options = (got?.meta.archetypes ?? []).slice(0, 12).map(
      (a): OpponentOption => ({
        kind: "mtgtop8",
        format: f,
        archetype: a.id,
        label: a.name,
        detail: `${Number.isInteger(a.share) ? a.share : a.share.toFixed(1)}% of the ${MTGTOP8_FORMATS[f]!.label} metagame`,
      })
    );
    if (options.length) groups.push({ title: f === "cedh" ? "cEDH commanders (MTGTop8)" : "Tournament decks (MTGTop8)", options });
  }
  const mine = await prisma.deck.findMany({
    where: { userId: user.id, format: deck.format, cards: { some: { board: "deck" } } },
    select: { publicId: true, name: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const own: OpponentOption[] = [
    { kind: "deck", deck: deck.publicId!, label: `${deck.name} (mirror match)`, detail: "This deck against itself" },
    ...mine.filter((d) => d.publicId && d.publicId !== deck.publicId).map((d): OpponentOption => ({ kind: "deck", deck: d.publicId!, label: d.name, detail: "Your deck" })),
  ];
  groups.push({ title: "Your decks", options: own });
  return NextResponse.json({ format: deck.format, groups });
}
