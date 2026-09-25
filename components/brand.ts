// Brand constants shared by generated images (apple-icon, opengraph-image).
//
// Fixed values, and always the DARK dress: an app icon and an OG card are
// rendered once and served to everyone, so there is no viewer preference to
// follow. Kept in step with the dark side of globals.css by hand.
export const BRAND = {
  bg: "#0c0c0c",
  accent: "#fdf26f",
  text: "#ffffff",
  muted: "#868686",
  disc: "#0378EA", // the mark's blue
  drop: "#fbfbf8", // the mark's off-white water-drop cut-out
};

/** The brand blue (the mark's squircle). */
export const MARK_BLUE = "#0378EA";

/* The Spellpool mark — a white water drop on a blue squircle — on a 100-unit
   grid. One source for every use: the in-app logo, the favicon, the home-screen
   icons and the share images. */
export const MARK_SQUIRCLE =
  "M50 0C86 0 96 2 98 20C100 34 100 66 98 80C96 98 86 100 50 100C14 100 4 98 2 80C0 66 0 34 2 20C4 2 14 0 50 0Z";
export const MARK_DROP =
  "M50 27.5C48.8 27.5 47.9 28.1 47.3 28.9C42 36.6 36.9 44.8 35.6 51.8A15 15 0 1 0 64.4 51.8C63.1 44.8 58 36.6 52.7 28.9C52.1 28.1 51.2 27.5 50 27.5Z";

/** The mark on its own, as an SVG string. */
export function markSvg(px: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${px}" height="${px}">
  <path d="${MARK_SQUIRCLE}" fill="${MARK_BLUE}"/>
  <path d="${MARK_DROP}" fill="#ffffff"/>
</svg>`;
}

/** The app icon: the mark at 71% on a white tile (the platform rounds the
 *  tile's corners itself). */
export function appIconSvg(px: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${px}" height="${px}">
  <rect width="100" height="100" fill="#ffffff"/>
  <g transform="translate(14.5 14.5) scale(0.71)">
    <path d="${MARK_SQUIRCLE}" fill="${MARK_BLUE}"/>
    <path d="${MARK_DROP}" fill="#ffffff"/>
  </g>
</svg>`;
}

/** A data URI usable as an <img src> inside next/og ImageResponse. */
export function markDataUri(px: number): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(markSvg(px))}`;
}
