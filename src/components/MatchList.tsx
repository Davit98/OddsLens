"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LEAGUES, LOOKBACK_OPTIONS, leagueTitle, type LeagueKey, type LookbackKey } from "@/lib/leagues";
import { formatKickoff, matchStatus } from "@/lib/format";
import type { Credits, LiveCandidate, MatchRecord } from "@/lib/types";
import { HistoryLoadingCard } from "./HistoryLoadingCard";
import { LiveCollector } from "./LiveCollector";
import { useCredits } from "./CreditsProvider";

type LeagueFilter = "all" | LeagueKey;

export function MatchList() {
  const { setCredits } = useCredits();
  const [league, setLeague] = useState<LeagueFilter>("all");
  const [lookback, setLookback] = useState<LookbackKey>("3");
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({});
  const [plannedIds, setPlannedIds] = useState<Set<string>>(new Set());
  const [planTick, setPlanTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(8);
  const [pendingDays, setPendingDays] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [scoresNote, setScoresNote] = useState<string | null>(null);

  const load = useCallback(async (nextLeague: LeagueFilter, nextLookback: LookbackKey) => {
    setLoading(true);
    setError(null);
    setProgress(8);
    setPendingDays(0);
    try {
      let pending = 0;
      if (nextLookback !== "3") {
        const previewResponse = await fetch(
          `/api/matches?league=${nextLeague}&lookback=${nextLookback}&preview=1`,
        );
        const preview = (await previewResponse.json()) as {
          estimatedHistoryCredits?: number;
        };
        pending = preview.estimatedHistoryCredits ?? 0;
        setPendingDays(pending);
      }

      const response = await fetch(
        `/api/matches?league=${nextLeague}&lookback=${nextLookback}`,
      );
      const data = (await response.json()) as {
        matches?: MatchRecord[];
        scoresFetched?: string[];
        historyDaysFetched?: number;
        estimatedHistoryCredits?: number;
        lookbackDays?: number;
        credits?: Credits;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load matches");
      }
      setProgress(100);
      setMatches(data.matches ?? []);
      if (data.credits) setCredits(data.credits);
      const notes: string[] = [];
      if (data.scoresFetched && data.scoresFetched.length > 0) {
        notes.push(
          `Last-3-day scores refreshed for ${data.scoresFetched.length} league${
            data.scoresFetched.length === 1 ? "" : "s"
          } (2 credits each, cached for today).`,
        );
      }
      if ((data.historyDaysFetched ?? 0) > 0) {
        notes.push(
          `Pulled ${data.historyDaysFetched} extra fixture-day snapshot${
            data.historyDaysFetched === 1 ? "" : "s"
          } (1 credit each, cached). Final scores are filled from ESPN for older matches.`,
        );
      } else if ((data.lookbackDays ?? 3) > 3) {
        notes.push(
          "Older fixtures loaded from cache. Final scores are backfilled from ESPN.",
        );
      } else {
        notes.push("Completed matches loaded from today's cache. Upcoming fixtures are free.");
      }
      setScoresNote(notes.join(" "));
      await new Promise((resolve) => setTimeout(resolve, 280));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load matches");
    } finally {
      setLoading(false);
    }
  }, [setCredits]);

  const onWatch = useCallback((rows: LiveCandidate[]) => {
    setLiveCounts(Object.fromEntries(rows.map((row) => [row.eventId, row.liveMinutes])));
    setPlannedIds(new Set(rows.map((row) => row.eventId)));
  }, []);

  const togglePlan = useCallback(async (eventId: string, planned: boolean) => {
    setPlannedIds((current) => {
      const next = new Set(current);
      if (planned) next.add(eventId);
      else next.delete(eventId);
      return next;
    });
    const response = await fetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: planned ? "add" : "remove", eventId }),
    });
    if (!response.ok) {
      setPlannedIds((current) => {
        const next = new Set(current);
        if (planned) next.delete(eventId);
        else next.add(eventId);
        return next;
      });
    }
    setPlanTick((value) => value + 1);
  }, []);

  useEffect(() => {
    void load(league, lookback);
  }, [league, lookback, load]);

  useEffect(() => {
    if (!loading) return;
    const duration = Math.max(pendingDays * 450, 1400);
    const started = Date.now();
    const timer = window.setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / duration);
      const eased = 1 - (1 - t) ** 3;
      setProgress((current) =>
        current >= 100 ? 100 : Math.min(92, 8 + eased * 84),
      );
    }, 80);
    return () => window.clearInterval(timer);
  }, [loading, pendingDays]);

  const grouped = useMemo(() => {
    const byLeague = new Map<string, MatchRecord[]>();
    for (const match of matches) {
      const list = byLeague.get(match.sportKey) ?? [];
      list.push(match);
      byLeague.set(match.sportKey, list);
    }

    const rank = (match: MatchRecord) => {
      const status = matchStatus(match.commenceTime, match.completed);
      if (status === "live") return 0;
      if (status === "ft") return 1;
      return 2;
    };

    return LEAGUES.filter((item) => byLeague.has(item.key)).map((item) => ({
      ...item,
      matches: [...(byLeague.get(item.key) ?? [])].sort((a, b) => {
        const rankDiff = rank(a) - rank(b);
        if (rankDiff !== 0) return rankDiff;
        return Date.parse(b.commenceTime) - Date.parse(a.commenceTime);
      }),
    }));
  }, [matches]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            European half totals
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            On-demand historical Over lines for 1st and 2nd half alternate totals.
            Snapshots are stored locally so a match is only billed once per bookmaker.
          </p>
        </div>
        <p className="max-w-sm text-xs leading-5 text-slate-500">{scoresNote}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterChip
          active={league === "all"}
          onClick={() => setLeague("all")}
          label="All leagues"
        />
        {LEAGUES.map((item) => (
          <FilterChip
            key={item.key}
            active={league === item.key}
            onClick={() => setLeague(item.key)}
            label={item.short}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-[0.16em] text-slate-500">
          Go back
        </span>
        {LOOKBACK_OPTIONS.map((item) => (
          <FilterChip
            key={item.key}
            active={lookback === item.key}
            onClick={() => setLookback(item.key)}
            label={item.label}
          />
        ))}
      </div>

      <LiveCollector refreshToken={planTick} onWatch={onWatch} />

      {loading ? (
        <HistoryLoadingCard
          extraHistory={lookback !== "3"}
          pendingDays={pendingDays}
          progress={progress}
        />
      ) : error ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-6 text-sm text-rose-100">
          {error}
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-10 text-center text-slate-400">
          No recent fixtures found.
        </div>
      ) : (
        grouped.map((group) => (
          <section key={group.key} className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                {group.title}
              </h2>
              <span className="text-xs text-slate-500">{group.country}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {group.matches.map((match) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  liveMinutes={liveCounts[match.id] ?? match.liveMinutes}
                  planned={plannedIds.has(match.id)}
                  onTogglePlan={(next) => void togglePlan(match.id, next)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm transition ${
        active
          ? "bg-emerald-400 text-slate-950"
          : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );
}

function MatchCard({
  match,
  liveMinutes,
  planned,
  onTogglePlan,
}: {
  match: MatchRecord;
  liveMinutes: number;
  planned: boolean;
  onTogglePlan: (planned: boolean) => void;
}) {
  const status = matchStatus(match.commenceTime, match.completed);
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5 p-4 transition hover:border-emerald-400/40">
      <Link href={`/matches/${match.id}`} className="group block">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
            {leagueTitle(match.sportKey)}
          </p>
          <p className="mt-2 text-base font-medium text-white">
            {match.homeTeam}{" "}
            <span className="text-slate-500">vs</span> {match.awayTeam}
          </p>
          <p className="mt-1 text-sm text-slate-400">{formatKickoff(match.commenceTime)}</p>
        </div>
        <div className="text-right">
          <StatusBadge status={status} />
          {match.homeScore !== null && match.awayScore !== null ? (
            <p className="mt-2 font-mono text-lg text-white">
              {match.homeScore}–{match.awayScore}
            </p>
          ) : null}
        </div>
      </div>
      </Link>
      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>
          {match.cachedSnapshots > 0
            ? `${match.cachedSnapshots} historical`
            : "No historical cache"}
          {liveMinutes > 0 ? ` · ${liveMinutes} live min` : ""}
        </span>
        <span className="flex items-center gap-2">
          {status !== "ft" || planned ? (
            <button
              type="button"
              onClick={() => onTogglePlan(!planned)}
              className={`rounded-full px-2 py-0.5 ${
                planned
                  ? "bg-amber-300/20 text-amber-200"
                  : "border border-white/10 text-slate-300 hover:bg-white/10"
              }`}
            >
              {planned ? "Planned" : "Plan live"}
            </button>
          ) : null}
          {match.cachedBookmakers.length > 0 ? (
            <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-emerald-300">
              Historical
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ReturnType<typeof matchStatus> }) {
  const styles = {
    upcoming: "bg-sky-400/15 text-sky-300",
    live: "bg-amber-400/15 text-amber-300",
    ft: "bg-white/10 text-slate-300",
  };
  const labels = { upcoming: "Upcoming", live: "Live", ft: "FT" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
