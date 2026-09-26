import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { clockFromLegacyRow, liveClockFromKey, liveMinuteKey } from "./leagues";
import type {
  Credits,
  GoalEvent,
  HalfEnds,
  LiveCandidate,
  LiveFeedRow,
  LiveJob,
  MatchRecord,
  OddsPoint,
  SnapshotRow,
} from "./types";

const DB_PATH = path.join(process.cwd(), "data", "oddslens.db");

type GlobalDb = {
  __oddslensDb?: Database.Database;
};

function createDb(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      sport_key TEXT NOT NULL,
      sport_title TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      commence_time TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      home_score INTEGER,
      away_score INTEGER,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      bookmaker TEXT NOT NULL,
      market TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      previous_timestamp TEXT,
      next_timestamp TEXT,
      UNIQUE(event_id, bookmaker, market, timestamp)
    );

    CREATE TABLE IF NOT EXISTS odds (
      snapshot_id INTEGER NOT NULL,
      point REAL NOT NULL,
      over_price REAL,
      under_price REAL,
      PRIMARY KEY (snapshot_id, point),
      FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS league_refresh (
      sport_key TEXT PRIMARY KEY,
      scores_fetched_on TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_days (
      sport_key TEXT NOT NULL,
      day TEXT NOT NULL,
      PRIMARY KEY (sport_key, day)
    );

    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      period INTEGER NOT NULL,
      display_minute TEXT NOT NULL,
      elapsed_minutes REAL NOT NULL,
      wallclock TEXT,
      team TEXT NOT NULL,
      scorer TEXT,
      assist TEXT,
      home_score INTEGER NOT NULL,
      away_score INTEGER NOT NULL,
      own_goal INTEGER NOT NULL DEFAULT 0,
      penalty INTEGER NOT NULL DEFAULT 0,
      UNIQUE(event_id, display_minute, team, scorer)
    );

    CREATE TABLE IF NOT EXISTS match_espn (
      event_id TEXT PRIMARY KEY,
      espn_event_id TEXT NOT NULL,
      espn_league TEXT NOT NULL,
      goals_fetched INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS espn_days (
      sport_key TEXT NOT NULL,
      day TEXT NOT NULL,
      PRIMARY KEY (sport_key, day)
    );

    CREATE TABLE IF NOT EXISTS live_jobs (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      bookmaker TEXT NOT NULL,
      sport_key TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      stopped_at TEXT,
      last_tick_at TEXT,
      last_error TEXT,
      credits_spent INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS live_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      bookmaker TEXT NOT NULL,
      market TEXT NOT NULL,
      elapsed_minute INTEGER NOT NULL,
      captured_at TEXT NOT NULL,
      display_clock TEXT,
      period INTEGER,
      home_score INTEGER,
      away_score INTEGER,
      available INTEGER NOT NULL DEFAULT 0,
      last_update TEXT,
      UNIQUE(event_id, bookmaker, market, elapsed_minute)
    );

    CREATE TABLE IF NOT EXISTS live_odds (
      snapshot_id INTEGER NOT NULL,
      point REAL NOT NULL,
      over_price REAL,
      under_price REAL,
      PRIMARY KEY (snapshot_id, point),
      FOREIGN KEY (snapshot_id) REFERENCES live_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS live_targets (
      event_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

export function getDb(): Database.Database {
  const g = globalThis as GlobalDb;
  if (!g.__oddslensDb) {
    g.__oddslensDb = createDb();
  }
  g.__oddslensDb.exec(`
    CREATE TABLE IF NOT EXISTS event_days (
      sport_key TEXT NOT NULL,
      day TEXT NOT NULL,
      PRIMARY KEY (sport_key, day)
    );
    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      period INTEGER NOT NULL,
      display_minute TEXT NOT NULL,
      elapsed_minutes REAL NOT NULL,
      wallclock TEXT,
      team TEXT NOT NULL,
      scorer TEXT,
      assist TEXT,
      home_score INTEGER NOT NULL,
      away_score INTEGER NOT NULL,
      own_goal INTEGER NOT NULL DEFAULT 0,
      penalty INTEGER NOT NULL DEFAULT 0,
      UNIQUE(event_id, display_minute, team, scorer)
    );
    CREATE TABLE IF NOT EXISTS match_espn (
      event_id TEXT PRIMARY KEY,
      espn_event_id TEXT NOT NULL,
      espn_league TEXT NOT NULL,
      goals_fetched INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS espn_days (
      sport_key TEXT NOT NULL,
      day TEXT NOT NULL,
      PRIMARY KEY (sport_key, day)
    );
    CREATE TABLE IF NOT EXISTS live_jobs (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      bookmaker TEXT NOT NULL,
      sport_key TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      stopped_at TEXT,
      last_tick_at TEXT,
      last_error TEXT,
      credits_spent INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS live_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      bookmaker TEXT NOT NULL,
      market TEXT NOT NULL,
      elapsed_minute INTEGER NOT NULL,
      captured_at TEXT NOT NULL,
      display_clock TEXT,
      period INTEGER,
      home_score INTEGER,
      away_score INTEGER,
      available INTEGER NOT NULL DEFAULT 0,
      last_update TEXT,
      UNIQUE(event_id, bookmaker, market, elapsed_minute)
    );
    CREATE TABLE IF NOT EXISTS live_odds (
      snapshot_id INTEGER NOT NULL,
      point REAL NOT NULL,
      over_price REAL,
      under_price REAL,
      PRIMARY KEY (snapshot_id, point),
      FOREIGN KEY (snapshot_id) REFERENCES live_snapshots(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS live_targets (
      event_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `);
  ensureColumn(g.__oddslensDb, "match_espn", "h1_end_minute", "REAL");
  ensureColumn(g.__oddslensDb, "match_espn", "h2_end_minute", "REAL");
  ensureColumn(g.__oddslensDb, "live_snapshots", "last_update", "TEXT");
  migrateLiveMinuteKeys(g.__oddslensDb);
  return g.__oddslensDb;
}

function migrateLiveMinuteKeys(db: Database.Database): void {
  const done = db.prepare("SELECT value FROM meta WHERE key = ?").get("live_minute_keys_v2") as
    | { value: string }
    | undefined;
  if (done) return;

  const rows = db
    .prepare(
      `SELECT id, event_id, bookmaker, market, elapsed_minute, period, display_clock, captured_at
       FROM live_snapshots
       WHERE elapsed_minute < 1000
       ORDER BY captured_at DESC, id DESC`,
    )
    .all() as Array<{
    id: number;
    event_id: string;
    bookmaker: string;
    market: string;
    elapsed_minute: number;
    period: number | null;
    display_clock: string | null;
    captured_at: string;
  }>;

  const update = db.prepare("UPDATE live_snapshots SET elapsed_minute = ? WHERE id = ?");
  const clash = db.prepare(
    `SELECT id FROM live_snapshots
     WHERE event_id = ? AND bookmaker = ? AND market = ? AND elapsed_minute = ? AND id != ?`,
  );
  const removeOdds = db.prepare("DELETE FROM live_odds WHERE snapshot_id = ?");
  const removeSnap = db.prepare("DELETE FROM live_snapshots WHERE id = ?");

  const tx = db.transaction(() => {
    for (const row of rows) {
      const key = liveMinuteKey(clockFromLegacyRow(row.elapsed_minute, row.period, row.display_clock));
      if (key === row.elapsed_minute) continue;
      const existing = clash.get(row.event_id, row.bookmaker, row.market, key, row.id) as
        | { id: number }
        | undefined;
      if (existing) {
        removeOdds.run(row.id);
        removeSnap.run(row.id);
        continue;
      }
      update.run(key, row.id);
    }
    db.prepare(
      `INSERT INTO meta (key, value) VALUES ('live_minute_keys_v2', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();
  });
  tx();
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!cols.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function getMeta(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function getCredits(): Credits {
  return {
    remaining: toNumber(getMeta("credits_remaining")),
    used: toNumber(getMeta("credits_used")),
    last: toNumber(getMeta("credits_last")),
    updatedAt: getMeta("credits_updated_at"),
  };
}

export function saveCredits(headers: Headers): Credits {
  const remaining = headers.get("x-requests-remaining");
  const used = headers.get("x-requests-used");
  const last = headers.get("x-requests-last");
  if (remaining !== null) setMeta("credits_remaining", remaining);
  if (used !== null) setMeta("credits_used", used);
  if (last !== null) setMeta("credits_last", last);
  setMeta("credits_updated_at", new Date().toISOString());
  return getCredits();
}

export type MatchUpsert = {
  id: string;
  sport_key: string;
  sport_title: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  completed?: boolean;
  home_score?: number | null;
  away_score?: number | null;
};

export function upsertMatches(matches: MatchUpsert[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO matches (
      id, sport_key, sport_title, home_team, away_team, commence_time,
      completed, home_score, away_score, last_seen_at
    ) VALUES (
      @id, @sport_key, @sport_title, @home_team, @away_team, @commence_time,
      @completed, @home_score, @away_score, @last_seen_at
    )
    ON CONFLICT(id) DO UPDATE SET
      sport_key = excluded.sport_key,
      sport_title = excluded.sport_title,
      home_team = excluded.home_team,
      away_team = excluded.away_team,
      commence_time = excluded.commence_time,
      completed = MAX(matches.completed, excluded.completed),
      home_score = COALESCE(excluded.home_score, matches.home_score),
      away_score = COALESCE(excluded.away_score, matches.away_score),
      last_seen_at = excluded.last_seen_at
  `);

  const now = new Date().toISOString();
  const tx = db.transaction((rows: MatchUpsert[]) => {
    for (const match of rows) {
      stmt.run({
        id: match.id,
        sport_key: match.sport_key,
        sport_title: match.sport_title,
        home_team: match.home_team,
        away_team: match.away_team,
        commence_time: match.commence_time,
        completed: match.completed ? 1 : 0,
        home_score: match.home_score ?? null,
        away_score: match.away_score ?? null,
        last_seen_at: now,
      });
    }
  });
  tx(matches);
}

const MATCH_COLUMNS = `
  m.*,
  (SELECT COUNT(*) FROM snapshots s WHERE s.event_id = m.id) AS cached_snapshots,
  (SELECT COUNT(DISTINCT elapsed_minute) FROM live_snapshots ls WHERE ls.event_id = m.id) AS live_minutes
`;

export function listMatches(sportKey?: string, commenceFrom?: string): MatchRecord[] {
  const db = getDb();
  const sql = `
    SELECT ${MATCH_COLUMNS}
    FROM matches m
    WHERE m.commence_time >= ?
      ${sportKey ? "AND m.sport_key = ?" : ""}
    ORDER BY m.commence_time ASC
  `;
  const rows = (
    sportKey
      ? db.prepare(sql).all(commenceFrom ?? "1970-01-01", sportKey)
      : db.prepare(sql).all(commenceFrom ?? "1970-01-01")
  ) as DbMatch[];

  return rows.map(mapMatch);
}

export function getMatch(id: string): MatchRecord | null {
  const row = getDb()
    .prepare(`SELECT ${MATCH_COLUMNS} FROM matches m WHERE m.id = ?`)
    .get(id) as DbMatch | undefined;
  return row ? mapMatch(row) : null;
}

export function getLiveJob(): LiveJob | null {
  const row = getDb()
    .prepare(
      `SELECT bookmaker, sport_key, status, started_at, stopped_at, last_tick_at,
              last_error, credits_spent
       FROM live_jobs WHERE id = 1`,
    )
    .get() as DbLiveJob | undefined;
  return row ? mapLiveJob(row) : null;
}

export function startLiveJob(input: { bookmaker: string }): LiveJob {
  const current = getLiveJob();
  if (current?.status === "running" && current.bookmaker === input.bookmaker) {
    return current;
  }

  const startedAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO live_jobs (
         id, bookmaker, sport_key, status, started_at, stopped_at,
         last_tick_at, last_error, credits_spent
       ) VALUES (1, ?, ?, 'running', ?, NULL, NULL, NULL, 0)
       ON CONFLICT(id) DO UPDATE SET
         bookmaker = excluded.bookmaker,
         sport_key = excluded.sport_key,
         status = 'running',
         started_at = excluded.started_at,
         stopped_at = NULL,
         last_tick_at = NULL,
         last_error = NULL,
         credits_spent = 0`,
    )
    .run(input.bookmaker, "selected", startedAt);

  const job = getLiveJob();
  if (!job) throw new Error("Failed to start live job");
  return job;
}

export function stopLiveJob(): LiveJob | null {
  getDb()
    .prepare(
      `UPDATE live_jobs
       SET status = 'stopped', stopped_at = ?
       WHERE id = 1 AND status = 'running'`,
    )
    .run(new Date().toISOString());
  return getLiveJob();
}

export function touchLiveJob(input: { lastError: string | null; creditsDelta: number }): void {
  getDb()
    .prepare(
      `UPDATE live_jobs
       SET last_tick_at = ?, last_error = ?, credits_spent = credits_spent + ?
       WHERE id = 1 AND status = 'running'`,
    )
    .run(new Date().toISOString(), input.lastError, Math.max(0, input.creditsDelta));
}

export type LiveQuote = {
  market: string;
  elapsedMinute: number;
  lastUpdate: string | null;
  available: boolean;
};

export function latestLiveQuotes(eventId: string, bookmaker: string): Map<string, LiveQuote> {
  const rows = getDb()
    .prepare(
      `SELECT market, elapsed_minute, last_update, available
       FROM live_snapshots
       WHERE event_id = ? AND bookmaker = ?
       ORDER BY elapsed_minute ASC, id ASC`,
    )
    .all(eventId, bookmaker) as Array<{
    market: string;
    elapsed_minute: number;
    last_update: string | null;
    available: number;
  }>;

  const quotes = new Map<string, LiveQuote>();
  for (const row of rows) {
    quotes.set(row.market, {
      market: row.market,
      elapsedMinute: row.elapsed_minute,
      lastUpdate: row.last_update,
      available: Boolean(row.available),
    });
  }
  return quotes;
}

export function latestLiveMinute(eventId: string, bookmaker: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT MAX(elapsed_minute) AS minute
       FROM live_snapshots
       WHERE event_id = ? AND bookmaker = ?`,
    )
    .get(eventId, bookmaker) as { minute: number | null };
  return row.minute;
}

export function insertLiveMinute(input: {
  eventId: string;
  bookmaker: string;
  elapsedMinute: number;
  capturedAt: string;
  displayClock: string | null;
  period: number | null;
  homeScore: number | null;
  awayScore: number | null;
  markets: Array<{
    market: string;
    available: boolean;
    lastUpdate: string | null;
    outcomes: Array<{ point: number; overPrice: number | null; underPrice: number | null }>;
  }>;
}): number {
  const db = getDb();
  const upsertSnapshot = db.prepare(
    `INSERT INTO live_snapshots (
       event_id, bookmaker, market, elapsed_minute, captured_at, display_clock,
       period, home_score, away_score, available, last_update
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id, bookmaker, market, elapsed_minute) DO UPDATE SET
       captured_at = excluded.captured_at,
       display_clock = excluded.display_clock,
       period = excluded.period,
       home_score = excluded.home_score,
       away_score = excluded.away_score,
       available = excluded.available,
       last_update = excluded.last_update
     RETURNING id`,
  );
  const clearOdds = db.prepare("DELETE FROM live_odds WHERE snapshot_id = ?");
  const insertOdds = db.prepare(
    `INSERT INTO live_odds (snapshot_id, point, over_price, under_price)
     VALUES (?, ?, ?, ?)`,
  );

  let written = 0;
  const tx = db.transaction(() => {
    for (const market of input.markets) {
      const row = upsertSnapshot.get(
        input.eventId,
        input.bookmaker,
        market.market,
        input.elapsedMinute,
        input.capturedAt,
        input.displayClock,
        input.period,
        input.homeScore,
        input.awayScore,
        market.available ? 1 : 0,
        market.lastUpdate,
      ) as { id: number };
      written += 1;
      clearOdds.run(row.id);
      for (const outcome of market.outcomes) {
        insertOdds.run(row.id, outcome.point, outcome.overPrice, outcome.underPrice);
      }
    }
  });
  tx();
  return written;
}

export function addLiveTarget(eventId: string): void {
  getDb()
    .prepare(
      `INSERT INTO live_targets (event_id, created_at) VALUES (?, ?)
       ON CONFLICT(event_id) DO NOTHING`,
    )
    .run(eventId, new Date().toISOString());
}

export function removeLiveTarget(eventId: string): void {
  getDb().prepare("DELETE FROM live_targets WHERE event_id = ?").run(eventId);
}

/** Uncheck matches that are full time, or that kicked off before the live window. */
export function releaseFinishedLiveTargets(liveUntilIso: string): void {
  getDb()
    .prepare(
      `DELETE FROM live_targets
       WHERE event_id IN (
         SELECT t.event_id
         FROM live_targets t
         INNER JOIN matches m ON m.id = t.event_id
         WHERE m.completed = 1 OR m.commence_time <= ?
       )`,
    )
    .run(liveUntilIso);
}

export function listLiveTargetMatches(): MatchRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT ${MATCH_COLUMNS}
       FROM matches m
       INNER JOIN live_targets t ON t.event_id = m.id
       ORDER BY m.commence_time ASC`,
    )
    .all() as DbMatch[];
  return rows.map(mapMatch);
}

export function listLiveCandidates(input: {
  bookmaker: string;
  fromIso: string;
  toIso: string;
}): LiveCandidate[] {
  const rows = getDb()
    .prepare(
      `SELECT m.id, m.sport_key, m.home_team, m.away_team, m.commence_time, m.completed,
              m.home_score, m.away_score,
              EXISTS(SELECT 1 FROM live_targets t WHERE t.event_id = m.id) AS planned,
              (SELECT COUNT(DISTINCT elapsed_minute) FROM live_snapshots s
                WHERE s.event_id = m.id AND s.bookmaker = ?) AS live_minutes,
              (SELECT MAX(elapsed_minute) FROM live_snapshots s
                WHERE s.event_id = m.id AND s.bookmaker = ?) AS elapsed_minute,
              (SELECT display_clock FROM live_snapshots s
                WHERE s.event_id = m.id AND s.bookmaker = ?
                ORDER BY elapsed_minute DESC, id DESC LIMIT 1) AS display_clock
       FROM matches m
       WHERE (
           m.completed = 0
           AND m.commence_time >= ?
           AND m.commence_time <= ?
         )
         OR EXISTS (SELECT 1 FROM live_targets t WHERE t.event_id = m.id)
       ORDER BY m.commence_time ASC`,
    )
    .all(
      input.bookmaker,
      input.bookmaker,
      input.bookmaker,
      input.fromIso,
      input.toIso,
    ) as DbLiveCandidate[];

  return rows.map((row) => ({
    eventId: row.id,
    sportKey: row.sport_key,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    commenceTime: row.commence_time,
    completed: Boolean(row.completed),
    homeScore: row.home_score,
    awayScore: row.away_score,
    planned: Boolean(row.planned),
    liveMinutes: row.live_minutes,
    elapsedMinute: row.elapsed_minute,
    displayClock: row.display_clock,
  }));
}

export function listLiveFeed(bookmaker: string, limit = 40): LiveFeedRow[] {
  const db = getDb();
  const snapshots = db
    .prepare(
      `SELECT s.id, s.event_id, s.market, s.elapsed_minute, s.display_clock, s.captured_at,
              s.available, s.home_score, s.away_score,
              m.home_team, m.away_team, m.sport_key
       FROM live_snapshots s
       INNER JOIN live_targets t ON t.event_id = s.event_id
       INNER JOIN matches m ON m.id = s.event_id
       WHERE s.bookmaker = ?
       ORDER BY s.captured_at DESC, s.id DESC
       LIMIT ?`,
    )
    .all(bookmaker, limit) as DbLiveFeed[];

  if (snapshots.length === 0) return [];

  const ids = snapshots.map((row) => row.id);
  const odds = db
    .prepare(
      `SELECT snapshot_id, point, over_price
       FROM live_odds
       WHERE snapshot_id IN (${ids.map(() => "?").join(",")})
       ORDER BY point ASC`,
    )
    .all(...ids) as Array<{ snapshot_id: number; point: number; over_price: number | null }>;

  const linesBySnapshot = new Map<number, Array<{ point: number; overPrice: number | null }>>();
  for (const row of odds) {
    const list = linesBySnapshot.get(row.snapshot_id) ?? [];
    if (row.over_price !== null) list.push({ point: row.point, overPrice: row.over_price });
    linesBySnapshot.set(row.snapshot_id, list);
  }

  return snapshots.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    sportKey: row.sport_key,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    market: row.market,
    elapsedMinute: row.elapsed_minute,
    displayClock: row.display_clock,
    capturedAt: row.captured_at,
    available: Boolean(row.available),
    homeScore: row.home_score,
    awayScore: row.away_score,
    lines: linesBySnapshot.get(row.id) ?? [],
  }));
}

export function getCachedBookmakers(eventId: string): string[] {
  const rows = getDb()
    .prepare(
      "SELECT DISTINCT bookmaker FROM snapshots WHERE event_id = ? ORDER BY bookmaker",
    )
    .all(eventId) as { bookmaker: string }[];
  return rows.map((row) => row.bookmaker);
}

export function getScoresFetchedOn(sportKey: string): string | null {
  const row = getDb()
    .prepare("SELECT scores_fetched_on FROM league_refresh WHERE sport_key = ?")
    .get(sportKey) as { scores_fetched_on: string } | undefined;
  return row?.scores_fetched_on ?? null;
}

export function setScoresFetchedOn(sportKey: string, day: string): void {
  getDb()
    .prepare(
      `INSERT INTO league_refresh (sport_key, scores_fetched_on) VALUES (?, ?)
       ON CONFLICT(sport_key) DO UPDATE SET scores_fetched_on = excluded.scores_fetched_on`,
    )
    .run(sportKey, day);
}

export function hasEventDay(sportKey: string, day: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 AS ok FROM event_days WHERE sport_key = ? AND day = ?")
    .get(sportKey, day) as { ok: number } | undefined;
  return Boolean(row);
}

export function markEventDay(sportKey: string, day: string): void {
  getDb()
    .prepare(
      `INSERT INTO event_days (sport_key, day) VALUES (?, ?)
       ON CONFLICT(sport_key, day) DO NOTHING`,
    )
    .run(sportKey, day);
}

export function countMissingEventDays(sportKey: string, days: string[]): number {
  return days.filter((day) => !hasEventDay(sportKey, day)).length;
}

export function hasEspnDay(sportKey: string, day: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 AS ok FROM espn_days WHERE sport_key = ? AND day = ?")
    .get(sportKey, day) as { ok: number } | undefined;
  return Boolean(row);
}

export function markEspnDay(sportKey: string, day: string): void {
  getDb()
    .prepare(
      `INSERT INTO espn_days (sport_key, day) VALUES (?, ?)
       ON CONFLICT(sport_key, day) DO NOTHING`,
    )
    .run(sportKey, day);
}

export function getMatchEspn(eventId: string): {
  espnEventId: string;
  espnLeague: string;
  goalsFetched: boolean;
  halfEnds: HalfEnds;
} | null {
  const row = getDb()
    .prepare(
      `SELECT espn_event_id, espn_league, goals_fetched, h1_end_minute, h2_end_minute
       FROM match_espn WHERE event_id = ?`,
    )
    .get(eventId) as
    | {
        espn_event_id: string;
        espn_league: string;
        goals_fetched: number;
        h1_end_minute: number | null;
        h2_end_minute: number | null;
      }
    | undefined;
  if (!row) return null;
  return {
    espnEventId: row.espn_event_id,
    espnLeague: row.espn_league,
    goalsFetched: Boolean(row.goals_fetched),
    halfEnds: {
      h1EndMinute: row.h1_end_minute,
      h2EndMinute: row.h2_end_minute,
    },
  };
}

export function setMatchEspn(input: {
  eventId: string;
  espnEventId: string;
  espnLeague: string;
  goalsFetched?: boolean;
  halfEnds?: HalfEnds;
}): void {
  getDb()
    .prepare(
      `INSERT INTO match_espn (
         event_id, espn_event_id, espn_league, goals_fetched, h1_end_minute, h2_end_minute
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         espn_event_id = excluded.espn_event_id,
         espn_league = excluded.espn_league,
         goals_fetched = MAX(match_espn.goals_fetched, excluded.goals_fetched),
         h1_end_minute = COALESCE(excluded.h1_end_minute, match_espn.h1_end_minute),
         h2_end_minute = COALESCE(excluded.h2_end_minute, match_espn.h2_end_minute)`,
    )
    .run(
      input.eventId,
      input.espnEventId,
      input.espnLeague,
      input.goalsFetched ? 1 : 0,
      input.halfEnds?.h1EndMinute ?? null,
      input.halfEnds?.h2EndMinute ?? null,
    );
}

export function getGoals(eventId: string): GoalEvent[] {
  const rows = getDb()
    .prepare(
      `SELECT period, display_minute, elapsed_minutes, wallclock, team, scorer,
              assist, home_score, away_score, own_goal, penalty
       FROM goals WHERE event_id = ?
       ORDER BY elapsed_minutes ASC, id ASC`,
    )
    .all(eventId) as DbGoal[];
  return rows.map(mapGoal);
}

export function replaceGoals(eventId: string, goals: GoalEvent[]): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO goals (
      event_id, period, display_minute, elapsed_minutes, wallclock, team,
      scorer, assist, home_score, away_score, own_goal, penalty
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id, display_minute, team, scorer) DO UPDATE SET
      period = excluded.period,
      elapsed_minutes = excluded.elapsed_minutes,
      wallclock = excluded.wallclock,
      assist = excluded.assist,
      home_score = excluded.home_score,
      away_score = excluded.away_score,
      own_goal = excluded.own_goal,
      penalty = excluded.penalty`,
  );
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM goals WHERE event_id = ?").run(eventId);
    for (const goal of goals) {
      insert.run(
        eventId,
        goal.period,
        goal.displayMinute,
        goal.elapsedMinutes,
        goal.wallclock,
        goal.team,
        goal.scorer ?? "",
        goal.assist,
        goal.homeScore,
        goal.awayScore,
        goal.ownGoal ? 1 : 0,
        goal.penalty ? 1 : 0,
      );
    }
  });
  tx();
}

export function findCoveringSnapshot(
  eventId: string,
  bookmaker: string,
  market: string,
  date: string,
): SnapshotRow | null {
  const row = getDb()
    .prepare(
      `SELECT id, event_id, bookmaker, market, timestamp, previous_timestamp, next_timestamp
       FROM snapshots
       WHERE event_id = ? AND bookmaker = ? AND market = ?
         AND timestamp <= ?
         AND (next_timestamp IS NULL OR next_timestamp > ?)
       ORDER BY timestamp DESC
       LIMIT 1`,
    )
    .get(eventId, bookmaker, market, date, date) as DbSnapshot | undefined;
  return row ? mapSnapshot(row) : null;
}

export function hasSnapshot(
  eventId: string,
  bookmaker: string,
  market: string,
  timestamp: string,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 AS ok FROM snapshots
       WHERE event_id = ? AND bookmaker = ? AND market = ? AND timestamp = ?`,
    )
    .get(eventId, bookmaker, market, timestamp) as { ok: number } | undefined;
  return Boolean(row);
}

export function countCachedSnapshots(
  eventId: string,
  bookmaker: string,
  market: string,
): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM snapshots
       WHERE event_id = ? AND bookmaker = ? AND market = ?`,
    )
    .get(eventId, bookmaker, market) as { n: number };
  return row.n;
}

export function insertSnapshot(input: {
  eventId: string;
  bookmaker: string;
  market: string;
  timestamp: string;
  previousTimestamp: string | null;
  nextTimestamp: string | null;
  outcomes: Array<{ point: number; overPrice: number | null; underPrice: number | null }>;
}): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO snapshots (
        event_id, bookmaker, market, timestamp, previous_timestamp, next_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id, bookmaker, market, timestamp) DO UPDATE SET
        previous_timestamp = excluded.previous_timestamp,
        next_timestamp = excluded.next_timestamp`,
    )
    .run(
      input.eventId,
      input.bookmaker,
      input.market,
      input.timestamp,
      input.previousTimestamp,
      input.nextTimestamp,
    );

  const snapshotId =
    Number(result.lastInsertRowid) ||
    (
      db
        .prepare(
          `SELECT id FROM snapshots
           WHERE event_id = ? AND bookmaker = ? AND market = ? AND timestamp = ?`,
        )
        .get(input.eventId, input.bookmaker, input.market, input.timestamp) as {
        id: number;
      }
    ).id;

  const oddsStmt = db.prepare(
    `INSERT INTO odds (snapshot_id, point, over_price, under_price)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(snapshot_id, point) DO UPDATE SET
       over_price = excluded.over_price,
       under_price = excluded.under_price`,
  );

  const tx = db.transaction(() => {
    for (const outcome of input.outcomes) {
      oddsStmt.run(
        snapshotId,
        outcome.point,
        outcome.overPrice,
        outcome.underPrice,
      );
    }
  });
  tx();

  return snapshotId;
}

export function getOddsSeries(input: {
  eventId: string;
  bookmaker: string;
  market: string;
  commenceTime: string;
}): OddsPoint[] {
  const rows = getDb()
    .prepare(
      `SELECT s.timestamp, o.point, o.over_price, o.under_price
       FROM snapshots s
       LEFT JOIN odds o ON o.snapshot_id = s.id
       WHERE s.event_id = ? AND s.bookmaker = ? AND s.market = ?
       ORDER BY s.timestamp ASC, o.point ASC`,
    )
    .all(input.eventId, input.bookmaker, input.market) as {
    timestamp: string;
    point: number | null;
    over_price: number | null;
    under_price: number | null;
  }[];

  const kickoff = Date.parse(input.commenceTime);
  return rows.map((row) => ({
    timestamp: row.timestamp,
    elapsedMinutes: Math.max(0, (Date.parse(row.timestamp) - kickoff) / 60000),
    point: row.point,
    overPrice: row.over_price,
    underPrice: row.under_price,
  }));
}

export function getLiveOddsSeries(input: {
  eventId: string;
  bookmaker: string;
  market: string;
}): OddsPoint[] {
  const rows = getDb()
    .prepare(
      `SELECT s.captured_at, s.elapsed_minute, s.period, s.display_clock,
              o.point, o.over_price, o.under_price
       FROM live_snapshots s
       LEFT JOIN live_odds o ON o.snapshot_id = s.id
       WHERE s.event_id = ? AND s.bookmaker = ? AND s.market = ?
       ORDER BY s.elapsed_minute ASC, o.point ASC`,
    )
    .all(input.eventId, input.bookmaker, input.market) as {
    captured_at: string;
    elapsed_minute: number;
    period: number | null;
    display_clock: string | null;
    point: number | null;
    over_price: number | null;
    under_price: number | null;
  }[];

  return rows.map((row) => ({
    timestamp: `${row.captured_at}:${row.elapsed_minute}`,
    elapsedMinutes: row.elapsed_minute,
    point: row.point,
    overPrice: row.over_price,
    underPrice: row.under_price,
    liveClock:
      liveClockFromKey(row.elapsed_minute) ??
      clockFromLegacyRow(row.elapsed_minute, row.period, row.display_clock),
  }));
}

type DbMatch = {
  id: string;
  sport_key: string;
  sport_title: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  completed: number;
  home_score: number | null;
  away_score: number | null;
  cached_snapshots: number;
  live_minutes: number;
};

type DbLiveJob = {
  bookmaker: string;
  sport_key: string;
  status: string;
  started_at: string;
  stopped_at: string | null;
  last_tick_at: string | null;
  last_error: string | null;
  credits_spent: number;
};

type DbLiveCandidate = {
  id: string;
  sport_key: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  completed: number;
  home_score: number | null;
  away_score: number | null;
  planned: number;
  live_minutes: number;
  elapsed_minute: number | null;
  display_clock: string | null;
};

type DbLiveFeed = {
  id: number;
  event_id: string;
  market: string;
  elapsed_minute: number;
  display_clock: string | null;
  captured_at: string;
  available: number;
  home_score: number | null;
  away_score: number | null;
  home_team: string;
  away_team: string;
  sport_key: string;
};

type DbSnapshot = {
  id: number;
  event_id: string;
  bookmaker: string;
  market: string;
  timestamp: string;
  previous_timestamp: string | null;
  next_timestamp: string | null;
};

type DbGoal = {
  period: number;
  display_minute: string;
  elapsed_minutes: number;
  wallclock: string | null;
  team: string;
  scorer: string | null;
  assist: string | null;
  home_score: number;
  away_score: number;
  own_goal: number;
  penalty: number;
};

function mapMatch(row: DbMatch): MatchRecord {
  return {
    id: row.id,
    sportKey: row.sport_key,
    sportTitle: row.sport_title,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    commenceTime: row.commence_time,
    completed: Boolean(row.completed),
    homeScore: row.home_score,
    awayScore: row.away_score,
    cachedSnapshots: row.cached_snapshots,
    liveMinutes: row.live_minutes ?? 0,
    cachedBookmakers: getCachedBookmakers(row.id),
  };
}

function mapLiveJob(row: DbLiveJob): LiveJob {
  return {
    bookmaker: row.bookmaker,
    sportKey: row.sport_key,
    status: row.status === "running" ? "running" : "stopped",
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    lastTickAt: row.last_tick_at,
    lastError: row.last_error,
    creditsSpent: row.credits_spent,
  };
}

function mapSnapshot(row: DbSnapshot): SnapshotRow {
  return {
    id: row.id,
    eventId: row.event_id,
    bookmaker: row.bookmaker,
    market: row.market,
    timestamp: row.timestamp,
    previousTimestamp: row.previous_timestamp,
    nextTimestamp: row.next_timestamp,
  };
}

function mapGoal(row: DbGoal): GoalEvent {
  return {
    period: row.period === 2 ? 2 : 1,
    displayMinute: row.display_minute,
    elapsedMinutes: row.elapsed_minutes,
    wallclock: row.wallclock,
    team: row.team,
    scorer: row.scorer || null,
    assist: row.assist,
    homeScore: row.home_score,
    awayScore: row.away_score,
    ownGoal: Boolean(row.own_goal),
    penalty: Boolean(row.penalty),
  };
}

function toNumber(value: string | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
