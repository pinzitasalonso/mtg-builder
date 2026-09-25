/* Where a post-sign-in redirect may land. Only a path on our own origin: a
   bare "//evil.com" is protocol-relative and would leave the site, so the
   second character has to be checked too.

   No imports, so client components can use it as well as lib/auth-core. */
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.includes("\\") || raw.includes("\n") || raw.includes("\r")) return "/";
  return raw;
}
