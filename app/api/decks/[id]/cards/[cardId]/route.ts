import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> }
) {
  const { cardId } = await params;
  await prisma.poolCard.delete({ where: { id: Number(cardId) } });
  return new NextResponse(null, { status: 204 });
}
