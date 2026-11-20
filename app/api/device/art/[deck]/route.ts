import { NextResponse } from "next/server";
import { artTag, coverForDevice, deviceFromRequest } from "@/lib/device";
import { dialArtFor, DIAL_ART_SIZE } from "@/lib/device-art";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// GET /api/device/art/<deck> — a deck's commander art as the dial shows it:
// 360 × 360, a baseline JPEG, or with ?format=rgb565 the raw pixels. Only
// for a deck that's on the asking dial.
export async function GET(req: Request, { params }: { params: Promise<{ deck: string }> }) {
  if (!rateLimit(`dial:${clientIp(req)}`, 120, 60_000)) return NextResponse.json({ error: "too many requests" }, { status: 429 });
  const device = await deviceFromRequest(req);
  if (!device) return NextResponse.json({ error: "unknown dial — pair it again", code: "unpaired" }, { status: 401 });
  const cover = await coverForDevice(device.id, (await params).deck);
  if (!cover) return NextResponse.json({ error: "no art for that deck" }, { status: 404 });
  const tag = `"${artTag(cover)}"`;
  if (req.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers: { ETag: tag } });
  const format = new URL(req.url).searchParams.get("format") === "rgb565" ? "rgb565" : "jpeg";
  const picture = await dialArtFor(cover, format);
  if (!picture) return NextResponse.json({ error: "the art couldn't be fetched — try again" }, { status: 502 });
  return new Response(new Uint8Array(picture), {
    headers: {
      "Content-Type": format === "jpeg" ? "image/jpeg" : "application/octet-stream",
      "Content-Length": String(picture.length),
      ETag: tag,
      "Cache-Control": "private, max-age=86400",
      "X-Dial-Art-Size": String(DIAL_ART_SIZE),
    },
  });
}
