// The site's public origin, for a server action or page (which has headers,
// not a Request). APP_URL wins; see requestOrigin.

import { headers } from "next/headers";
import { requestOrigin } from "@/lib/auth-core";

export async function siteOrigin(): Promise<string> {
  return requestOrigin(new Request("http://localhost/", { headers: await headers() }));
}
