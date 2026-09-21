import {
  getGoals,
  getMatchEspn,
  listMatches,
  markEspnDay,
  replaceGoals,
  setMatchEspn,
  upsertMatches,
} from "./db";
import {
  fetchEspnGoals,
  fetchEspnScoreboard,
  matchEspnFixture,
  utcDay,
  type EspnFixture,
} from "./espn";
import type { GoalEvent, MatchRecord } from "./types";

const ESPN_POOL = 6;

async function mapPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

export async function backfillEspnScores(sportKey: string): Promise<number> {
  const missing = listMatches(sportKey).filter(
    (match) => match.homeScore === null || match.awayScore === null,
  );
  if (missing.length === 0) return 0;

  const byDay = new Map<string, MatchRecord[]>();
  for (const match of missing) {
    const day = utcDay(match.commenceTime);
    const list = byDay.get(day) ?? [];
    list.push(match);
    byDay.set(day, list);
  }

  let updated = 0;
  const days = [...byDay.entries()];
  await mapPool(days, ESPN_POOL, async ([day, matches]) => {
    let fixtures: EspnFixture[];
    try {
      fixtures = await fetchEspnScoreboard(sportKey, day);
    } catch {
      return;
    }
    markEspnDay(sportKey, day);
    const rows = [];
    for (const match of matches) {
      const fixture = matchEspnFixture(match, fixtures);
      if (!fixture) continue;
      setMatchEspn({
        eventId: match.id,
        espnEventId: fixture.espnEventId,
        espnLeague: fixture.espnLeague,
      });
      if (fixture.homeScore === null || fixture.awayScore === null) continue;
      rows.push({
        id: match.id,
        sport_key: match.sportKey,
        sport_title: match.sportTitle,
        home_team: match.homeTeam,
        away_team: match.awayTeam,
        commence_time: match.commenceTime,
        completed: fixture.completed || match.completed,
        home_score: fixture.homeScore,
        away_score: fixture.awayScore,
      });
    }
    if (rows.length > 0) {
      upsertMatches(rows);
      updated += rows.length;
    }
  });
  return updated;
}

export async function ensureMatchDetails(match: MatchRecord): Promise<GoalEvent[]> {
  const existing = getMatchEspn(match.id);
  if (existing?.goalsFetched) {
    return getGoals(match.id);
  }

  let espnEventId = existing?.espnEventId ?? null;
  let espnLeague = existing?.espnLeague ?? null;

  if (!espnEventId || !espnLeague) {
    try {
      const fixtures = await fetchEspnScoreboard(
        match.sportKey,
        utcDay(match.commenceTime),
      );
      const fixture = matchEspnFixture(match, fixtures);
      if (fixture) {
        espnEventId = fixture.espnEventId;
        espnLeague = fixture.espnLeague;
        setMatchEspn({
          eventId: match.id,
          espnEventId,
          espnLeague,
        });
        if (fixture.homeScore !== null && fixture.awayScore !== null) {
          upsertMatches([
            {
              id: match.id,
              sport_key: match.sportKey,
              sport_title: match.sportTitle,
              home_team: match.homeTeam,
              away_team: match.awayTeam,
              commence_time: match.commenceTime,
              completed: fixture.completed || match.completed,
              home_score: fixture.homeScore,
              away_score: fixture.awayScore,
            },
          ]);
        }
      }
    } catch {
      return getGoals(match.id);
    }
  }

  if (!espnEventId || !espnLeague) return getGoals(match.id);

  try {
    const details = await fetchEspnGoals(espnLeague, espnEventId, match);
    replaceGoals(match.id, details.goals);
    setMatchEspn({
      eventId: match.id,
      espnEventId,
      espnLeague,
      goalsFetched: true,
    });
    if (details.homeScore !== null && details.awayScore !== null) {
      upsertMatches([
        {
          id: match.id,
          sport_key: match.sportKey,
          sport_title: match.sportTitle,
          home_team: match.homeTeam,
          away_team: match.awayTeam,
          commence_time: match.commenceTime,
          completed: details.completed || match.completed,
          home_score: details.homeScore,
          away_score: details.awayScore,
        },
      ]);
    }
  } catch {
    return getGoals(match.id);
  }

  return getGoals(match.id);
}
