// Brand constants shared by generated images (apple-icon, opengraph-image).
// Tabletop palette: dark felt ground, gold accent, warm paper text.
export const BRAND = {
  bg: "#17131d",
  accent: "#f5c425",
  text: "#f4f0e6",
  muted: "rgba(244,240,230,.6)",
  disc: "#4a90c9", // blue mana disc — the logo mark
  drop: "#fbfbf8", // the mark's off-white water-drop cut-out
};

/** The Spellpool mark — a flat blue mana disc with a water-drop cut-out. */
export function markSvg(px: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${px}" height="${px}">
  <circle cx="16" cy="16" r="15" fill="${BRAND.disc}"/>
  <path transform="translate(4,4)" d="M12 3.2c2.6 4 5.6 7.2 5.6 10.4a5.6 5.6 0 1 1-11.2 0C6.4 10.4 9.4 7.2 12 3.2z" fill="${BRAND.drop}"/>
</svg>`;
}

/** A data URI usable as an <img src> inside next/og ImageResponse. */
export function markDataUri(px: number): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(markSvg(px))}`;
}
