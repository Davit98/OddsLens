import { NextResponse } from "next/server";
import { getCredits, getMatch, getOddsSeries } from "@/lib/db";
import { estimateCredits, ingestMatchOdds } from "@/lib/ingest";
import { MARKETS, type MarketKey } from "@/lib/leagues";
import { OddsApiError } from "@/lib/odds-api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MARKET_VALUES = new Set<string>(Object.values(MARKETS));

function parseMarkets(value: string | null): MarketKey[] {
  const raw = (value ?? `${MARKETS.h1},${MARKETS.h2}`)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => MARKET_VALUES.has(item)) as MarketKey[];
  return raw.length > 0 ? [...new Set(raw)] : [MARKETS.h1, MARKETS.h2];
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
  const series = markets.flatMap((market) =>
    getOddsSeries({
      eventId: id,
      bookmaker,
      market,
      commenceTime: match.commenceTime,
    }).map((point) => ({ ...point, market })),
  );

  return NextResponse.json({
    match,
    bookmaker,
    markets,
    series,
    estimate: estimateCredits({ eventId: id, bookmaker, markets }),
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
    const result = await ingestMatchOdds({
      eventId: match.id,
      sportKey: match.sportKey,
      commenceTime: match.commenceTime,
      bookmaker,
      markets,
    });
    const series = markets.flatMap((market) =>
      getOddsSeries({
        eventId: id,
        bookmaker,
        market,
        commenceTime: match.commenceTime,
      }).map((point) => ({ ...point, market })),
    );
    return NextResponse.json({
      result,
      series,
      match: getMatch(id),
      estimate: estimateCredits({ eventId: id, bookmaker, markets }),
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
