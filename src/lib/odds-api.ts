import { saveCredits } from "./db";
import { BOOKMAKERS } from "./leagues";

const BASE_URL = "https://api.the-odds-api.com/v4";

export class OddsApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`Odds API ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

function apiKey(): string {
  const key = process.env.ODDS_API_KEY;
  if (!key) {
    throw new OddsApiError(500, "ODDS_API_KEY is not set");
  }
  return key;
}

export type ScoreEvent = {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  completed?: boolean;
  scores?: Array<{ name: string; score: string }> | null;
};

export type HistoricalEventOdds = {
  timestamp: string;
  previous_timestamp: string | null;
  next_timestamp: string | null;
  data: {
    id: string;
    sport_key: string;
    sport_title: string;
    commence_time: string;
    home_team: string;
    away_team: string;
    bookmakers: Array<{
      key: string;
      title: string;
      last_update?: string;
      markets: Array<{
        key: string;
        last_update?: string;
        outcomes: Array<{
          name: string;
          price: number;
          point?: number;
        }>;
      }>;
    }>;
  };
};

async function oddsGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("apiKey", apiKey());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, { cache: "no-store" });
  saveCredits(response.headers);

  const text = await response.text();
  if (!response.ok) {
    throw new OddsApiError(response.status, text.slice(0, 500));
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export function refreshCredits(): Promise<unknown> {
  return oddsGet("/sports");
}

export function getEvents(sportKey: string): Promise<ScoreEvent[]> {
  return oddsGet(`/sports/${sportKey}/events`, { dateFormat: "iso" });
}

export function getScores(sportKey: string, daysFrom = 3): Promise<ScoreEvent[]> {
  return oddsGet(`/sports/${sportKey}/scores`, {
    daysFrom,
    dateFormat: "iso",
  });
}

export type HistoricalEventsResponse = {
  timestamp: string;
  previous_timestamp: string | null;
  next_timestamp: string | null;
  data: ScoreEvent[];
};

export async function getHistoricalEvents(
  sportKey: string,
  date: string,
): Promise<ScoreEvent[]> {
  const payload = await oddsGet<HistoricalEventsResponse | ScoreEvent[]>(
    `/historical/sports/${sportKey}/events`,
    { date, dateFormat: "iso" },
  );
  if (Array.isArray(payload)) return payload;
  return payload?.data ?? [];
}

function regionForBookmaker(bookmaker: string): string {
  const match = BOOKMAKERS.find((item) => item.key === bookmaker);
  return match ? match.region.toLowerCase() : "eu";
}

export function getHistoricalEventOdds(input: {
  sportKey: string;
  eventId: string;
  date: string;
  bookmaker: string;
  markets: string;
}): Promise<HistoricalEventOdds> {
  return oddsGet(
    `/historical/sports/${input.sportKey}/events/${input.eventId}/odds`,
    {
      regions: regionForBookmaker(input.bookmaker),
      bookmakers: input.bookmaker,
      markets: input.markets,
      date: input.date,
      oddsFormat: "decimal",
      dateFormat: "iso",
    },
  );
}
