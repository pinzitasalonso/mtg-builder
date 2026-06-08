import type { CSSProperties } from "react";

/**
 * Spellpool brand logo: an arcane spark dropping into a rippling pool.
 * `mark` renders just the icon; otherwise icon + wordmark.
 */
export default function Logo({
  size = 28,
  wordmark = true,
  style,
}: {
  size?: number;
  wordmark?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        lineHeight: 1,
        ...style,
      }}
    >
      <LogoMark size={size} />
      {wordmark && (
        <span
          style={{
            fontSize: size * 0.78,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "var(--text)",
          }}
        >
          Spell
          <span style={{ color: "var(--accent)" }}>pool</span>
        </span>
      )}
    </span>
  );
}

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "block" }}
    >
      {/* arcane spark falling toward the pool */}
      <path
        d="M16 3.5l2.6 6.4 6.4 2.6-6.4 2.6L16 21.5l-2.6-6.4L7 12.5l6.4-2.6L16 3.5z"
        fill="var(--accent)"
      />
      {/* pool ripples */}
      <ellipse
        cx="16"
        cy="24.5"
        rx="11"
        ry="3.4"
        stroke="var(--accent)"
        strokeOpacity="0.85"
        strokeWidth="1.6"
      />
      <ellipse
        cx="16"
        cy="26"
        rx="6.2"
        ry="1.9"
        stroke="var(--accent)"
        strokeOpacity="0.45"
        strokeWidth="1.4"
      />
    </svg>
  );
}
