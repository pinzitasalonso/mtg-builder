// A deck's picture for a Spellpool Dial: the commander's art, cut square
// and made small. The dial's screen is 360 × 360, and a small chip's JPEG
// decoder reads only baseline files, so the picture is re-encoded here: the
// dial never asks Scryfall for anything.

import sharp from "sharp";
import { scanVersionURL } from "@/lib/scan-url";
import { SCRYFALL_HEADERS } from "@/lib/scryfall";

export const DIAL_ART_SIZE = 360;
export type DialArtFormat = "jpeg" | "rgb565";

/** A picture as the dial wants it: a baseline JPEG (about 30 KB), or raw
    RGB565 pixels, little-endian, row by row (259,200 bytes), for a firmware
    with no decoder. */
export async function dialArt(source: Buffer, format: DialArtFormat = "jpeg", size = DIAL_ART_SIZE): Promise<Buffer> {
  // An art crop is wider than tall: the square keeps the part with the most
  // going on (the face, most often), not always the middle.
  const square = sharp(source).resize(size, size, { fit: "cover", position: "attention" }).removeAlpha();
  if (format === "jpeg") return square.jpeg({ quality: 82, progressive: false, chromaSubsampling: "4:2:0", mozjpeg: false }).toBuffer();
  const rgb = await square.raw().toBuffer();
  const out = Buffer.alloc(size * size * 2);
  for (let i = 0, o = 0; i < rgb.length; i += 3, o += 2) {
    out.writeUInt16LE(((rgb[i]! & 0xf8) << 8) | ((rgb[i + 1]! & 0xfc) << 3) | (rgb[i + 2]! >> 3), o);
  }
  return out;
}

/** Where a stored card scan's art crop lives (cards.scryfall.io: the image
    host, which has no rate limit). Null when the URL isn't a scan. */
export const artSourceURL = (stored: string) => scanVersionURL(stored, "art_crop");

// The same few pictures are asked for by every dial that holds the deck:
// kept a while, a handful at a time.
const KEEP = 60;
const cache = new Map<string, Buffer>();

/** A deck picture from its stored scan, fetched and resized (and kept).
    Null when the scan isn't Scryfall's or the fetch fails. */
export async function dialArtFor(stored: string, format: DialArtFormat): Promise<Buffer | null> {
  const src = artSourceURL(stored);
  if (!src) return null;
  const key = `${format}:${src}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    // Scryfall's image host turns away a library's default User-Agent.
    const res = await fetch(src, { headers: { ...SCRYFALL_HEADERS, Accept: "image/*" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const made = await dialArt(Buffer.from(await res.arrayBuffer()), format);
    cache.set(key, made);
    if (cache.size > KEEP) cache.delete(cache.keys().next().value!);
    return made;
  } catch {
    return null;
  }
}
