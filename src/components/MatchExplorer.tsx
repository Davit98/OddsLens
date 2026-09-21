"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCredits } from "./CreditsProvider";
import { SnapshotFetchingBanner } from "./SnapshotFetching";
import { formatKickoff, formatMinute, formatOdds, formatScore } from "@/lib/format";
import {
  BOOKMAKERS,
  DEFAULT_BOOKMAKER,
  DEFAULT_LINES,
  H1_WINDOW_MINUTES,
  MARKETS,
  MATCH_WINDOW_MINUTES,
  marketAxis,
  marketWindow,
  snapshotMinutesForMarket,
  leagueTitle,
  type MarketKey,
} from "@/lib/leagues";
import type {
  CreditEstimate,
  Credits,
  GoalEvent,
  HalfEnds,
  IngestResult,
  MatchRecord,
  OddsPoint,
} from "@/lib/types";

type SeriesPoint = OddsPoint & { market: string };

type OddsResponse = {
  match: MatchRecord;
  bookmaker: string;
  markets: MarketKey[];
  series: SeriesPoint[];
  estimate: CreditEstimate;
  estimates?: Record<MarketKey, CreditEstimate>;
  goals?: GoalEvent[];
  halfEnds?: HalfEnds;
  credits?: Credits;
  result?: IngestResult;
  error?: string;
};

const LINE_COLORS = [
  "#34d399",
  "#38bdf8",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
  "#2dd4bf",
  "#f97316",
];

const EMPTY_ESTIMATE: CreditEstimate = {
  estimatedCredits: 0,
  estimatedSnapshots: 0,
  alreadyCached: 0,
  remainingSnapshots: 0,
};

function combineEstimates(parts: CreditEstimate[]): CreditEstimate {
  return parts.reduce(
    (acc, part) => ({
      estimatedCredits: acc.estimatedCredits + part.estimatedCredits,
      estimatedSnapshots: acc.estimatedSnapshots + part.estimatedSnapshots,
      alreadyCached: acc.alreadyCached + part.alreadyCached,
      remainingSnapshots: acc.remainingSnapshots + part.remainingSnapshots,
    }),
    EMPTY_ESTIMATE,
  );
}

function lastName(name: string | null): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

type LinePrices = { overPrice: number | null; underPrice: number | null };

type MarketSnapshot = {
  timestamp: string;
  elapsedMinutes: number;
  prices: Map<number, LinePrices>;
};

function marketSnapshots(series: SeriesPoint[], market: MarketKey): MarketSnapshot[] {
  const byTimestamp = new Map<string, MarketSnapshot>();
  for (const row of series) {
    if (row.market !== market) continue;
    const current = byTimestamp.get(row.timestamp) ?? {
      timestamp: row.timestamp,
      elapsedMinutes: row.elapsedMinutes,
      prices: new Map(),
    };
    if (row.point !== null) {
      current.prices.set(row.point, {
        overPrice: row.overPrice,
        underPrice: row.underPrice,
      });
    }
    byTimestamp.set(row.timestamp, current);
  }
  return [...byTimestamp.values()].sort(
    (a, b) => a.elapsedMinutes - b.elapsedMinutes,
  );
}

function overAt(
  snapshot: MarketSnapshot,
  line: number,
  settled: Map<number, number>,
): number | null {
  const settledAt = settled.get(line);
  if (settledAt !== undefined && snapshot.elapsedMinutes > settledAt) return null;
  return snapshot.prices.get(line)?.overPrice ?? null;
}

function settleTimes(goals: GoalEvent[], market: MarketKey, lines: number[]) {
  const halfGoals = goals
    .filter((goal) => (market === MARKETS.h1 ? goal.period === 1 : goal.period === 2))
    .sort((a, b) => a.elapsedMinutes - b.elapsedMinutes);
  const settled = new Map<number, number>();
  for (const line of lines) {
    let count = 0;
    for (const goal of halfGoals) {
      count += 1;
      if (count > line) {
        settled.set(line, goal.elapsedMinutes);
        break;
      }
    }
  }
  return { halfGoals, settled };
}

