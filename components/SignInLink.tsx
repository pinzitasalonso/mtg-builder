"use client";

import Link from "next/link";
import { rememberAfterSignIn, type AfterSignIn } from "@/lib/after-sign-in";

/* "Sign in" from a page that wants the player back afterwards: home picks
   the path up once they're in (lib/after-sign-in). */
export default function SignInLink({ next, children = "Sign in" }: { next: AfterSignIn; children?: React.ReactNode }) {
  return (
    <Link href="/login" onClick={() => rememberAfterSignIn(next)} style={{ color: "var(--accent)", fontWeight: 600 }}>
      {children}
    </Link>
  );
}
