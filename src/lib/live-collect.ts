import {
  getCredits,
  getLiveJob,
  insertLiveMinute,
  latestLiveQuotes,
  listLiveCandidates,
  listLiveFeed,
  listLiveTargetMatches,
  startLiveJob,
  stopLiveJob,
  touchLiveJob,
  upsertMatches,
  type LiveQuote,
} from "./db";
import {
  fetchEspnScoreboard,
  matchEspnFixture,
  parseEspnClockMinute,
  utcDay,
  type EspnFixture,
} from "./espn";
import {
  bookmakerRegion,
  DEFAULT_BOOKMAKER,
  H1_WINDOW_MINUTES,
  MARKETS,
  MATCH_WINDOW_MINUTES,
  type MarketKey,
} from "./leagues";
import {
  getEventMarkets,
  getEventOdds,
  getEvents,
  OddsApiError,
  type EventOdds,
  type ScoreEvent,
} from "./odds-api";
import type { Credits, LiveCandidate, LiveFeedRow, LiveJob, MatchRecord } from "./types";

const TICK_MS = 30_000;
// A frozen clock (halftime) is refreshed on the second wake-up, not the first.
const SAME_MINUTE_MS = 45_000;
// Keeps a follow-up tick from billing the same minute twice. Still shorter than the wake-up, so a failed minute is retried on the next tick.
const MIN_GAP_MS = 20_000;
const REQUEST_GAP_MS = 200;
const LIVE_WINDOW_MINUTES = 150;
const H2_LEAD_MINUTES = 5;
const PLAN_PAST_MS = 6 * 60 * 60 * 1000;
const PLAN_FUTURE_MS = 30 * 24 * 60 * 60 * 1000;

type MarketCatalog = {
  byBook: Map<string, Set<string>>;
  leadChecked: boolean;
  halfChecked: boolean;
};

type Runtime = {
  timer: ReturnType<typeof setInterval> | null;
  ticking: boolean;
  pending: boolean;
  tick: () => Promise<void>;
  lastPolledAt: Map<string, number>;
  lastMinute: Map<string, number>;
  marketCatalog: Map<string, MarketCatalog>;
};

type GlobalLive = { __oddslensLive?: Runtime };

function runtime(): Runtime {
  const g = globalThis as GlobalLive;
  if (!g.__oddslensLive) {
    g.__oddslensLive = {
      timer: null,
      ticking: false,
      pending: false,
      tick: async () => {},
      lastPolledAt: new Map(),
      lastMinute: new Map(),
      marketCatalog: new Map(),
    };
  }
  if (!g.__oddslensLive.lastPolledAt) g.__oddslensLive.lastPolledAt = new Map();
  if (!g.__oddslensLive.lastMinute) g.__oddslensLive.lastMinute = new Map();
  if (!g.__oddslensLive.marketCatalog) g.__oddslensLive.marketCatalog = new Map();
  return g.__oddslensLive;
}

