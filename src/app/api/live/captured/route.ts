import { NextResponse } from "next/server";
import { listCapturedLiveMatches } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ matches: listCapturedLiveMatches() });
}
