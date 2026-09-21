import { getScoresFetchedOn, setScoresFetchedOn, upsertMatches, type MatchUpsert } from "./db";
import { getEvents, getScores, type ScoreEvent } from "./odds-api";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function toUpsert(event: ScoreEvent): MatchUpsert {
  const homeScore = event.scores?.find((item) => item.name === event.home_team);
  const awayScore = event.scores?.find((item) => item.name === event.away_team);
  return {
    id: event.id,
    sport_key: event.sport_key,
    sport_title: event.sport_title,
    home_team: event.home_team,
    away_team: event.away_team,
    commence_time: event.commence_time,
    completed: Boolean(event.completed),
    home_score: homeScore ? Number(homeScore.score) : null,
    away_score: awayScore ? Number(awayScore.score) : null,
  };
}

export async function refreshLeagueMatches(sportKey: string): Promise<{
  scoresFetched: boolean;
}> {
  const events = await getEvents(sportKey);
  upsertMatches(events.map(toUpsert));

  const day = todayUtc();
  if (getScoresFetchedOn(sportKey) === day) {
    return { scoresFetched: false };
  }

  try {
    const scores = await getScores(sportKey, 3);
    upsertMatches(scores.map(toUpsert));
    setScoresFetchedOn(sportKey, day);
    return { scoresFetched: true };
  } catch {
    return { scoresFetched: false };
  }
}
