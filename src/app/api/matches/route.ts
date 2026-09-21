import { NextResponse } from "next/server";
import { getCredits, listMatches } from "@/lib/db";
import { LEAGUES, type LeagueKey } from "@/lib/leagues";
import { refreshLeagueMatches } from "@/lib/matches";
import { OddsApiError } from "@/lib/odds-api";

function isLeagueKey(value: string): value is LeagueKey {
  return LEAGUES.some((league) => league.key === value);
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const league = new URL(request.url).searchParams.get("league") ?? "all";
  const sportKeys =
    league === "all"
      ? LEAGUES.map((item) => item.key)
      : isLeagueKey(league)
        ? [league]
        : [];

  if (sportKeys.length === 0) {
    return NextResponse.json({ error: "Unknown league" }, { status: 400 });
  }

  try {
    const scoresFetched: string[] = [];
    for (const sportKey of sportKeys) {
      try {
        const result = await refreshLeagueMatches(sportKey);
        if (result.scoresFetched) scoresFetched.push(sportKey);
      } catch (error) {
        if (sportKeys.length === 1) throw error;
      }
    }

    const matches = league === "all" ? listMatches() : listMatches(league);

    return NextResponse.json({
      matches,
      scoresFetched,
      credits: getCredits(),
    });
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
