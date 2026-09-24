import {
  getCredits,
  getLiveJob,
  insertLiveMinute,
  listLiveCandidates,
  listLiveFeed,
  listLiveTargetMatches,
  startLiveJob,
  storedLiveMarkets,
  stopLiveJob,
  touchLiveJob,
  upsertMatches,
} from "./db";
import {
  fetchEspnScoreboard,
  matchEspnFixture,
  parseEspnClockMinute,
  utcDay,
  type EspnFixture,
} from "./espn";
import {
  DEFAULT_BOOKMAKER,
  H1_WINDOW_MINUTES,
  MARKETS,
  MATCH_WINDOW_MINUTES,
  type MarketKey,
} from "./leagues";
import { getEventOdds, getEvents, OddsApiError, type EventOdds, type ScoreEvent } from "./odds-api";
import type { Credits, LiveCandidate, LiveFeedRow, LiveJob, MatchRecord } from "./types";

const TICK_MS = 30_000;
const REQUEST_GAP_MS = 200;
const LIVE_WINDOW_MINUTES = 150;
const PLAN_PAST_MS = 6 * 60 * 60 * 1000;
const PLAN_FUTURE_MS = 30 * 24 * 60 * 60 * 1000;
const LIVE_MARKETS: MarketKey[] = [MARKETS.h1, MARKETS.h2, MARKETS.full];

type Runtime = {
  timer: ReturnType<typeof setInterval> | null;
  ticking: boolean;
  tick: () => Promise<void>;
};

type GlobalLive = { __oddslensLive?: Runtime };

function runtime(): Runtime {
  const g = globalThis as GlobalLive;
  if (!g.__oddslensLive) {
    g.__oddslensLive = { timer: null, ticking: false, tick: async () => {} };
  }
  return g.__oddslensLive;
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

function marketsFrom(response: EventOdds, bookmaker: string, markets: MarketKey[]) {
  const book = response.bookmakers.find((item) => item.key === bookmaker);
  return markets.map((market) => {
    const marketData = book?.markets.find((item) => item.key === market);
    const outcomes = marketData ? groupOutcomes(marketData.outcomes ?? []) : [];
    return {
      market,
      available: outcomes.length > 0,
      outcomes,
    };
  });
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

  const sample = minuteSample(fixture, event.commence_time);
  if (!sample) return false;

  const have = new Set(storedLiveMarkets(event.id, job.bookmaker, sample.minute));
  const needed = LIVE_MARKETS.filter((market) => !have.has(market));
  if (needed.length === 0) return false;
  if (getLiveJob()?.status !== "running") return false;

  const wait = REQUEST_GAP_MS - (Date.now() - pace.last);
  if (pace.last > 0 && wait > 0) await sleep(wait);

  const response = await getEventOdds({
    sportKey: event.sport_key,
    eventId: event.id,
    bookmaker: job.bookmaker,
    markets: needed.join(","),
  });
  pace.last = Date.now();

  const markets = marketsFrom(response, job.bookmaker, needed);
  insertLiveMinute({
    eventId: event.id,
    bookmaker: job.bookmaker,
    elapsedMinute: sample.minute,
    capturedAt: new Date().toISOString(),
    displayClock: sample.display,
    period: sample.period,
    homeScore: fixture?.homeScore ?? null,
    awayScore: fixture?.awayScore ?? null,
    markets,
  });

  const summary = markets
    .map((market) => `${market.market}=${market.available ? market.outcomes.length : "closed"}`)
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
  if (current.ticking) return;
  current.ticking = true;
  try {
    await runTick();
  } finally {
    current.ticking = false;
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
