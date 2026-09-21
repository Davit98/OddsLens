import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Credits, MatchRecord, OddsPoint, SnapshotRow } from "./types";

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
  `);
  return g.__oddslensDb;
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

export function listMatches(sportKey?: string, commenceFrom?: string): MatchRecord[] {
  const db = getDb();
  const sql = `
    SELECT m.*,
      (SELECT COUNT(*) FROM snapshots s WHERE s.event_id = m.id) AS cached_snapshots
    FROM matches m
    WHERE m.commence_time >= ?
      ${sportKey ? "AND m.sport_key = ?" : ""}
    ORDER BY m.commence_time DESC
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
    .prepare(
      `SELECT m.*,
        (SELECT COUNT(*) FROM snapshots s WHERE s.event_id = m.id) AS cached_snapshots
       FROM matches m WHERE m.id = ?`,
    )
    .get(id) as DbMatch | undefined;
  return row ? mapMatch(row) : null;
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
       JOIN odds o ON o.snapshot_id = s.id
       WHERE s.event_id = ? AND s.bookmaker = ? AND s.market = ?
       ORDER BY s.timestamp ASC, o.point ASC`,
    )
    .all(input.eventId, input.bookmaker, input.market) as {
    timestamp: string;
    point: number;
    over_price: number | null;
    under_price: number | null;
  }[];

  const kickoff = Date.parse(input.commenceTime);
  return rows.map((row) => ({
    timestamp: row.timestamp,
    elapsedMinutes: (Date.parse(row.timestamp) - kickoff) / 60000,
    point: row.point,
    overPrice: row.over_price,
    underPrice: row.under_price,
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
    cachedBookmakers: getCachedBookmakers(row.id),
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

function toNumber(value: string | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
