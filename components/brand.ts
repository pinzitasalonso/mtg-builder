// Brand constants shared by generated images (apple-icon, opengraph-image).
export const BRAND = {
  bg: "#fbfbf8",
  accent: "#2742d6",
  text: "#15151a",
  muted: "#9a9aa2",
};

/** The Spellpool mark (spark + pool ripples) as a standalone SVG string. */
export function markSvg(px: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${px}" height="${px}">
  <path d="M16 4l2.5 6.1 6.1 2.5-6.1 2.5L16 21.2l-2.5-6.1L7.4 12.6l6.1-2.5L16 4z" fill="${BRAND.accent}"/>
  <ellipse cx="16" cy="24.2" rx="10" ry="3" fill="none" stroke="${BRAND.accent}" stroke-opacity="0.85" stroke-width="1.5"/>
  <ellipse cx="16" cy="25.6" rx="5.6" ry="1.7" fill="none" stroke="${BRAND.accent}" stroke-opacity="0.45" stroke-width="1.3"/>
</svg>`;
}

/** A data URI usable as an <img src> inside next/og ImageResponse. */
export function markDataUri(px: number): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(markSvg(px))}`;
}