export function MatchExplorer({
  match,
  initialGoals = [],
  initialHalfEnds = { h1EndMinute: null, h2EndMinute: null },
}: {
  match: MatchRecord;
  initialGoals?: GoalEvent[];
  initialHalfEnds?: HalfEnds;
}) {
  const { credits, setCredits } = useCredits();
  const [currentMatch, setCurrentMatch] = useState(match);
  const [bookmaker, setBookmaker] = useState(DEFAULT_BOOKMAKER);
  const [fetchH1, setFetchH1] = useState(true);
  const [fetchH2, setFetchH2] = useState(true);
  const [viewMarket, setViewMarket] = useState<MarketKey>(MARKETS.h1);
  const [selectedLines, setSelectedLines] = useState<number[]>(DEFAULT_LINES);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [estimates, setEstimates] = useState<Record<MarketKey, CreditEstimate> | null>(
    null,
  );
  const [goals, setGoals] = useState<GoalEvent[]>(initialGoals);
  const [halfEnds, setHalfEnds] = useState<HalfEnds>(initialHalfEnds);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedMarkets = useMemo(() => {
    const markets: MarketKey[] = [];
    if (fetchH1) markets.push(MARKETS.h1);
    if (fetchH2) markets.push(MARKETS.h2);
    return markets;
  }, [fetchH1, fetchH2]);

  const estimate = useMemo(() => {
    if (!estimates) return null;
    const parts: CreditEstimate[] = [];
    if (fetchH1) parts.push(estimates[MARKETS.h1]);
    if (fetchH2) parts.push(estimates[MARKETS.h2]);
    return combineEstimates(parts);
  }, [estimates, fetchH1, fetchH2]);

  const applyOddsPayload = useCallback(
    (data: OddsResponse) => {
      setSeries(data.series);
      if (data.estimates) setEstimates(data.estimates);
      else if (data.estimate) {
        setEstimates({
          [MARKETS.h1]: data.estimate,
          [MARKETS.h2]: EMPTY_ESTIMATE,
        });
      }
      if (data.match) setCurrentMatch(data.match);
      if (data.goals) setGoals(data.goals);
      if (data.halfEnds) setHalfEnds(data.halfEnds);
      if (data.credits) setCredits(data.credits);
    },
    [setCredits],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ bookmaker });
    const response = await fetch(`/api/matches/${match.id}/odds?${params}`);
    const data = (await response.json()) as OddsResponse;
    if (!response.ok) {
      setError(data.error ?? "Failed to load cached odds");
      setLoading(false);
      return;
    }
    applyOddsPayload(data);
    setLoading(false);
  }, [applyOddsPayload, bookmaker, match.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setCurrentMatch(match);
    setGoals(initialGoals);
    setHalfEnds(initialHalfEnds);
  }, [initialGoals, initialHalfEnds, match]);

  const availableLines = useMemo(() => {
    const points = new Set(
      series
        .filter((row) => row.market === viewMarket && row.point !== null)
        .map((row) => row.point as number),
    );
    return [...points].sort((a, b) => a - b);
  }, [series, viewMarket]);

  useEffect(() => {
    if (availableLines.length === 0) return;
    setSelectedLines((current) => {
      const stillVisible = current.filter((line) => availableLines.includes(line));
      if (stillVisible.length > 0) return stillVisible;
      const halves = availableLines.filter((line) => line % 1 === 0.5).slice(0, 4);
      return halves.length > 0 ? halves : availableLines.slice(0, 4);
    });
  }, [availableLines]);

  const { halfGoals, settled } = useMemo(
    () => settleTimes(goals, viewMarket, selectedLines),
    [goals, selectedLines, viewMarket],
  );

  const viewedHalfEnd =
    viewMarket === MARKETS.h1 ? halfEnds.h1EndMinute : halfEnds.h2EndMinute;
  const axis = useMemo(
    () => marketAxis(viewMarket, viewedHalfEnd),
    [viewMarket, viewedHalfEnd],
  );
  const scheduleLabel = useMemo(() => {
    const minutes = snapshotMinutesForMarket(viewMarket, viewedHalfEnd);
    const start = minutes[0] ?? 0;
    const last = minutes[minutes.length - 1] ?? start;
    const regularEnd = viewMarket === MARKETS.h1 ? H1_WINDOW_MINUTES : MATCH_WINDOW_MINUTES;
    if (last > regularEnd) {
      return `${minutes.length} snapshots · every 5 minutes from ${start}' to ${regularEnd}', plus ${last}' half end`;
    }
    return `${minutes.length} snapshots per half, every 5 minutes from ${start}' to ${last}'`;
  }, [viewMarket, viewedHalfEnd]);

  const snapshots = useMemo(() => {
    const { min, max } = marketWindow(viewMarket, viewedHalfEnd);
    return marketSnapshots(series, viewMarket).filter(
      (snapshot) => snapshot.elapsedMinutes >= min && snapshot.elapsedMinutes <= max,
    );
  }, [series, viewMarket, viewedHalfEnd]);

  const chartRows = useMemo(
    () =>
      snapshots.map((snapshot) => {
        const row: Record<string, number | string | null> = {
          minute: Math.round(snapshot.elapsedMinutes * 10) / 10,
        };
        for (const line of selectedLines) {
          row[`O${line}`] = overAt(snapshot, line, settled);
        }
        return row;
      }),
    [selectedLines, settled, snapshots],
  );

  async function handleFetch() {
    if (selectedMarkets.length === 0) return;
    setFetching(true);
    setError(null);
    setMessage("Walking 5-minute snapshots. This can take up to a minute.");
    try {
      const response = await fetch(`/api/matches/${match.id}/odds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmaker, markets: selectedMarkets }),
      });
      const data = (await response.json()) as OddsResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "Fetch failed");
      }
      applyOddsPayload(data);
      if (data.result) {
        setMessage(data.result.message);
        setCredits(data.result.credits);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fetch failed");
      setMessage(null);
    } finally {
      setFetching(false);
    }
  }

  const remainingAfter =
    credits?.remaining !== null && credits?.remaining !== undefined && estimate
      ? credits.remaining - estimate.estimatedCredits
      : null;

  const ftScore = formatScore(currentMatch.homeScore, currentMatch.awayScore);
  const viewedRemaining = estimates?.[viewMarket]?.remainingSnapshots ?? 0;

  return (
    <div className="space-y-6">
      <Link href="/" className="mb-1 inline-block text-sm text-slate-400 hover:text-emerald-300">
        ← All matches
      </Link>
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
          {leagueTitle(currentMatch.sportKey)}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-white">
          {currentMatch.homeTeam}{" "}
          <span className="text-slate-500">vs</span> {currentMatch.awayTeam}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Kickoff {formatKickoff(currentMatch.commenceTime)}
          {ftScore ? ` · FT ${ftScore}` : ""}
        </p>
        {goals.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {goals.map((goal) => (
              <span
                key={`${goal.wallclock}-${goal.scorer}-${goal.displayMinute}`}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-rose-400/20 bg-rose-400/10 px-2.5 py-1 text-xs text-rose-100"
              >
                <span className="font-mono text-rose-200">{goal.displayMinute}</span>
                <span>
                  {goal.scorer ?? goal.team}
                  {goal.ownGoal ? " (OG)" : ""}
                  {goal.penalty ? " (P)" : ""}
                </span>
                <span className="font-mono text-slate-400">
                  {goal.homeScore}–{goal.awayScore}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block text-slate-400">Bookmaker</span>
            <select
              value={bookmaker}
              onChange={(event) => setBookmaker(event.target.value)}
              disabled={fetching}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white outline-none ring-emerald-400/40 focus:ring disabled:opacity-60"
            >
              {BOOKMAKERS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.title} ({item.region})
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm">
            <span className="mb-1.5 block text-slate-400">Halves to fetch</span>
            <div className="flex gap-3 pt-2">
              <label className="flex items-center gap-2 text-slate-200">
                <input
                  type="checkbox"
                  checked={fetchH1}
                  disabled={fetching}
                  onChange={(event) => setFetchH1(event.target.checked)}
                />
                1st half
              </label>
              <label className="flex items-center gap-2 text-slate-200">
                <input
                  type="checkbox"
                  checked={fetchH2}
                  disabled={fetching}
                  onChange={(event) => setFetchH2(event.target.checked)}
                />
                2nd half
              </label>
            </div>
          </div>
        </div>

        <div
          className={`flex flex-col justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 ${
            fetching ? "fetch-glow" : ""
          }`}
        >
          <div className="text-sm">
            <p className="text-slate-300">Estimated cost</p>
            <p className="font-mono text-2xl font-semibold text-emerald-300">
              {estimate?.estimatedCredits ?? "—"}{" "}
              <span className="text-sm font-normal text-slate-400">credits</span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {estimate
                ? `${estimate.remainingSnapshots} new snapshots · ${estimate.alreadyCached} already cached`
                : "Calculating…"}
              {remainingAfter !== null ? ` · ~${remainingAfter.toLocaleString()} left after` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleFetch()}
            disabled={
              fetching ||
              selectedMarkets.length === 0 ||
              (estimate?.remainingSnapshots ?? 1) === 0
            }
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              fetching
                ? "bg-emerald-400 text-slate-950"
                : selectedMarkets.length === 0 ||
                    (estimate?.remainingSnapshots ?? 1) === 0
                  ? "cursor-not-allowed bg-slate-600 text-slate-300"
                  : "bg-emerald-400 text-slate-950 hover:bg-emerald-300"
            }`}
          >
            {fetching ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="fetch-spinner h-3.5 w-3.5 rounded-full border-2 border-slate-950/25 border-t-slate-950" />
                Fetching…
              </span>
            ) : selectedMarkets.length === 0 ? (
              "Select a half"
            ) : estimate?.remainingSnapshots === 0 ? (
              "Already cached"
            ) : (
              "Fetch missing snapshots"
            )}
          </button>
        </div>
      </div>

      {fetching ? (
        <SnapshotFetchingBanner
          fetchH1={fetchH1}
          fetchH2={fetchH2}
          remaining={estimate?.remainingSnapshots ?? 0}
          halfEnds={halfEnds}
        />
      ) : message ? (
        <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setViewMarket(MARKETS.h1)}
          className={`rounded-full px-3 py-1.5 text-sm ${
            viewMarket === MARKETS.h1
              ? "bg-white text-slate-950"
              : "border border-white/10 text-slate-300"
          }`}
        >
          1st half chart
        </button>
        <button
          type="button"
          onClick={() => setViewMarket(MARKETS.h2)}
          className={`rounded-full px-3 py-1.5 text-sm ${
            viewMarket === MARKETS.h2
              ? "bg-white text-slate-950"
              : "border border-white/10 text-slate-300"
          }`}
        >
          2nd half chart
        </button>
      </div>

      {availableLines.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {availableLines.map((line) => {
            const active = selectedLines.includes(line);
            return (
              <button
                key={line}
                type="button"
                onClick={() =>
                  setSelectedLines((current) =>
                    current.includes(line)
                      ? current.filter((item) => item !== line)
                      : [...current, line].sort((a, b) => a - b),
                  )
                }
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  active
                    ? "bg-sky-400/20 text-sky-200 ring-1 ring-sky-400/40"
                    : "border border-white/10 text-slate-400"
                }`}
              >
                Over {line}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">
            Over odds · {viewMarket === MARKETS.h1 ? "1st half" : "2nd half"}
          </h2>
          <p className="text-xs text-slate-500">{scheduleLabel}</p>
        </div>
        {loading && !fetching ? (
          <div className="py-16 text-center text-slate-400">Loading cached odds…</div>
        ) : fetching && snapshots.length === 0 ? (
          <div className="py-16 text-center text-slate-400">Fetching snapshots…</div>
        ) : snapshots.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            {viewedRemaining === 0
              ? `This bookmaker has no ${
                  viewMarket === MARKETS.h1 ? "1st" : "2nd"
                }-half totals in the cached window.`
              : `No cached ${
                  viewMarket === MARKETS.h1 ? "1st" : "2nd"
                }-half odds for this bookmaker. Fetch snapshots to populate the chart.`}
          </div>
        ) : selectedLines.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            Select at least one Over line to plot.
          </div>
        ) : (
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={{ top: 24, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  type="number"
                  dataKey="minute"
                  domain={axis.domain}
                  ticks={axis.ticks}
                  allowDataOverflow
                  stroke="#94a3b8"
                  tickFormatter={(value) => formatMinute(Number(value))}
                />
                <YAxis stroke="#94a3b8" domain={["auto", "auto"]} />
                <Tooltip
                  filterNull={false}
                  contentStyle={{
                    background: "#0b1220",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12,
                  }}
                  labelFormatter={(value) => `Elapsed ${formatMinute(Number(value))}`}
                  formatter={(value, name) => [
                    value == null || value === "" ? "—" : Number(value).toFixed(2),
                    name,
                  ]}
                />
                <Legend />
                {halfGoals.map((goal) => (
                  <ReferenceLine
                    key={`${goal.wallclock}-${goal.displayMinute}`}
                    x={goal.elapsedMinutes}
                    stroke="#fb7185"
                    strokeDasharray="4 4"
                    label={{
                      value: `${goal.displayMinute} ${lastName(goal.scorer) ?? goal.team}`,
                      fill: "#fda4af",
                      fontSize: 11,
                      position: "top",
                    }}
                  />
                ))}
                {selectedLines.map((line, index) => (
                  <Line
                    key={line}
                    type="monotone"
                    dataKey={`O${line}`}
                    name={`Over ${line}`}
                    stroke={LINE_COLORS[index % LINE_COLORS.length]}
                    dot
                    connectNulls={false}
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {settled.size > 0 && chartRows.length > 0 ? (
          <p className="mt-3 text-xs text-slate-500">
            After a line is settled, or the book stops offering it, the price shows as —.
          </p>
        ) : null}
      </div>

      {snapshots.length > 0 && selectedLines.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Minute</th>
                {selectedLines.map((line) => (
                  <th key={line} className="px-3 py-2 font-medium">
                    Over {line}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snapshot) => (
                <tr
                  key={snapshot.timestamp}
                  className="border-t border-white/5 font-mono text-slate-200"
                >
                  <td className="px-3 py-1.5">{formatMinute(snapshot.elapsedMinutes)}</td>
                  {selectedLines.map((line) => {
                    const price = overAt(snapshot, line, settled);
                    return (
                      <td
                        key={line}
                        className={`px-3 py-1.5 ${
                          price == null ? "text-slate-500" : "text-emerald-300"
                        }`}
                      >
                        {formatOdds(price)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
