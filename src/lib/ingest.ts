import {
  countCachedSnapshots,
  findCoveringSnapshot,
  getCredits,
  insertSnapshot,
} from "./db";
import {
  CREDIT_PER_MARKET,
  H1_WINDOW_MINUTES,
  MARKETS,
  MATCH_WINDOW_MINUTES,
  SNAPSHOT_INTERVAL_MINUTES,
  type MarketKey,
} from "./leagues";
import { getHistoricalEventOdds } from "./odds-api";
import type { IngestResult } from "./types";

const REQUEST_GAP_MS = 1000;
const MAX_EMPTY_STREAK = 3;
const MAX_STEPS = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

function elapsedMinutes(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 60_000;
}

function marketForElapsed(minutes: number): MarketKey {
  return minutes < H1_WINDOW_MINUTES ? MARKETS.h1 : MARKETS.h2;
}

function expectedSnapshotCount(market: MarketKey): number {
  if (market === MARKETS.h1) {
    return Math.ceil(H1_WINDOW_MINUTES / SNAPSHOT_INTERVAL_MINUTES);
  }
  return Math.ceil(
    (MATCH_WINDOW_MINUTES - H1_WINDOW_MINUTES) / SNAPSHOT_INTERVAL_MINUTES,
  );
}

export function estimateCredits(input: {
  eventId: string;
  bookmaker: string;
  markets: MarketKey[];
}): {
  estimatedCredits: number;
  estimatedSnapshots: number;
  alreadyCached: number;
  remainingSnapshots: number;
} {
  let estimatedSnapshots = 0;
  let alreadyCached = 0;

  for (const market of input.markets) {
    const expected = expectedSnapshotCount(market);
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
}): Promise<IngestResult> {
  const creditsBefore = getCredits();
  const usedBefore = creditsBefore.used ?? 0;

  let date = input.commenceTime;
  const end = addMinutes(input.commenceTime, MATCH_WINDOW_MINUTES);
  let snapshotsFetched = 0;
  let snapshotsCached = 0;
  let snapshotsSkipped = 0;
  let emptyResponses = 0;
  let emptyStreak = 0;
  let lastRequestAt = 0;
  let steps = 0;

  while (Date.parse(date) <= Date.parse(end) && steps < MAX_STEPS) {
    steps += 1;
    const elapsed = elapsedMinutes(input.commenceTime, date);
    const market = marketForElapsed(elapsed);
    if (!input.markets.includes(market)) {
      date = addMinutes(date, SNAPSHOT_INTERVAL_MINUTES);
      continue;
    }

    const existing = findCoveringSnapshot(
      input.eventId,
      input.bookmaker,
      market,
      date,
    );
    if (existing) {
      snapshotsSkipped += 1;
      const next = existing.nextTimestamp ?? addMinutes(date, SNAPSHOT_INTERVAL_MINUTES);
      date =
        Date.parse(next) > Date.parse(date)
          ? next
          : addMinutes(date, SNAPSHOT_INTERVAL_MINUTES);
      emptyStreak = 0;
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

    const bookmaker = response.data.bookmakers.find(
      (item) => item.key === input.bookmaker,
    ) ?? response.data.bookmakers[0];
    const marketData = bookmaker?.markets.find((item) => item.key === market);

    if (!bookmaker || !marketData || marketData.outcomes.length === 0) {
      emptyResponses += 1;
      emptyStreak += 1;
      if (emptyStreak >= MAX_EMPTY_STREAK) {
        if (market === MARKETS.h1 && input.markets.includes(MARKETS.h2)) {
          date = addMinutes(input.commenceTime, H1_WINDOW_MINUTES);
          emptyStreak = 0;
          continue;
        }
        break;
      }
      date = response.next_timestamp ?? addMinutes(date, SNAPSHOT_INTERVAL_MINUTES);
      continue;
    }

    emptyStreak = 0;
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

    const next = response.next_timestamp ?? addMinutes(date, SNAPSHOT_INTERVAL_MINUTES);
    if (Date.parse(next) <= Date.parse(response.timestamp)) {
      date = addMinutes(response.timestamp, SNAPSHOT_INTERVAL_MINUTES);
    } else {
      date = next;
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
    coverage === "none"
      ? `No ${input.markets.join(" / ")} odds from this bookmaker in the match window. Empty historical responses are not billed.`
      : coverage === "partial"
        ? `Saved ${snapshotsCached} snapshots (${snapshotsSkipped} already cached). Some timestamps had no market for this book.`
        : snapshotsFetched === 0
          ? `All ${snapshotsSkipped} snapshots were already cached. No credits used.`
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
