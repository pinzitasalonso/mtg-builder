"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Pip } from "@/components/mtg";

const ORDER = ["W", "U", "B", "R", "G"];

/** A mana disc for the logo — the same symbol the app uses everywhere. */
export function ManaDisc({ type, size }: { type: string; size: number }) {
  return (
    <span aria-hidden="true" style={{ display: "flex" }}>
      <Pip sym={type} size={size} />
    </span>
  );
}

/**
 * Spellpool brand logo — a mana disc cycling through the five colors,
 * next to a plain dark wordmark. `wordmark={false}` renders just the disc.
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
  const [idx, setIdx] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % ORDER.length), 1700);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9, lineHeight: 1, ...style }}>
      <ManaDisc type={ORDER[idx]} size={size + 2} />
      {wordmark && (
        <span
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
  return <ManaDisc type="U" size={size} />;
}
