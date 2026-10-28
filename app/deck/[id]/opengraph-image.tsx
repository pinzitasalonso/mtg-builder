import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BRAND, markDataUri } from "@/components/brand";
import { formatName, publicDeckSummary } from "@/lib/deck-meta";
import { scanVersionURL } from "@/lib/scan-url";
import { SCRYFALL_HEADERS } from "@/lib/scryfall";

// The link preview for a shared deck: the face card's art across the whole
// image, darkened under the words, and the card itself standing on the
// right; then the deck's name, commander, format, size and colours. A
// private deck (or a wrong id) gets the plain brand card, so nothing about it
// leaks into a preview. If the art can't be fetched, the words stand alone
// on the brand's dark ground, as before.
export const runtime = "nodejs";
export const alt = "A Magic: The Gathering deck on Spellpool";
export const size = { width: 1200, height: 630 };
// A JPEG: with the art behind it the PNG came to about 1 MB, and WhatsApp
// drops previews much over ~300 KB. See the end of the function.
export const contentType = "image/jpeg";

// Inter, the site's own face: extra bold for the deck's name and the
// wordmark, regular for the rest. The renderer's built-in font has a single
// weight, so the name's bold used to come out regular. Read once; if the
// files are missing, the built-in font still draws the card.
const fonts = Promise.all([
  readFile(join(process.cwd(), "app/fonts/Inter-Regular.woff")),
  readFile(join(process.cwd(), "app/fonts/Inter-ExtraBold.woff")),
])
  .then(([regular, bold]) => [
    { name: "Inter", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "Inter", data: bold, weight: 800 as const, style: "normal" as const },
  ])
  .catch(() => []);

const PIP: Record<string, string> = { W: "#ecd9a0", U: "#4a4ff0", B: "#3a3441", R: "#dc4a31", G: "#2f8350" };

// The card's width on the image (a card is 5 × 7).
const CARD_W = 318;
const CARD_H = Math.round((CARD_W * 7) / 5);

/** A scan as a data URI, or null if it can't be had quickly: a crawler won't
    wait long for a preview. cards.scryfall.io has no rate limit, but like the
    API it turns away a library's default User-Agent, so this sends ours. */
async function scan(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": SCRYFALL_HEADERS["User-Agent"], Accept: "image/*" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function DeckOgImage({ params }: { params: Promise<{ id: string }> }) {
  const deck = await publicDeckSummary((await params).id);
  const colors = deck?.colors ? deck.colors.split("") : [];
  const cover = deck?.coverImage ?? undefined;
  const [art, card] = await Promise.all([scan(scanVersionURL(cover, "art_crop")), scan(scanVersionURL(cover, "normal"))]);
  const nameSize = !deck ? 96 : deck.name.length > 30 ? 54 : deck.name.length > 18 ? 68 : 88;

  const image = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: BRAND.bg, fontFamily: "Inter" }}>
        {art && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art} alt="" width={1200} height={630} style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, objectFit: "cover" }} />
        )}
        {art && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 1200,
              height: 630,
              backgroundImage: "linear-gradient(90deg, rgba(12,12,12,.96) 0%, rgba(12,12,12,.88) 40%, rgba(12,12,12,.45) 75%, rgba(12,12,12,.25) 100%)",
            }}
          />
        )}
        {card && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card}
            alt=""
            width={CARD_W}
            height={CARD_H}
            style={{ position: "absolute", top: (630 - CARD_H) / 2, right: 84, borderRadius: 16, transform: "rotate(4deg)", boxShadow: "0 30px 60px rgba(0,0,0,.65)" }}
          />
        )}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: card ? 780 : 1200,
            height: "100%",
            padding: "64px 72px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img width={56} height={56} src={markDataUri(56)} alt="" />
            <div style={{ fontSize: 36, fontWeight: 800, color: BRAND.text }}>Spellpool</div>
          </div>
          {deck ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ display: "flex", gap: 12 }}>
                {colors.map((c) => (
                  <div key={c} style={{ width: 44, height: 44, borderRadius: 22, background: PIP[c] ?? "#bdb8c4", border: "3px solid rgba(255,255,255,.25)" }} />
                ))}
              </div>
              <div style={{ fontSize: nameSize, fontWeight: 800, color: BRAND.text, letterSpacing: -2.5, lineHeight: 1.02 }}>{deck.name}</div>
              <div style={{ fontSize: 32, color: art ? "rgba(255,255,255,.78)" : BRAND.muted, lineHeight: 1.25 }}>
                {[deck.commander, formatName(deck.format), `${deck.count} cards`].filter(Boolean).join(" · ")}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 56, fontWeight: 800, color: BRAND.text }}>Build and brew your Magic: The Gathering decks</div>
          )}
          <div style={{ fontSize: 26, color: BRAND.accent }}>spellpool.com</div>
        </div>
      </div>
    ),
    { ...size, fonts: await fonts }
  );

  // The same picture as a JPEG, a tenth of the size. If sharp can't load
  // (it ships per platform), the PNG still beats no preview at all.
  const png = Buffer.from(await image.arrayBuffer());
  const headers = { "Cache-Control": "public, max-age=0, must-revalidate" };
  try {
    const sharp = (await import("sharp")).default;
    const jpg = await sharp(png).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    return new Response(new Uint8Array(jpg), { headers: { ...headers, "Content-Type": "image/jpeg" } });
  } catch {
    return new Response(new Uint8Array(png), { headers: { ...headers, "Content-Type": "image/png" } });
  }
}
