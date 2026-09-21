import {
  countMissingEventDays,
  getScoresFetchedOn,
  hasEventDay,
  markEventDay,
  setScoresFetchedOn,
  upsertMatches,
  type MatchUpsert,
} from "./db";
import { SCORES_LOOKBACK_DAYS } from "./leagues";
import { backfillEspnScores } from "./match-details";
import {
  getEvents,
  getHistoricalEvents,
  getScores,
  type ScoreEvent,
} from "./odds-api";

const REQUEST_GAP_MS = 250;
const MATCH_DURATION_MS = 150 * 60_000;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function utcDayOffset(daysBack: number): string {
  const now = new Date();
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack),
  );
  return day.toISOString().slice(0, 10);
}

export function lookbackDaysList(days: number): string[] {
  return Array.from({ length: days }, (_, index) => utcDayOffset(index));
}

export function commenceCutoffIso(days: number): string {
  return `${utcDayOffset(days - 1)}T00:00:00.000Z`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toUpsert(event: ScoreEvent): MatchUpsert {
  const homeScore = event.scores?.find((item) => item.name === event.home_team);
  const awayScore = event.scores?.find((item) => item.name === event.away_team);
  const kickoff = Date.parse(event.commence_time);
  const finished =
    Boolean(event.completed) ||
    (Number.isFinite(kickoff) && kickoff + MATCH_DURATION_MS < Date.now());
  return {
    id: event.id,
    sport_key: event.sport_key,
    sport_title: event.sport_title,
    home_team: event.home_team,
    away_team: event.away_team,
    commence_time: event.commence_time,
    completed: finished,
    home_score: homeScore ? Number(homeScore.score) : null,
    away_score: awayScore ? Number(awayScore.score) : null,
  };
}

export async function refreshLeagueMatches(
  sportKey: string,
  lookbackDays: number,
): Promise<{
  scoresFetched: boolean;
  historyDaysFetched: number;
}> {
  const events = await getEvents(sportKey);
  upsertMatches(events.map(toUpsert));

  const day = todayUtc();
  let scoresFetched = false;
  if (getScoresFetchedOn(sportKey) !== day) {
    try {
      const scores = await getScores(sportKey, SCORES_LOOKBACK_DAYS);
      upsertMatches(scores.map(toUpsert));
      setScoresFetchedOn(sportKey, day);
      scoresFetched = true;
    } catch {
      scoresFetched = false;
    }
  }

  let historyDaysFetched = 0;
  if (lookbackDays > SCORES_LOOKBACK_DAYS) {
    historyDaysFetched = await fetchHistoricalEventDays(sportKey, lookbackDays);
  }

  try {
    await backfillEspnScores(sportKey);
  } catch {
    // Scores/goals from ESPN are best-effort; odds still work without them.
  }

  return { scoresFetched, historyDaysFetched };
}

export function estimateHistoryCredits(
  sportKeys: string[],
  lookbackDays: number,
): number {
  if (lookbackDays <= SCORES_LOOKBACK_DAYS) return 0;
  const days = lookbackDaysList(lookbackDays);
  return sportKeys.reduce(
    (total, sportKey) => total + countMissingEventDays(sportKey, days),
    0,
  );
}

async function fetchHistoricalEventDays(
  sportKey: string,
  lookbackDays: number,
): Promise<number> {
  const days = lookbackDaysList(lookbackDays);
  let fetched = 0;
  let lastRequestAt = 0;

  for (const day of days) {
    if (hasEventDay(sportKey, day)) continue;

    const wait = REQUEST_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);

    const events = await getHistoricalEvents(sportKey, `${day}T12:00:00Z`);
    lastRequestAt = Date.now();
    upsertMatches(events.map(toUpsert));
    markEventDay(sportKey, day);
    fetched += 1;
  }

  return fetched;
}
