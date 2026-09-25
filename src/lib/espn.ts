import {
  ESPN_LEAGUES,
  H1_WINDOW_MINUTES,
  MATCH_WINDOW_MINUTES,
  parseClockDisplay,
} from "./leagues";
import type { GoalEvent, HalfEnds, MatchRecord } from "./types";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const TIMEOUT_MS = 8000;

const TEAM_ALIASES: Record<string, string> = {
  wolves: "wolverhampton wanderers",
  wolverhampton: "wolverhampton wanderers",
  spurs: "tottenham hotspur",
  tottenham: "tottenham hotspur",
  "man utd": "manchester united",
  "man united": "manchester united",
  "manchester utd": "manchester united",
  "man city": "manchester city",
  newcastle: "newcastle united",
  "nottm forest": "nottingham forest",
  "nottingham": "nottingham forest",
  psg: "paris saint germain",
  "paris sg": "paris saint germain",
  "paris saint germain": "paris saint germain",
  inter: "internazionale",
  "inter milan": "internazionale",
  "atletico madrid": "atletico de madrid",
  "athletic bilbao": "athletic club",
  bayern: "bayern munich",
  "bayern munchen": "bayern munich",
  "koln": "1 fc koln",
  cologne: "1 fc koln",
  "fc koln": "1 fc koln",
  "west ham": "west ham united",
  "brighton": "brighton and hove albion",
  "leicester": "leicester city",
  "leeds": "leeds united",
  "ipswich": "ipswich town",
};

export type EspnFixture = {
  espnEventId: string;
  espnLeague: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeNames: string[];
  awayNames: string[];
  homeScore: number | null;
  awayScore: number | null;
  completed: boolean;
  phase: "pre" | "live" | "halftime" | "ft";
  period: number | null;
  displayClock: string | null;
};

type EspnKeyEvent = {
  scoringPlay?: boolean;
  shootout?: boolean;
  wallclock?: string;
  text?: string;
  shortText?: string;
  ownGoal?: boolean;
  penaltyKick?: boolean;
  clock?: { value?: number; displayValue?: string };
  period?: { number?: number };
  team?: { displayName?: string; name?: string; location?: string };
  type?: { id?: string; text?: string; type?: string };
  participants?: Array<{ athlete?: { displayName?: string } }>;
};

function espnLeague(sportKey: string): string | null {
  return ESPN_LEAGUES[sportKey] ?? null;
}

export function utcDay(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso.slice(0, 10);
  return new Date(parsed).toISOString().slice(0, 10);
}

function compactDay(day: string): string {
  return day.replace(/-/g, "");
}

export function normalizeTeam(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/&/g, " and ")
    .replace(/saint/g, "st")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(afc|fc|cf|sc|ac|de|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return TEAM_ALIASES[cleaned] ?? cleaned;
}

function teamTokens(name: string): string[] {
  return normalizeTeam(name).split(" ").filter(Boolean);
}