function pollDue(pollKey: string, minute: number, now: number): boolean {
  const state = runtime();
  const polledAt = state.lastPolledAt.get(pollKey) ?? 0;
  const elapsed = now - polledAt;
  if (polledAt > 0 && elapsed < MIN_GAP_MS) return false;
  const lastMinute = state.lastMinute.get(pollKey);
  if (lastMinute === undefined || lastMinute !== minute) return true;
  return elapsed >= SAME_MINUTE_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  if (error instanceof OddsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Live collect failed";
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

type SampledMarket = {
  market: MarketKey;
  available: boolean;
  lastUpdate: string | null;
  outcomes: Array<{ point: number; overPrice: number | null; underPrice: number | null }>;
};

function marketsFrom(response: EventOdds, bookmaker: string, markets: MarketKey[]): SampledMarket[] {
  const book = response.bookmakers.find((item) => item.key === bookmaker);
  return markets.map((market) => {
    const marketData = book?.markets.find((item) => item.key === market);
    const outcomes = marketData ? groupOutcomes(marketData.outcomes ?? []) : [];
    const available = outcomes.length > 0;
    return {
      market,
      available,
      lastUpdate: available ? (marketData?.last_update ?? book?.last_update ?? null) : null,
      outcomes: available ? outcomes : [],
    };
  });
}

function marketsForSample(
  sample: { minute: number; period: number | null },
  phase: EspnFixture["phase"] | null,
): MarketKey[] {
  const firstHalfOver = phase === "halftime" || phase === "ft" || sample.period === 2;
  const h2Due = firstHalfOver || sample.minute >= H1_WINDOW_MINUTES - H2_LEAD_MINUTES;
  const markets: MarketKey[] = [MARKETS.full];
  if (!firstHalfOver) markets.push(MARKETS.h1);
  if (h2Due) markets.push(MARKETS.h2);
  return markets;
}

function shouldSave(previous: LiveQuote | undefined, next: SampledMarket, minute: number): boolean {
  if (!previous || previous.elapsedMinute !== minute) return true;
  if (previous.available !== next.available) return true;
  if (!next.available) return false;
  if (next.lastUpdate && previous.lastUpdate === next.lastUpdate) return false;
  return true;
}

function marketStatus(previous: LiveQuote | undefined, next: SampledMarket): string {
  if (!next.available) return "suspended";
  const sameQuote =
    previous?.available === true &&
    Boolean(next.lastUpdate) &&
    previous.lastUpdate === next.lastUpdate;
  return sameQuote ? "unchanged" : String(next.outcomes.length);
}

function minuteSample(
  fixture: EspnFixture | null,
  commenceTime: string,
): { minute: number; display: string; period: number | null } | null {
  const wall = Math.floor((Date.now() - Date.parse(commenceTime)) / 60_000);
  if (!Number.isFinite(wall) || wall < 0 || wall > LIVE_WINDOW_MINUTES) return null;
  if (!fixture || fixture.phase === "pre") {
    return { minute: wall, display: `${wall}'`, period: wall <= H1_WINDOW_MINUTES ? 1 : 2 };
  }

  const parsed = parseEspnClockMinute(fixture.displayClock);
  if (fixture.phase === "halftime") {
    const minute = parsed ?? H1_WINDOW_MINUTES;
    return { minute, display: fixture.displayClock ?? "HT", period: 1 };
  }
  if (fixture.phase === "ft") {
    const minute = parsed ?? MATCH_WINDOW_MINUTES;
    return { minute, display: fixture.displayClock ?? "FT", period: fixture.period ?? 2 };
  }
  const minute = parsed ?? wall;
  return {
    minute,
    display: fixture.displayClock ?? `${minute}'`,
    period: fixture.period,
  };
}

async function loadFixtures(sportKey: string, events: ScoreEvent[]): Promise<EspnFixture[]> {
  const days = new Set<string>([new Date().toISOString().slice(0, 10)]);
  for (const event of events) days.add(utcDay(event.commence_time));

  const batches = await Promise.all(
    [...days].map(async (day) => {
      try {
        return await fetchEspnScoreboard(sportKey, day);
      } catch (error) {
        console.info(`[live] ESPN scoreboard ${day} skipped: ${errorMessage(error)}`);
        return [];
      }
    }),
  );
  return batches.flat();
}

async function offeredMarkets(
  event: ScoreEvent,
  bookmaker: string,
  timing: { h2Lead: boolean; halfOver: boolean },
): Promise<Set<string>> {
  const cacheKey = `${event.id}:${bookmakerRegion(bookmaker)}`;
  const cache = runtime().marketCatalog;
  let catalog = cache.get(cacheKey);
  const bookMarkets = catalog?.byBook.get(bookmaker);
  const hasH2 = bookMarkets?.has(MARKETS.h2) ?? false;
  const refreshLead = timing.h2Lead && !catalog?.leadChecked && !hasH2;
  const refreshHalf = timing.halfOver && !catalog?.halfChecked && !hasH2;
  if (!catalog || refreshLead || refreshHalf) {
    const payload = await getEventMarkets({
      sportKey: event.sport_key,
      eventId: event.id,
      region: bookmakerRegion(bookmaker),
    });
    const byBook = new Map<string, Set<string>>();
    for (const book of payload.bookmakers ?? []) {
      byBook.set(book.key, new Set(book.markets.map((market) => market.key)));
    }
    catalog = {
      byBook,
      leadChecked: Boolean(catalog?.leadChecked) || timing.h2Lead,
      halfChecked: Boolean(catalog?.halfChecked) || timing.halfOver,
    };
    cache.set(cacheKey, catalog);
  }
  return catalog.byBook.get(bookmaker) ?? new Set();
}

async function collectEvent(
  job: LiveJob,
  event: ScoreEvent,
  fixtures: EspnFixture[],
  pace: { last: number },
): Promise<boolean> {
  const kickoff = Date.parse(event.commence_time);
  if (!Number.isFinite(kickoff) || kickoff > Date.now()) return false;

  const fixture = matchEspnFixture(
    {
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      commenceTime: event.commence_time,
    },
    fixtures,
  );

  if (fixture && (fixture.homeScore !== null || fixture.phase === "ft")) {
    upsertMatches([
      {
        id: event.id,
        sport_key: event.sport_key,
        sport_title: event.sport_title,
        home_team: event.home_team,
        away_team: event.away_team,
        commence_time: event.commence_time,
        completed: fixture.phase === "ft",
        home_score: fixture.homeScore,
        away_score: fixture.awayScore,
      },
    ]);
  }

  if (fixture?.phase === "ft") return false;

  const sample = minuteSample(fixture, event.commence_time);
  if (!sample) return false;

  const pollKey = `${event.id}:${job.bookmaker}`;
  const now = Date.now();
  if (!pollDue(pollKey, sample.minute, now)) return false;

  const phase = fixture?.phase ?? null;
  const needed = marketsForSample(sample, phase);
  if (getLiveJob()?.status !== "running") return false;
  // Stamp before the request. Recording the finish time pushed the next sample onto the wake-up after next, so every third minute was skipped.
  runtime().lastPolledAt.set(pollKey, now);

  let offered: Set<string>;
  try {
    offered = await offeredMarkets(event, job.bookmaker, {
      h2Lead: needed.includes(MARKETS.h2),
      halfOver: phase === "halftime" || sample.period === 2,
    });
  } catch (error) {
    console.info(
      `[live] market lookup skipped for ${event.home_team} vs ${event.away_team}: ${errorMessage(error)}`,
    );
    offered = new Set(needed);
  }
  const requested = needed.filter((market) => offered.has(market));
  if (requested.length === 0) {
    runtime().lastMinute.set(pollKey, sample.minute);
    console.info(
      `[live] ${event.home_team} vs ${event.away_team} ${sample.display} ${job.bookmaker} has no advertised half totals`,
    );
    return true;
  }

  const wait = REQUEST_GAP_MS - (Date.now() - pace.last);
  if (pace.last > 0 && wait > 0) await sleep(wait);

  const response = await getEventOdds({
    sportKey: event.sport_key,
    eventId: event.id,
    bookmaker: job.bookmaker,
    markets: requested.join(","),
  });
  pace.last = Date.now();

  const previous = latestLiveQuotes(event.id, job.bookmaker);
  const markets = marketsFrom(response, job.bookmaker, requested);
  const changed = markets.filter((market) => shouldSave(previous.get(market.market), market, sample.minute));
  if (changed.length > 0) {
    insertLiveMinute({
      eventId: event.id,
      bookmaker: job.bookmaker,
      elapsedMinute: sample.minute,
      capturedAt: new Date().toISOString(),
      displayClock: sample.display,
      period: sample.period,
      homeScore: fixture?.homeScore ?? null,
      awayScore: fixture?.awayScore ?? null,
      markets: changed,
    });
  }
  runtime().lastMinute.set(pollKey, sample.minute);

  const summary = markets
    .map((market) => `${market.market}=${marketStatus(previous.get(market.market), market)}`)
    .join(" ");
  console.info(
    `[live] ${event.home_team} vs ${event.away_team} ${sample.display} ${summary}`,
  );
  return true;
}

function asEvent(match: MatchRecord): ScoreEvent {
  return {
    id: match.id,
    sport_key: match.sportKey,
    sport_title: match.sportTitle,
    commence_time: match.commenceTime,
    home_team: match.homeTeam,
    away_team: match.awayTeam,
    completed: match.completed,
  };
}

function isDue(match: MatchRecord): boolean {
  const kickoff = Date.parse(match.commenceTime);
  if (!Number.isFinite(kickoff) || kickoff > Date.now()) return false;
  return Date.now() < kickoff + LIVE_WINDOW_MINUTES * 60_000;
}

async function runTick(): Promise<void> {
  const job = getLiveJob();
  if (!job || job.status !== "running") return;

  const usedBefore = getCredits().used ?? 0;
  let lastError: string | null = null;
  try {
    const planned = listLiveTargetMatches().filter(isDue);
    const sports = [...new Set(planned.map((match) => match.sportKey))];
    const pace = { last: 0 };
    const errors: string[] = [];
    let fetched = 0;

    for (const sportKey of sports) {
      if (getLiveJob()?.status !== "running") break;
      let listed: Set<string> | null = null;
      let fixtures: EspnFixture[] = [];
      try {
        const events = await getEvents(sportKey);
        listed = new Set(events.map((event) => event.id));
        if (events.length > 0) {
          upsertMatches(
            events.map((event) => ({
              id: event.id,
              sport_key: event.sport_key,
              sport_title: event.sport_title,
              home_team: event.home_team,
              away_team: event.away_team,
              commence_time: event.commence_time,
            })),
          );
        }
        fixtures = await loadFixtures(sportKey, events);
      } catch (error) {
        errors.push(`${sportKey}: ${errorMessage(error)}`);
      }

      for (const match of planned.filter((item) => item.sportKey === sportKey)) {
        if (getLiveJob()?.status !== "running") break;
        if (listed && !listed.has(match.id)) {
          const wall = (Date.now() - Date.parse(match.commenceTime)) / 60_000;
          if (wall > 120) continue;
        }
        try {
          const didFetch = await collectEvent(job, asEvent(match), fixtures, pace);
          if (didFetch) fetched += 1;
        } catch (error) {
          errors.push(`${match.homeTeam} vs ${match.awayTeam}: ${errorMessage(error)}`);
        }
      }
    }

    if (errors.length > 0) lastError = errors.join("; ");
    console.info(
      `[live] tick book=${job.bookmaker} planned=${planned.length} fetched=${fetched}`,
    );
  } catch (error) {
    lastError = errorMessage(error);
  } finally {
    const spent = Math.max(0, (getCredits().used ?? usedBefore) - usedBefore);
    touchLiveJob({ lastError, creditsDelta: spent });
  }
}

export async function tickLiveJob(): Promise<void> {
  const current = runtime();
  if (current.ticking) {
    current.pending = true;
    return;
  }
  current.ticking = true;
  try {
    await runTick();
  } finally {
    current.ticking = false;
    if (current.pending) {
      current.pending = false;
      if (getLiveJob()?.status === "running") void current.tick();
    }
  }
}

export function ensureLiveLoop(options?: { immediate?: boolean }): void {
  const current = runtime();
  current.tick = tickLiveJob;
  const job = getLiveJob();
  if (!job || job.status !== "running") {
    if (current.timer) clearInterval(current.timer);
    current.timer = null;
    return;
  }
  if (current.timer) return;
  if (options?.immediate !== false) void current.tick();
  current.timer = setInterval(() => {
    void runtime().tick();
  }, TICK_MS);
}

export function getLiveStatus(): {
  job: LiveJob | null;
  candidates: LiveCandidate[];
  feed: LiveFeedRow[];
  credits: Credits;
} {
  ensureLiveLoop();
  const job = getLiveJob();
  const bookmaker = job?.bookmaker ?? DEFAULT_BOOKMAKER;
  const now = Date.now();
  return {
    job,
    candidates: listLiveCandidates({
      bookmaker,
      fromIso: new Date(now - PLAN_PAST_MS).toISOString(),
      toIso: new Date(now + PLAN_FUTURE_MS).toISOString(),
    }),
    feed: listLiveFeed(bookmaker),
    credits: getCredits(),
  };
}

export async function startLiveCollection(input: {
  bookmaker: string;
}): Promise<ReturnType<typeof getLiveStatus>> {
  startLiveJob(input);
  ensureLiveLoop({ immediate: false });
  await tickLiveJob();
  return getLiveStatus();
}

export function stopLiveCollection(): ReturnType<typeof getLiveStatus> {
  stopLiveJob();
  ensureLiveLoop();
  return getLiveStatus();
}
