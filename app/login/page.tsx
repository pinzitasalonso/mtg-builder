import { Suspense } from "react";
import LoginForm from "./LoginForm";
import { googleConfigured } from "@/lib/google-auth";

// Rendered per request, not prerendered: googleConfigured() reads the
// environment, and a static build would freeze whatever was set at BUILD
// time — so adding GOOGLE_CLIENT_ID in Railway would leave the button hidden
// until something else forced a rebuild. Nothing is lost, because the form
// below is a client component behind a null Suspense fallback, so this page
// has no static HTML worth keeping anyway.
export const dynamic = "force-dynamic";

// A server component so the page can tell whether Google sign-in is set up.
// Showing a button that can only fail is worse than not showing one.
export default function LoginPage() {
  // useSearchParams inside the form needs a Suspense boundary on a
  // prerendered page.
  return (
    <Suspense fallback={null}>
      <LoginForm googleEnabled={googleConfigured()} />
    </Suspense>
  );
}
