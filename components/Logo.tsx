import type { CSSProperties } from "react";

/**
 * Spellpool brand logo: an arcane spark hovering over a rippling pool.
 * `wordmark={false}` renders just the icon.
 */
export default function Logo({
  size = 26,
  wordmark = true,
  style,
}: {
  size?: number;
  wordmark?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, lineHeight: 1, ...style }}>
      <LogoMark size={size} />
      {wordmark && (
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: size * 0.95,
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          <span style={{ color: "var(--text)" }}>Spell</span>
          <span style={{ color: "var(--accent)" }}>pool</span>
        </span>
      )}
    </span>
  );
}

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, display: "block" }}>
      <ellipse cx="12" cy="17" rx="8.5" ry="3.2" stroke="var(--accent)" strokeWidth="1.6" opacity="0.55" />
      <path
        d="M12 3.5l1.7 4.1 4.3.5-3.2 2.9.9 4.3L12 13.1l-3.7 2.2.9-4.3L6 8.1l4.3-.5L12 3.5z"
        fill="var(--accent)"
      />
    </svg>
  );
}
