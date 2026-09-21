export const LEAGUES = [
  {
    key: "soccer_epl",
    title: "Premier League",
    country: "England",
    short: "EPL",
  },
  {
    key: "soccer_spain_la_liga",
    title: "La Liga",
    country: "Spain",
    short: "La Liga",
  },
  {
    key: "soccer_germany_bundesliga",
    title: "Bundesliga",
    country: "Germany",
    short: "Bundesliga",
  },
  {
    key: "soccer_italy_serie_a",
    title: "Serie A",
    country: "Italy",
    short: "Serie A",
  },
  {
    key: "soccer_france_ligue_one",
    title: "Ligue 1",
    country: "France",
    short: "Ligue 1",
  },
] as const;

export type LeagueKey = (typeof LEAGUES)[number]["key"];

export const LEAGUE_BY_KEY = Object.fromEntries(
  LEAGUES.map((league) => [league.key, league]),
) as Record<LeagueKey, (typeof LEAGUES)[number]>;

export const BOOKMAKERS = [
  { key: "pinnacle", title: "Pinnacle", region: "EU" },
  { key: "bet365", title: "bet365", region: "UK" },
  { key: "onexbet", title: "1xBet", region: "EU" },
  { key: "williamhill", title: "William Hill", region: "UK" },
  { key: "unibet_uk", title: "Unibet", region: "UK" },
  { key: "betfair_ex_uk", title: "Betfair Exchange", region: "UK" },
  { key: "paddypower", title: "Paddy Power", region: "UK" },
  { key: "skybet", title: "Sky Bet", region: "UK" },
  { key: "ladbrokes_uk", title: "Ladbrokes", region: "UK" },
  { key: "marathonbet", title: "Marathonbet", region: "EU" },
  { key: "betclic", title: "Betclic", region: "EU" },
  { key: "nordicbet", title: "NordicBet", region: "EU" },
  { key: "betsson", title: "Betsson", region: "EU" },
  { key: "draftkings", title: "DraftKings", region: "US" },
  { key: "fanduel", title: "FanDuel", region: "US" },
] as const;

export const DEFAULT_BOOKMAKER = "pinnacle";

export const MARKETS = {
  h1: "alternate_totals_h1",
  h2: "alternate_totals_h2",
} as const;

export type MarketKey = (typeof MARKETS)[keyof typeof MARKETS];

export const HALF_LENGTH_MINUTES = 45;
export const SNAPSHOT_INTERVAL_MINUTES = 5;
export const SNAPSHOTS_PER_HALF =
  HALF_LENGTH_MINUTES / SNAPSHOT_INTERVAL_MINUTES + 1;
export const H1_WINDOW_MINUTES = HALF_LENGTH_MINUTES;
export const MATCH_WINDOW_MINUTES = HALF_LENGTH_MINUTES * 2;
export const CREDIT_PER_MARKET = 10;

export function snapshotMinutesForMarket(market: MarketKey): number[] {
  const start = market === MARKETS.h1 ? 0 : HALF_LENGTH_MINUTES;
  return Array.from(
    { length: SNAPSHOTS_PER_HALF },
    (_, index) => start + index * SNAPSHOT_INTERVAL_MINUTES,
  );
}

export function walkSnapshotMinutes(fetchH1: boolean, fetchH2: boolean): number[] {
  const minutes = new Set<number>();
  if (fetchH1) {
    for (const minute of snapshotMinutesForMarket(MARKETS.h1)) minutes.add(minute);
  }
  if (fetchH2) {
    for (const minute of snapshotMinutesForMarket(MARKETS.h2)) minutes.add(minute);
  }
  return [...minutes].sort((a, b) => a - b);
}

export const DEFAULT_LINES = [0.5, 1.5, 2.5, 3.5];

export const LOOKBACK_OPTIONS = [
  { key: "3", days: 3, label: "3 days" },
  { key: "7", days: 7, label: "Week" },
  { key: "30", days: 30, label: "Month" },
  { key: "90", days: 90, label: "3 months" },
] as const;

export type LookbackKey = (typeof LOOKBACK_OPTIONS)[number]["key"];
export const DEFAULT_LOOKBACK: LookbackKey = "3";
export const SCORES_LOOKBACK_DAYS = 3;

export const ESPN_LEAGUES: Record<string, string> = {
  soccer_epl: "eng.1",
  soccer_spain_la_liga: "esp.1",
  soccer_germany_bundesliga: "ger.1",
  soccer_italy_serie_a: "ita.1",
  soccer_france_ligue_one: "fra.1",
};

export function parseLookback(value: string | null): LookbackKey {
  return LOOKBACK_OPTIONS.some((item) => item.key === value)
    ? (value as LookbackKey)
    : DEFAULT_LOOKBACK;
}

export function lookbackDays(key: LookbackKey): number {
  return LOOKBACK_OPTIONS.find((item) => item.key === key)?.days ?? 3;
}

export function leagueTitle(sportKey: string): string {
  return LEAGUE_BY_KEY[sportKey as LeagueKey]?.title ?? sportKey;
}