export function teamsMatch(a: string, b: string): boolean {
  const na = normalizeTeam(a);
  const nb = normalizeTeam(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = teamTokens(a);
  const tb = teamTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return small.every((token) => large.includes(token));
}

async function espnGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${ESPN_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "User-Agent": "OddsLens/1.0 (match scores)" },
    });
    if (!response.ok) {
      throw new Error(`ESPN ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

type EspnStatus = {
  displayClock?: string;
  period?: number;
  type?: {
    completed?: boolean;
    state?: string;
    name?: string;
    detail?: string;
    shortDetail?: string;
  };
};

function espnPhase(status: EspnStatus | undefined): EspnFixture["phase"] {
  const type = status?.type;
  const name = type?.name ?? "";
  const detail = `${type?.shortDetail ?? ""} ${type?.detail ?? ""}`;
  if (type?.completed || type?.state === "post" || name === "STATUS_FULL_TIME") return "ft";
  if (name === "STATUS_HALFTIME" || /\bHT\b/i.test(detail)) return "halftime";
  if (type?.state === "in" || name === "STATUS_IN_PROGRESS") return "live";
  return "pre";
}

function espnClock(status: EspnStatus | undefined): string | null {
  const clock = status?.type?.shortDetail ?? status?.type?.detail ?? status?.displayClock;
  const text = clock?.trim();
  return text ? text : null;
}

function namesOf(team: {
  displayName?: string;
  shortDisplayName?: string;
  name?: string;
  location?: string;
  abbreviation?: string;
}): string[] {
  return [
    team.displayName,
    team.shortDisplayName,
    team.name,
    team.location,
    team.abbreviation,
  ].filter((value): value is string => Boolean(value));
}

export async function fetchEspnScoreboard(
  sportKey: string,
  day: string,
): Promise<EspnFixture[]> {
  const league = espnLeague(sportKey);
  if (!league) return [];

  const payload = await espnGet<{
    events?: Array<{
      id: string;
      date?: string;
      competitions?: Array<{
        date?: string;
        status?: EspnStatus;
        competitors?: Array<{
          homeAway?: string;
          score?: string;
          team?: {
            displayName?: string;
            shortDisplayName?: string;
            name?: string;
            location?: string;
            abbreviation?: string;
          };
        }>;
      }>;
    }>;
  }>(`/${league}/scoreboard`, { dates: compactDay(day), limit: "200" });

  const fixtures: EspnFixture[] = [];
  for (const event of payload.events ?? []) {
    const competition = event.competitions?.[0];
    if (!competition) continue;
    const home = competition.competitors?.find((item) => item.homeAway === "home");
    const away = competition.competitors?.find((item) => item.homeAway === "away");
    if (!home?.team || !away?.team) continue;
    const homeScore = home.score === undefined || home.score === "" ? null : Number(home.score);
    const awayScore = away.score === undefined || away.score === "" ? null : Number(away.score);
    fixtures.push({
      espnEventId: event.id,
      espnLeague: league,
      date: competition.date ?? event.date ?? `${day}T00:00:00Z`,
      homeTeam: home.team.displayName ?? home.team.name ?? "",
      awayTeam: away.team.displayName ?? away.team.name ?? "",
      homeNames: namesOf(home.team),
      awayNames: namesOf(away.team),
      homeScore: Number.isFinite(homeScore) ? homeScore : null,
      awayScore: Number.isFinite(awayScore) ? awayScore : null,
      completed: Boolean(competition.status?.type?.completed) || espnPhase(competition.status) === "ft",
      phase: espnPhase(competition.status),
      period: competition.status?.period ?? null,
      displayClock: espnClock(competition.status),
    });
  }
  return fixtures;
}

export function matchEspnFixture(
  match: Pick<MatchRecord, "homeTeam" | "awayTeam" | "commenceTime">,
  fixtures: EspnFixture[],
): EspnFixture | null {
  const kickoff = Date.parse(match.commenceTime);
  const ranked = fixtures
    .map((fixture) => {
      const homeHit = fixture.homeNames.some((name) => teamsMatch(name, match.homeTeam));
      const awayHit = fixture.awayNames.some((name) => teamsMatch(name, match.awayTeam));
      if (!homeHit || !awayHit) return null;
      const delta = Math.abs(Date.parse(fixture.date) - kickoff);
      return { fixture, delta: Number.isFinite(delta) ? delta : Number.POSITIVE_INFINITY };
    })
    .filter((row): row is { fixture: EspnFixture; delta: number } => row !== null)
    .sort((a, b) => a.delta - b.delta);

  const best = ranked[0];
  if (!best) return null;
  if (Number.isFinite(kickoff) && best.delta > 12 * 60 * 60 * 1000) return null;
  return best.fixture;
}

function displayMinuteOf(event: EspnKeyEvent): string {
  const raw = event.clock?.displayValue?.trim();
  if (raw) return raw.endsWith("'") ? raw : `${raw}'`;
  const seconds = event.clock?.value;
  if (seconds === undefined || !Number.isFinite(seconds)) return "—";
  const minutes = Math.max(0, Math.floor(seconds / 60));
  return `${minutes}'`;
}

function elapsedMinutesOf(
  event: EspnKeyEvent,
  commenceTime: string,
  period: 1 | 2,
): number {
  if (event.wallclock) {
    const elapsed = (Date.parse(event.wallclock) - Date.parse(commenceTime)) / 60_000;
    if (Number.isFinite(elapsed)) return Math.max(0, elapsed);
  }
  const seconds = event.clock?.value ?? 0;
  if (period === 1) return Math.max(0, seconds / 60);
  return H1_WINDOW_MINUTES + Math.max(0, (seconds - 45 * 60) / 60);
}

export function parseEspnClockMinute(display?: string | null): number | null {
  const clock = parseClockDisplay(display);
  if (!clock) return null;
  return clock.minute + clock.added;
}

function halfEndsFromEspn(
  keyEvents: EspnKeyEvent[],
  commentary: Array<{ time?: { displayValue?: string }; text?: string }>,
): HalfEnds {
  let h1EndMinute: number | null = null;
  let h2EndMinute: number | null = null;

  for (const event of keyEvents) {
    const kind = event.type?.type ?? event.type?.text?.toLowerCase();
    const minute = parseEspnClockMinute(event.clock?.displayValue);
    if (kind === "halftime" || kind === "end-1st-half") {
      h1EndMinute = minute;
    }
    if (kind === "end-regular-time" || kind === "end-2nd-half") {
      h2EndMinute = minute;
    }
  }

  for (const item of commentary) {
    const text = item.text ?? "";
    const minute = parseEspnClockMinute(item.time?.displayValue);
    if (h1EndMinute == null && /first half ends/i.test(text)) h1EndMinute = minute;
    if (h2EndMinute == null && /second half ends/i.test(text)) h2EndMinute = minute;
  }

  return {
    h1EndMinute:
      h1EndMinute != null && Number.isFinite(h1EndMinute)
        ? Math.max(H1_WINDOW_MINUTES, h1EndMinute)
        : H1_WINDOW_MINUTES,
    h2EndMinute:
      h2EndMinute != null && Number.isFinite(h2EndMinute)
        ? Math.max(MATCH_WINDOW_MINUTES, h2EndMinute)
        : MATCH_WINDOW_MINUTES,
  };
}

export async function fetchEspnGoals(
  espnLeagueKey: string,
  espnEventId: string,
  match: Pick<MatchRecord, "homeTeam" | "awayTeam" | "commenceTime">,
): Promise<{
  homeScore: number | null;
  awayScore: number | null;
  completed: boolean;
  goals: GoalEvent[];
  halfEnds: HalfEnds;
}> {
  const payload = await espnGet<{
    header?: {
      competitions?: Array<{
        status?: { type?: { completed?: boolean } };
        competitors?: Array<{
          homeAway?: string;
          score?: string;
        }>;
      }>;
    };
    keyEvents?: EspnKeyEvent[];
    commentary?: Array<{ time?: { displayValue?: string }; text?: string }>;
  }>(`/${espnLeagueKey}/summary`, { event: espnEventId });

  const competition = payload.header?.competitions?.[0];
  const home = competition?.competitors?.find((item) => item.homeAway === "home");
  const away = competition?.competitors?.find((item) => item.homeAway === "away");
  const homeScore = home?.score === undefined || home.score === "" ? null : Number(home.score);
  const awayScore = away?.score === undefined || away.score === "" ? null : Number(away.score);

  const scoring = (payload.keyEvents ?? []).filter((event) => {
    if (event.shootout) return false;
    const kind = event.type?.type ?? event.type?.text?.toLowerCase();
    return Boolean(event.scoringPlay) && (kind === "goal" || event.type?.id === "70");
  });

  scoring.sort((a, b) => Date.parse(a.wallclock ?? "") - Date.parse(b.wallclock ?? ""));

  let runningHome = 0;
  let runningAway = 0;
  const goals: GoalEvent[] = [];

  for (const event of scoring) {
    const period: 1 | 2 = event.period?.number === 2 ? 2 : 1;
    const team =
      event.team?.displayName ?? event.team?.name ?? event.team?.location ?? "";
    if (teamsMatch(team, match.homeTeam)) runningHome += 1;
    else runningAway += 1;

    const athletes = (event.participants ?? [])
      .map((item) => item.athlete?.displayName)
      .filter((name): name is string => Boolean(name));

    goals.push({
      period,
      displayMinute: displayMinuteOf(event),
      elapsedMinutes: elapsedMinutesOf(event, match.commenceTime, period),
      wallclock: event.wallclock ?? null,
      team,
      scorer: athletes[0] ?? null,
      assist: athletes[1] ?? null,
      homeScore: runningHome,
      awayScore: runningAway,
      ownGoal: Boolean(event.ownGoal) || event.type?.type === "own-goal",
      penalty: Boolean(event.penaltyKick) || event.type?.type === "penalty-goal",
    });
  }

  return {
    homeScore: Number.isFinite(homeScore as number) ? homeScore : runningHome,
    awayScore: Number.isFinite(awayScore as number) ? awayScore : runningAway,
    completed: Boolean(competition?.status?.type?.completed),
    goals,
    halfEnds: halfEndsFromEspn(payload.keyEvents ?? [], payload.commentary ?? []),
  };
}
