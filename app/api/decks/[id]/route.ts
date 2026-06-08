import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const data: { name?: string; format?: string; commander?: string | null } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.format === "string" && body.format.trim()) data.format = body.format.trim();
  if ("commander" in body) {
    const c = typeof body.commander === "string" ? body.commander.trim() : "";
    data.commander = c || null;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }
  const deck = await prisma.deck.update({ where: { id: Number(id) }, data });
  return NextResponse.json(deck);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.deck.delete({ where: { id: Number(id) } });
  return new NextResponse(null, { status: 204 });
}
