import { createHash } from "crypto";

/* JSON with an ETag, for the GETs a page repeats on every visit (the deck,
   its cards, the deck list, the collection). The browser sends the tag back
   (If-None-Match) and, when the data hasn't changed, gets a 304 with no body
   and reuses its copy. The query still runs; what's saved is the download,
   which for a big collection on a phone is most of the wait.

   `private, no-cache`: the browser keeps it but always asks first, and no
   shared cache may store it — the data is per account. */
export function jsonWithEtag(req: Request, data: unknown): Response {
  const body = JSON.stringify(data);
  const etag = `W/"${createHash("sha1").update(body).digest("base64url")}"`;
  const headers: Record<string, string> = { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Cookie" };
  const sent = req.headers.get("if-none-match");
  if (sent && sent.split(",").some((t) => t.trim() === etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
}
