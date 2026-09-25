"use client";

import type { CSSProperties } from "react";
import { MARK_BLUE, MARK_DROP, MARK_SQUIRCLE } from "@/components/brand";

/** The Spellpool mark: a white water drop on a blue squircle (components/brand). */
export function BrandMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ display: "block", flex: "none" }}>
      <path d={MARK_SQUIRCLE} fill={MARK_BLUE} />
      <path d={MARK_DROP} fill="#ffffff" />
    </svg>
  );
}

/**
 * Spellpool brand logo — the mark (a white drop on a blue squircle) next to
 * a plain wordmark. `wordmark={false}` renders just the mark.
 */
export default function Logo({
  size = 18,
  wordmark = true,
  style,
}: {
  size?: number;
  wordmark?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9, lineHeight: 1, ...style }}>
      <BrandMark size={size + 4} />
      {wordmark && (
        <span
          className="logo-word"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: size,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "var(--t1)",
          }}
        >
          Spellpool
        </span>
      )}
    </span>
  );
}

export function LogoMark({ size = 26 }: { size?: number }) {
  return <BrandMark size={size} />;
}
