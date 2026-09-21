"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCredits } from "./CreditsProvider";
import { SnapshotFetchingBanner, SnapshotFetchingStage } from "./SnapshotFetching";
import { formatKickoff, formatMinute, formatOdds } from "@/lib/format";
import {
  BOOKMAKERS,
  DEFAULT_BOOKMAKER,
  DEFAULT_LINES,
  H1_WINDOW_MINUTES,
  MARKETS,
  MATCH_WINDOW_MINUTES,
  leagueTitle,
  type MarketKey,
} from "@/lib/leagues";
import type { Credits, IngestResult, MatchRecord, OddsPoint } from "@/lib/types";

type SeriesPoint = OddsPoint & { market: string };

type OddsResponse = {
  match: MatchRecord;
  bookmaker: string;
  markets: MarketKey[];
  series: SeriesPoint[];
  estimate: {
    estimatedCredits: number;
    estimatedSnapshots: number;
    alreadyCached: number;
    remainingSnapshots: number;
  };
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

export function MatchExplorer({ match }: { match: MatchRecord }) {
  const { credits, setCredits } = useCredits();
  const [bookmaker, setBookmaker] = useState(DEFAULT_BOOKMAKER);
  const [fetchH1, setFetchH1] = useState(true);
  const [fetchH2, setFetchH2] = useState(true);
  const [viewMarket, setViewMarket] = useState<MarketKey>(MARKETS.h1);
  const [selectedLines, setSelectedLines] = useState<number[]>(DEFAULT_LINES);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [estimate, setEstimate] = useState<OddsResponse["estimate"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedMarkets = useMemo(() => {
    const markets: MarketKey[] = [];
    if (fetchH1) markets.push(MARKETS.h1);
    if (fetchH2) markets.push(MARKETS.h2);
    return markets.length > 0 ? markets : [MARKETS.h1];
  }, [fetchH1, fetchH2]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      bookmaker,
      markets: selectedMarkets.join(","),
    });
    const response = await fetch(`/api/matches/${match.id}/odds?${params}`);
    const data = (await response.json()) as OddsResponse;
    if (!response.ok) {
      setError(data.error ?? "Failed to load cached odds");
      setLoading(false);
      return;
    }
    setSeries(data.series);
    setEstimate(data.estimate);
    if (data.credits) setCredits(data.credits);
    setLoading(false);
  }, [bookmaker, match.id, selectedMarkets, setCredits]);

  useEffect(() => {
    void load();
  }, [load]);

  const availableLines = useMemo(() => {
    const points = new Set(
      series.filter((row) => row.market === viewMarket).map((row) => row.point),
    );
    return [...points].sort((a, b) => a - b);
  }, [series, viewMarket]);

  useEffect(() => {
    if (availableLines.length === 0) return;
    setSelectedLines((current) => {
      const stillVisible = current.filter((line) => availableLines.includes(line));
      if (stillVisible.length > 0) return stillVisible;
      return availableLines.filter((line) => line % 1 === 0.5).slice(0, 4);
    });
  }, [availableLines]);

  const chartRows = useMemo(() => {
    const byMinute = new Map<number, Record<string, number | string>>();
    for (const row of series) {
      if (row.market !== viewMarket) continue;
      if (!selectedLines.includes(row.point) || row.overPrice === null) continue;
      const minute = Math.round(row.elapsedMinutes * 10) / 10;
      const current = byMinute.get(minute) ?? { minute };
      current[`O${row.point}`] = row.overPrice;
      byMinute.set(minute, current);
    }
    return [...byMinute.values()].sort(
      (a, b) => Number(a.minute) - Number(b.minute),
    );
  }, [selectedLines, series, viewMarket]);

  const tableRows = useMemo(
    () =>
      series
        .filter((row) => row.market === viewMarket)
        .filter((row) => selectedLines.includes(row.point))
        .sort((a, b) => a.elapsedMinutes - b.elapsedMinutes || a.point - b.point),
    [selectedLines, series, viewMarket],
  );

  async function handleFetch() {
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
      setSeries(data.series);
      setEstimate(data.estimate);
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

  return (
    <div className="space-y-6">
      <Link href="/" className="mb-1 inline-block text-sm text-slate-400 hover:text-emerald-300">
        ← All matches
      </Link>
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
          {leagueTitle(match.sportKey)}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-white">
          {match.homeTeam} <span className="text-slate-500">vs</span> {match.awayTeam}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Kickoff {formatKickoff(match.commenceTime)}
          {match.homeScore !== null && match.awayScore !== null
            ? ` · FT ${match.homeScore}–${match.awayScore}`
            : ""}
        </p>
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
            disabled={fetching || (estimate?.remainingSnapshots ?? 1) === 0}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              fetching
                ? "bg-emerald-400 text-slate-950"
                : (estimate?.remainingSnapshots ?? 1) === 0
                  ? "cursor-not-allowed bg-slate-600 text-slate-300"
                  : "bg-emerald-400 text-slate-950 hover:bg-emerald-300"
            }`}
          >
            {fetching ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="fetch-spinner h-3.5 w-3.5 rounded-full border-2 border-slate-950/25 border-t-slate-950" />
                Fetching…
              </span>
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">
            Over odds · {viewMarket === MARKETS.h1 ? "1st half" : "2nd half"}
          </h2>
          <p className="text-xs text-slate-500">
            Historical resolution is ~5 minutes, plotted by elapsed match time
          </p>
        </div>
        {fetching && chartRows.length === 0 ? (
          <SnapshotFetchingStage fetchH1={fetchH1} fetchH2={fetchH2} />
        ) : loading ? (
          <div className="py-16 text-center text-slate-400">Loading cached odds…</div>
        ) : chartRows.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            {estimate?.remainingSnapshots === 0
              ? "This bookmaker has no half-total odds in the cached window."
              : "No cached odds for this bookmaker and half. Fetch snapshots to populate the chart."}
          </div>
        ) : (
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  type="number"
                  dataKey="minute"
                  domain={
                    viewMarket === MARKETS.h1
                      ? [0, H1_WINDOW_MINUTES]
                      : [H1_WINDOW_MINUTES, MATCH_WINDOW_MINUTES]
                  }
                  ticks={
                    viewMarket === MARKETS.h1
                      ? [0, 15, 30, 45, 60]
                      : [60, 75, 90, 105, 120]
                  }
                  allowDataOverflow
                  stroke="#94a3b8"
                  tickFormatter={(value) => formatMinute(Number(value))}
                />
                <YAxis stroke="#94a3b8" domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{
                    background: "#0b1220",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12,
                  }}
                  labelFormatter={(value) => `Elapsed ${formatMinute(Number(value))}`}
                />
                <Legend />
                {selectedLines.map((line, index) => (
                  <Line
                    key={line}
                    type="monotone"
                    dataKey={`O${line}`}
                    name={`Over ${line}`}
                    stroke={LINE_COLORS[index % LINE_COLORS.length]}
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {tableRows.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Minute</th>
                <th className="px-3 py-2 font-medium">Line</th>
                <th className="px-3 py-2 font-medium">Over</th>
                <th className="px-3 py-2 font-medium">Under</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr
                  key={`${row.timestamp}-${row.point}`}
                  className="border-t border-white/5 font-mono text-slate-200"
                >
                  <td className="px-3 py-1.5">{formatMinute(row.elapsedMinutes)}</td>
                  <td className="px-3 py-1.5">{row.point}</td>
                  <td className="px-3 py-1.5 text-emerald-300">{formatOdds(row.overPrice)}</td>
                  <td className="px-3 py-1.5 text-slate-400">{formatOdds(row.underPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
