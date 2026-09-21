import { NextResponse } from "next/server";
import { getCredits, getMatch, getMatchEspn, getOddsSeries } from "@/lib/db";
import { estimateCredits, ingestMatchOdds } from "@/lib/ingest";
import { MARKETS, type MarketKey } from "@/lib/leagues";
import { ensureMatchDetails } from "@/lib/match-details";
import { OddsApiError } from "@/lib/odds-api";
import type { CreditEstimate, HalfEnds } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MARKET_VALUES = new Set<string>(Object.values(MARKETS));
const CHART_MARKETS: MarketKey[] = [MARKETS.h1, MARKETS.h2];

function parseMarkets(value: string | null): MarketKey[] {
  const raw = (value ?? `${MARKETS.h1},${MARKETS.h2}`)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => MARKET_VALUES.has(item)) as MarketKey[];
  return raw.length > 0 ? [...new Set(raw)] : [MARKETS.h1, MARKETS.h2];
}

function seriesFor(id: string, bookmaker: string, commenceTime: string) {
  return CHART_MARKETS.flatMap((market) =>
    getOddsSeries({
      eventId: id,
      bookmaker,
      market,
      commenceTime,
    }).map((point) => ({ ...point, market })),
  );
}

function marketEstimates(
  eventId: string,
  bookmaker: string,
  halfEnds?: HalfEnds | null,
): Record<MarketKey, CreditEstimate> {
  return {
    [MARKETS.h1]: estimateCredits({
      eventId,
      bookmaker,
      halfEnds,
      markets: [MARKETS.h1],
    }),
    [MARKETS.h2]: estimateCredits({
      eventId,
      bookmaker,
      halfEnds,
      markets: [MARKETS.h2],
    }),
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const match = getMatch(id);
  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const bookmaker = searchParams.get("bookmaker") ?? "pinnacle";
  const markets = parseMarkets(searchParams.get("markets"));
  const { goals, halfEnds } = await ensureMatchDetails(match);
  const fresh = getMatch(id) ?? match;

  return NextResponse.json({
    match: fresh,
    bookmaker,
    markets,
    series: seriesFor(id, bookmaker, fresh.commenceTime),
    estimate: estimateCredits({
      eventId: id,
      bookmaker,
      markets,
      halfEnds,
    }),
    estimates: marketEstimates(id, bookmaker, halfEnds),
    goals,
    halfEnds,
    credits: getCredits(),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const match = getMatch(id);
  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    bookmaker?: string;
    markets?: string[];
  };
  const bookmaker = body.bookmaker ?? "pinnacle";
  const markets = parseMarkets(body.markets?.join(",") ?? null);

  try {
    const details = await ensureMatchDetails(match);
    const result = await ingestMatchOdds({
      eventId: match.id,
      sportKey: match.sportKey,
      commenceTime: match.commenceTime,
      bookmaker,
      markets,
      halfEnds: details.halfEnds,
    });
    const halfEnds = getMatchEspn(id)?.halfEnds ?? details.halfEnds;
    const goals = details.goals;
    return NextResponse.json({
      result,
      series: seriesFor(id, bookmaker, match.commenceTime),
      match: getMatch(id),
      estimate: estimateCredits({
        eventId: id,
        bookmaker,
        markets,
        halfEnds,
      }),
      estimates: marketEstimates(id, bookmaker, halfEnds),
      goals,
      halfEnds,
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
