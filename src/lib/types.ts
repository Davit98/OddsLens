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
  liveMinutes: number;
  cachedBookmakers: string[];
};

export type LiveJob = {
  bookmaker: string;
  sportKey: string;
  status: "running" | "stopped";
  startedAt: string;
  stoppedAt: string | null;
  lastTickAt: string | null;
  lastError: string | null;
  creditsSpent: number;
};

export type LiveCandidate = {
  eventId: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  completed: boolean;
  homeScore: number | null;
  awayScore: number | null;
  planned: boolean;
  liveMinutes: number;
  elapsedMinute: number | null;
  displayClock: string | null;
};

export type CapturedLiveMatch = {
  id: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  completed: boolean;
  homeScore: number | null;
  awayScore: number | null;
  liveMinutes: number;
  lastCapturedAt: string;
  displayClock: string | null;
  elapsedMinute: number | null;
  bookmakers: string[];
  planned: boolean;
};

export type LiveFeedRow = {
  id: number;
  eventId: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  market: string;
  elapsedMinute: number;
  displayClock: string | null;
  capturedAt: string;
  available: boolean;
  homeScore: number | null;
  awayScore: number | null;
  lines: Array<{ point: number; overPrice: number | null }>;
};

export type OddsPoint = {
  timestamp: string;
  elapsedMinutes: number;
  point: number | null;
  overPrice: number | null;
  underPrice: number | null;
  liveClock?: {
    period: 1 | 2;
    minute: number;
    added: number;
  };
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
