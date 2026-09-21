import { NextResponse } from "next/server";
import { getCredits, listMatches } from "@/lib/db";
import {
  LEAGUES,
  lookbackDays,
  parseLookback,
  type LeagueKey,
} from "@/lib/leagues";
import {
  commenceCutoffIso,
  estimateHistoryCredits,
  refreshLeagueMatches,
} from "@/lib/matches";
import { OddsApiError } from "@/lib/odds-api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isLeagueKey(value: string): value is LeagueKey {
  return LEAGUES.some((league) => league.key === value);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const league = params.get("league") ?? "all";
  const lookback = parseLookback(params.get("lookback"));
  const days = lookbackDays(lookback);
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
    let historyDaysFetched = 0;
    const estimatedHistoryCredits = estimateHistoryCredits(sportKeys, days);

    for (const sportKey of sportKeys) {
      try {
        const result = await refreshLeagueMatches(sportKey, days);
        if (result.scoresFetched) scoresFetched.push(sportKey);
        historyDaysFetched += result.historyDaysFetched;
      } catch (error) {
        if (sportKeys.length === 1) throw error;
      }
    }

    const matches =
      league === "all"
        ? listMatches(undefined, commenceCutoffIso(days))
        : listMatches(league, commenceCutoffIso(days));

    return NextResponse.json({
      matches,
      lookback,
      lookbackDays: days,
      scoresFetched,
      historyDaysFetched,
      estimatedHistoryCredits,
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
