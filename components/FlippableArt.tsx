"use client";

import { RefreshCw } from "lucide-react";
import { useCardFlip } from "@/components/useCardFlip";

/* A card's image, large, as the card views show it — with "Turn over" under
   it when the card has a back face. */
export default function FlippableArt({ name, imageUri, width }: { name: string; imageUri: string; width: number }) {
  const flip = useCardFlip(name, imageUri);
  return (
    <div className="coll-card-art" style={{ width, flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={flip.src || imageUri}
        alt={flip.flipped ? `${name} (back)` : name}
        className={flip.turning ? "card-flip" : undefined}
        style={{ width: "100%", aspectRatio: "5 / 7", borderRadius: "4.8% / 3.5%", objectFit: "cover", background: "rgba(0,0,0,.25)", boxShadow: "0 18px 40px -16px rgba(0,0,0,.6)" }}
      />
      {flip.canFlip && (
        <button
          type="button"
          onClick={flip.toggle}
          aria-pressed={flip.flipped}
          className="id-ghost"
          style={{ padding: "7px 14px", fontSize: 13 }}
        >
          <RefreshCw size={14} strokeWidth={2.25} /> {flip.flipped ? "Show the front" : "Turn over"}
        </button>
      )}
    </div>
  );
}
