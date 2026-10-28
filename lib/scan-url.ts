// A stored Scryfall scan in another size. Plain, so both the server (the
// share image) and the components can use it.

/* The same picture cut from a stored scan: a scan on cards.scryfall.io sits
   in a folder per size (…/normal/front/…), and the art crop is the same file
   in …/art_crop/. That host has no rate limit; a lookup by name goes through
   api.scryfall.com, which allows two a second. Null when the stored URL
   isn't a scan. */
export function scanVersionURL(src: string | undefined, version: string): string | null {
  const m = src?.match(/^(https:\/\/cards\.scryfall\.io\/)(small|normal|large|png|art_crop|border_crop)(\/.+)$/);
  if (!m) return null;
  // PNG scans are the only .png files; every other size is a .jpg.
  const rest = version === "png" ? m[3].replace(/\.jpg(\?|$)/, ".png$1") : m[3].replace(/\.png(\?|$)/, ".jpg$1");
  return m[1] + version + rest;
}
