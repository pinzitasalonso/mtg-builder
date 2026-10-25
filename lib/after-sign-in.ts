/* Where to pick up after signing in. A signed-out player who asks for
   something that needs an account (a new deck, a copy of one) is sent to
   /login. Every way in (password, Google, Apple, the verify link) lands on
   home afterwards, which takes this and carries on: "new" opens the new-deck
   form, a path goes back to that page. Kept in sessionStorage, so it survives
   the OAuth redirects in this tab and nothing else. */

const KEY = "sp-after-sign-in";

export type AfterSignIn = "new" | `/${string}`;

export function rememberAfterSignIn(next: AfterSignIn): void {
  try {
    sessionStorage.setItem(KEY, next);
  } catch {
    /* storage off: they land on home */
  }
}

/** The stored step, once; null when there is none or it isn't one of ours. */
export function takeAfterSignIn(): AfterSignIn | null {
  let v: string | null = null;
  try {
    v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  return parseAfterSignIn(v);
}

// Only "new" or a path on this site: "//evil.com" is another site.
export function parseAfterSignIn(v: string | null): AfterSignIn | null {
  if (v === "new") return "new";
  if (v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\")) return v as AfterSignIn;
  return null;
}
