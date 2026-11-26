import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { putStepsAway } from "@/lib/first-steps-server";

export const runtime = "nodejs";

// Home's "Your free plan" block, put away by its ×. Kept on the account, so
// it stays away on the player's other devices and the server can leave it
// out of the page (kept in the browser, it flashed on every visit).
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  await putStepsAway(user.id);
  return NextResponse.json({ ok: true });
}
