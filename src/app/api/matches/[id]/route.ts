import { NextResponse } from "next/server";
import { getMatch } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const match = getMatch(id);
  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }
  return NextResponse.json({ match });
}
