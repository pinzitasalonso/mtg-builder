import { ImageResponse } from "next/og";
import { BRAND, markDataUri } from "@/components/brand";

export const alt = "Spellpool — build and brew your Magic: The Gathering decks";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND.bg,
          gap: 24,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img width={160} height={160} src={markDataUri(160)} alt="" />
        <div style={{ display: "flex", fontSize: 112, fontWeight: 700, letterSpacing: -3, color: BRAND.text }}>
          Spellpool
        </div>
        <div style={{ fontSize: 34, color: BRAND.muted }}>
          Build and brew your Magic: The Gathering decks
        </div>
      </div>
    ),
    { ...size }
  );
}
