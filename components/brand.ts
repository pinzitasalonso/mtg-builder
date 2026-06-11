// Brand constants shared by generated images (apple-icon, opengraph-image).
export const BRAND = {
  bg: "#fbfbf8",
  accent: "#2742d6",
  text: "#15151a",
  muted: "#9a9aa2",
  disc: "#4a90c9", // blue mana disc — the logo mark
};

/** The Spellpool mark — a flat blue mana disc with a water-drop cut-out. */
export function markSvg(px: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${px}" height="${px}">
  <circle cx="16" cy="16" r="15" fill="${BRAND.disc}"/>
  <path transform="translate(4,4)" d="M12 3.2c2.6 4 5.6 7.2 5.6 10.4a5.6 5.6 0 1 1-11.2 0C6.4 10.4 9.4 7.2 12 3.2z" fill="${BRAND.bg}"/>
</svg>`;
}

/** A data URI usable as an <img src> inside next/og ImageResponse. */
export function markDataUri(px: number): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(markSvg(px))}`;
}
