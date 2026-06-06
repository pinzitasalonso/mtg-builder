import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.deck.delete({ where: { id: Number(id) } });
  return new NextResponse(null, { status: 204 });
}
