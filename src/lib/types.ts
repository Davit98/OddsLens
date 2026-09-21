export type Credits = {
  remaining: number | null;
  used: number | null;
  last: number | null;
  updatedAt: string | null;
};

export type MatchRecord = {
  id: string;
  sportKey: string;
  sportTitle: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  completed: boolean;
  homeScore: number | null;
  awayScore: number | null;
  cachedSnapshots: number;
  cachedBookmakers: string[];
};

export type OddsPoint = {
  timestamp: string;
  elapsedMinutes: number;
  point: number | null;
  overPrice: number | null;
  underPrice: number | null;
};

export type GoalEvent = {
  period: 1 | 2;
  displayMinute: string;
  elapsedMinutes: number;
  wallclock: string | null;
  team: string;
  scorer: string | null;
  assist: string | null;
  homeScore: number;
  awayScore: number;
  ownGoal: boolean;
  penalty: boolean;
};

export type HalfEnds = {
  h1EndMinute: number | null;
  h2EndMinute: number | null;
};

export type CreditEstimate = {
  estimatedCredits: number;
  estimatedSnapshots: number;
  alreadyCached: number;
  remainingSnapshots: number;
};

export type SnapshotRow = {
  id: number;
  eventId: string;
  bookmaker: string;
  market: string;
  timestamp: string;
  previousTimestamp: string | null;
  nextTimestamp: string | null;
};

export type IngestResult = {
  eventId: string;
  bookmaker: string;
  markets: string[];
  snapshotsFetched: number;
  snapshotsCached: number;
  snapshotsSkipped: number;
  creditsSpent: number;
  emptyResponses: number;
  coverage: "ok" | "none" | "partial";
  message: string;
  credits: Credits;
};
