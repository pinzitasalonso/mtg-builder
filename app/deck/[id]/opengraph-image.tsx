import { ImageResponse } from "next/og";
import { BRAND, markDataUri } from "@/components/brand";
import { formatName, publicDeckSummary } from "@/lib/deck-meta";

// The link preview for a shared deck: its name, commander, format, size and
// colours, in the brand's dark dress. A private deck (or a wrong id) gets the
// plain brand card, so nothing about it leaks into a preview.
export const runtime = "nodejs";
export const alt = "A Magic: The Gathering deck on Spellpool";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PIP: Record<string, string> = { W: "#ecd9a0", U: "#4a4ff0", B: "#3a3441", R: "#dc4a31", G: "#2f8350" };

export default async function DeckOgImage({ params }: { params: Promise<{ id: string }> }) {
  const deck = await publicDeckSummary((await params).id);
  const colors = deck?.colors ? deck.colors.split("") : [];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: BRAND.bg, padding: "64px 72px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img width={56} height={56} src={markDataUri(56)} alt="" />
          <div style={{ fontSize: 36, fontWeight: 700, color: BRAND.text }}>Spellpool</div>
        </div>
        {deck ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", gap: 12 }}>
              {colors.map((c) => (
                <div key={c} style={{ width: 44, height: 44, borderRadius: 22, background: PIP[c] ?? "#bdb8c4", border: "3px solid rgba(255,255,255,.25)" }} />
              ))}
            </div>
            <div style={{ fontSize: deck.name.length > 28 ? 72 : 96, fontWeight: 700, color: BRAND.text, letterSpacing: -2, lineHeight: 1 }}>{deck.name}</div>
            <div style={{ fontSize: 34, color: BRAND.muted }}>
              {[deck.commander, formatName(deck.format), `${deck.count} cards`].filter(Boolean).join(" · ")}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 56, fontWeight: 700, color: BRAND.text }}>Build and brew your Magic: The Gathering decks</div>
        )}
        <div style={{ fontSize: 26, color: BRAND.accent }}>spellpool.com</div>
      </div>
    ),
    size
  );
}
