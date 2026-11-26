import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { meOf } from "@/lib/me";

export const runtime = "nodejs";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({ user: await meOf(user) });
}
