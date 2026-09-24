import { NextResponse } from "next/server";
import { addLiveTarget, getMatch, removeLiveTarget } from "@/lib/db";
import { BOOKMAKERS } from "@/lib/leagues";
import { getLiveStatus, startLiveCollection, stopLiveCollection } from "@/lib/live-collect";
import { OddsApiError } from "@/lib/odds-api";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getLiveStatus());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    bookmaker?: string;
    eventId?: string;
  } | null;

  if (
    !body ||
    (body.action !== "start" &&
      body.action !== "stop" &&
      body.action !== "add" &&
      body.action !== "remove")
  ) {
    return NextResponse.json(
      { error: "Expected action start, stop, add, or remove" },
      { status: 400 },
    );
  }

  if (body.action === "add" || body.action === "remove") {
    const eventId = body.eventId ?? "";
    if (!getMatch(eventId)) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }
    if (body.action === "add") addLiveTarget(eventId);
    else removeLiveTarget(eventId);
    return NextResponse.json(getLiveStatus());
  }

  if (body.action === "stop") {
    return NextResponse.json(stopLiveCollection());
  }

  const bookmaker = body.bookmaker ?? "";
  if (!BOOKMAKERS.some((item) => item.key === bookmaker)) {
    return NextResponse.json({ error: "Unknown bookmaker" }, { status: 400 });
  }

  try {
    const status = await startLiveCollection({ bookmaker });
    return NextResponse.json(status);
  } catch (error) {
    const message =
      error instanceof OddsApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to start live collection";
    return NextResponse.json({ ...getLiveStatus(), error: message }, { status: 500 });
  }
}
