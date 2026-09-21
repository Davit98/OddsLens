import { NextResponse } from "next/server";
import { getCredits } from "@/lib/db";
import { OddsApiError, refreshCredits } from "@/lib/odds-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await refreshCredits();
    return NextResponse.json({ credits: getCredits() });
  } catch (error) {
    if (error instanceof OddsApiError) {
      return NextResponse.json(
        { error: error.message, credits: getCredits() },
        { status: error.status === 401 ? 401 : 502 },
      );
    }
    throw error;
  }
}
