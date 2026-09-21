import {
  countCachedSnapshots,
  findCoveringSnapshot,
  getCredits,
  getMatchEspn,
  hasSnapshot,
  insertSnapshot,
} from "./db";
import {
  CREDIT_PER_MARKET,
  MARKETS,
  snapshotMinutesForMarket,
  type MarketKey,
} from "./leagues";
import { getHistoricalEventOdds } from "./odds-api";
import type { HalfEnds, IngestResult } from "./types";

const REQUEST_GAP_MS = 1000;
const MAX_STEPS = 48;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toApiTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function addMinutes(iso: string, minutes: number): string {
  return toApiTimestamp(Date.parse(iso) + minutes * 60_000);
}

function halfEndForMarket(market: MarketKey, halfEnds?: HalfEnds | null): number | null {
  if (!halfEnds) return null;
  return market === MARKETS.h1 ? halfEnds.h1EndMinute : halfEnds.h2EndMinute;
}

export function estimateCredits(input: {
  eventId: string;
  bookmaker: string;
  markets: MarketKey[];
  halfEnds?: HalfEnds | null;
}): {
  estimatedCredits: number;
  estimatedSnapshots: number;
  alreadyCached: number;
  remainingSnapshots: number;
} {
  let estimatedSnapshots = 0;
  let alreadyCached = 0;
  const storedHalfEnds = input.halfEnds ?? getMatchEspn(input.eventId)?.halfEnds ?? null;

  for (const market of input.markets) {
    const expected = snapshotMinutesForMarket(
      market,
      halfEndForMarket(market, storedHalfEnds),
    ).length;
    const cached = countCachedSnapshots(
      input.eventId,
      input.bookmaker,
      market,
    );
    estimatedSnapshots += expected;
    alreadyCached += Math.min(cached, expected);
  }

  const remainingSnapshots = Math.max(0, estimatedSnapshots - alreadyCached);
  return {
    estimatedCredits: remainingSnapshots * CREDIT_PER_MARKET,
    estimatedSnapshots,
    alreadyCached,
    remainingSnapshots,
  };
}

function groupOutcomes(
  outcomes: Array<{ name: string; price: number; point?: number }>,
): Array<{ point: number; overPrice: number | null; underPrice: number | null }> {
  const byPoint = new Map<
    number,
    { point: number; overPrice: number | null; underPrice: number | null }
  >();

  for (const outcome of outcomes) {
    if (outcome.point === undefined) continue;
    const current = byPoint.get(outcome.point) ?? {
      point: outcome.point,
      overPrice: null,
      underPrice: null,
    };
    if (outcome.name === "Over") current.overPrice = outcome.price;
    if (outcome.name === "Under") current.underPrice = outcome.price;
    byPoint.set(outcome.point, current);
  }

  return [...byPoint.values()].sort((a, b) => a.point - b.point);
}

export async function ingestMatchOdds(input: {
  eventId: string;
  sportKey: string;
  commenceTime: string;
  bookmaker: string;
  markets: MarketKey[];
  halfEnds?: HalfEnds | null;
}): Promise<IngestResult> {
  const creditsBefore = getCredits();
  const usedBefore = creditsBefore.used ?? 0;
  const halfEnds = input.halfEnds ?? getMatchEspn(input.eventId)?.halfEnds ?? null;

  let snapshotsFetched = 0;
  let snapshotsCached = 0;
  let snapshotsSkipped = 0;
  let emptyResponses = 0;
  let lastRequestAt = 0;
  let steps = 0;

  outer: for (const market of input.markets) {
    for (const minute of snapshotMinutesForMarket(
      market,
      halfEndForMarket(market, halfEnds),
    )) {
      steps += 1;
      if (steps > MAX_STEPS) break outer;

      const date = addMinutes(input.commenceTime, minute);
      const existing = findCoveringSnapshot(
        input.eventId,
        input.bookmaker,
        market,
        date,
      );
      if (existing) {
        snapshotsSkipped += 1;
        continue;
      }

      const wait = REQUEST_GAP_MS - (Date.now() - lastRequestAt);
      if (wait > 0) await sleep(wait);

      const response = await getHistoricalEventOdds({
        sportKey: input.sportKey,
        eventId: input.eventId,
        date,
        bookmaker: input.bookmaker,
        markets: market,
      });
      lastRequestAt = Date.now();
      snapshotsFetched += 1;

      if (hasSnapshot(input.eventId, input.bookmaker, market, response.timestamp)) {
        snapshotsSkipped += 1;
        continue;
      }

      const bookmaker = response.data.bookmakers.find(
        (item) => item.key === input.bookmaker,
      ) ?? response.data.bookmakers[0];
      const marketData = bookmaker?.markets.find((item) => item.key === market);

      if (!bookmaker || !marketData || marketData.outcomes.length === 0) {
        emptyResponses += 1;
        insertSnapshot({
          eventId: input.eventId,
          bookmaker: input.bookmaker,
          market,
          timestamp: response.timestamp,
          previousTimestamp: response.previous_timestamp,
          nextTimestamp: response.next_timestamp,
          outcomes: [],
        });
        continue;
      }

      insertSnapshot({
        eventId: input.eventId,
        bookmaker: bookmaker.key,
        market,
        timestamp: response.timestamp,
        previousTimestamp: response.previous_timestamp,
        nextTimestamp: response.next_timestamp,
        outcomes: groupOutcomes(marketData.outcomes),
      });
      snapshotsCached += 1;
    }
  }

  const credits = getCredits();
  const creditsSpent = Math.max(0, (credits.used ?? usedBefore) - usedBefore);
  const coverage =
    snapshotsCached === 0 && emptyResponses > 0
      ? "none"
      : snapshotsCached > 0 && emptyResponses > 0
        ? "partial"
        : snapshotsCached > 0
          ? "ok"
          : "none";

  const message =
    snapshotsFetched === 0
      ? `All ${snapshotsSkipped} snapshots were already cached. No credits used.`
      : coverage === "none" && snapshotsSkipped === 0
        ? `No ${input.markets.join(" / ")} odds from this bookmaker in the match window. Empty historical responses are not billed.`
        : coverage === "none"
          ? `No new odds. ${snapshotsSkipped} timestamps already cached; the rest had no market for this book. Empty historical responses are not billed.`
          : coverage === "partial"
            ? `Saved ${snapshotsCached} new snapshots (${snapshotsSkipped} already cached). ${emptyResponses} timestamps had no market for this book.`
            : `Saved ${snapshotsCached} new snapshots (${snapshotsSkipped} already cached).`;

  return {
    eventId: input.eventId,
    bookmaker: input.bookmaker,
    markets: input.markets,
    snapshotsFetched,
    snapshotsCached,
    snapshotsSkipped,
    creditsSpent,
    emptyResponses,
    coverage,
    message,
    credits,
  };
}
