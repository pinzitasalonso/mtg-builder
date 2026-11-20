import { NextResponse } from "next/server";
import { jsonBody, parseId } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { cleanDeviceName } from "@/lib/device";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

// PATCH /api/dials/<id> — rename one of your dials.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const id = parseId((await params).id);
  const body = await jsonBody(req);
  const name = cleanDeviceName(body.name);
  const changed = id === null ? { count: 0 } : await prisma.device.updateMany({ where: { id, userId: user.id }, data: { name } });
  if (!changed.count) return NextResponse.json({ error: "dial not found" }, { status: 404 });
  return NextResponse.json({ ok: true, name });
}

// DELETE /api/dials/<id> — remove a dial. Its token stops working at once:
// the dial shows its pairing screen at its next sync.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const id = parseId((await params).id);
  const gone = id === null ? { count: 0 } : await prisma.device.deleteMany({ where: { id, userId: user.id } });
  if (!gone.count) return NextResponse.json({ error: "dial not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
