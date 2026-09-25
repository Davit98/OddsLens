"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCredits } from "./CreditsProvider";
import { formatKickoff, formatScore, matchStatus } from "@/lib/format";
import { BOOKMAKERS, DEFAULT_BOOKMAKER, LEAGUES, leagueTitle } from "@/lib/leagues";
import type { Credits, LiveCandidate, LiveFeedRow, LiveJob } from "@/lib/types";
import type { LeagueFilter } from "./BrowseFilters";

type LiveStatus = {
  job: LiveJob | null;
  candidates: LiveCandidate[];
  feed: LiveFeedRow[];
  credits?: Credits;
  error?: string;
};

function marketLabel(market: string): string {
  if (market === "alternate_totals") return "Match";
  if (market.endsWith("_h1")) return "H1";
  if (market.endsWith("_h2")) return "H2";
  return market;
}

function lineSummary(row: LiveFeedRow): string {
  if (!row.available || row.lines.length === 0) return "suspended";
  const shown = row.lines.slice(0, 4).map((line) => `${line.point} ${line.overPrice?.toFixed(2) ?? "—"}`);
  const extra = row.lines.length > 4 ? ` +${row.lines.length - 4}` : "";
  return `${shown.join(" · ")}${extra}`;
}

function clockOf(match: LiveCandidate): string {
  if (match.displayClock) return match.displayClock;
  const status = matchStatus(match.commenceTime, match.completed);
  if (status === "upcoming") return "Upcoming";
  if (status === "live") return "Live";
  return "FT";
}

export function LiveCollector({
  refreshToken = 0,
  onWatch,
  league = "all",
}: {
  refreshToken?: number;
  onWatch?: (matches: LiveCandidate[]) => void;
  league?: LeagueFilter;
}) {
  const { setCredits } = useCredits();
  const [bookmaker, setBookmaker] = useState(DEFAULT_BOOKMAKER);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState(true);
  const seenRows = useRef<Set<number> | null>(null);

  const apply = useCallback(
    (next: LiveStatus) => {
      setStatus(next);
      onWatch?.((next.candidates ?? []).filter((match) => match.planned));
      if (next.credits) setCredits(next.credits);
      if (next.job?.status === "running") setBookmaker(next.job.bookmaker);
    },
    [onWatch, setCredits],
  );

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/live");
      const data = (await response.json()) as LiveStatus;
      if (!response.ok) throw new Error(data.error ?? "Failed to load live collector");
      apply(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load live collector");
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!status) return;
    const ids = status.feed.map((row) => row.id);
    if (seenRows.current === null) {
      seenRows.current = new Set(ids);
      return;
    }
    const arrived = ids.filter((id) => !seenRows.current?.has(id));
    if (arrived.length === 0) return;
    for (const id of arrived) seenRows.current.add(id);
    setFreshIds(new Set(arrived));
    const timer = window.setTimeout(() => setFreshIds(new Set()), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function submit(action: "start" | "stop") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, bookmaker }),
      });
      const data = (await response.json()) as LiveStatus;
      if (!response.ok) throw new Error(data.error ?? "Live collector failed");
      apply(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live collector failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(match: LiveCandidate) {
    setPendingId(match.eventId);
    setError(null);
    try {
      const response = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: match.planned ? "remove" : "add",
          eventId: match.eventId,
        }),
      });
      const data = (await response.json()) as LiveStatus;
      if (!response.ok) throw new Error(data.error ?? "Could not update the plan");
      apply(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the plan");
    } finally {
      setPendingId(null);
    }
  }

  const job = status?.job ?? null;
  const running = job?.status === "running";
  const candidates = status?.candidates ?? [];
  const visible = candidates.filter((match) => league === "all" || match.sportKey === league);
  const feed = status?.feed ?? [];
  const planned = candidates.filter((match) => match.planned);
  const groups = LEAGUES.filter((item) => league === "all" || item.key === league)
    .map((item) => ({
      ...item,
      matches: visible.filter((match) => match.sportKey === item.key),
    }))
    .filter((group) => group.matches.length > 0);

  const collapsedStatus = job
    ? `${running ? "Running" : "Stopped"} · ${planned.length} selected`
    : "Not started";

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="live-minute-capture"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-2 text-left"
        >
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
          >
            <path
              fill="currentColor"
              d="M7.2 4.5a1 1 0 0 1 1.4 0l5 5.2a1 1 0 0 1 0 1.4l-5 5.2a1 1 0 0 1-1.4-1.4L11.4 10 7.2 5.9a1 1 0 0 1 0-1.4Z"
            />
          </svg>
          <span>
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
              Live minute capture
            </h2>
            {open ? null : (
              <span className="mt-0.5 block text-xs font-normal normal-case tracking-normal text-slate-500">
                {collapsedStatus}
              </span>
            )}
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={bookmaker}
            disabled={running || busy}
            onChange={(event) => setBookmaker(event.target.value)}
            className="rounded-full border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-60"
          >
            {BOOKMAKERS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.title}
              </option>
            ))}
          </select>
          {running ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit("stop")}
              className="rounded-full bg-rose-400 px-3 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-60"
            >
              {busy ? "Stopping…" : "Stop"}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit("start")}
              className="rounded-full bg-emerald-400 px-3 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-60"
            >
              {busy ? "Starting…" : "Start"}
            </button>
          )}
        </div>
      </div>

      {open ? (
        <div id="live-minute-capture">
          <p className="mt-3 max-w-2xl text-sm text-slate-400">
            Pick matches from any competition. Once the collector is running, each selected
            game is saved for every match minute from kickoff. The first check spends 1 credit to see
            which half totals that book is offering, and only those markets are polled. A
            missing line is saved as suspended and checked again next minute. Leave the server
            running; closing this tab does not stop it.
          </p>

      {job ? (
        <p className="mt-3 text-xs text-slate-500">
          {running ? "Running" : "Stopped"} · {job.bookmaker} · {planned.length} selected ·{" "}
          {job.creditsSpent} job credits
          {job.lastTickAt ? ` · last tick ${formatKickoff(job.lastTickAt)}` : ""}
        </p>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Not started. Select matches, then start.</p>
      )}

      {error ? <p className="mt-2 text-sm text-rose-200">{error}</p> : null}
      {job?.lastError ? <p className="mt-2 text-sm text-rose-200">{job.lastError}</p> : null}
      {running && planned.length === 0 ? (
        <p className="mt-2 text-sm text-amber-200">
          No matches are selected, so the collector is idle. Check the games you want before kickoff.
        </p>
      ) : null}

      <div className="mt-4 space-y-4">
        {groups.length === 0 ? (
          <p className="text-sm text-slate-500">No upcoming or live matches loaded yet.</p>
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                {group.title}
              </h3>
              <ul className="mt-2 space-y-1">
                {group.matches.map((match) => {
                  const score = formatScore(match.homeScore, match.awayScore);
                  return (
                    <li key={match.eventId}>
                      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
                        <span className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={match.planned}
                            disabled={pendingId === match.eventId}
                            onChange={() => void toggle(match)}
                          />
                          <span>
                            <span className="block text-sm text-white">
                              {match.homeTeam} <span className="text-slate-500">vs</span>{" "}
                              {match.awayTeam}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {formatKickoff(match.commenceTime)}
                            </span>
                          </span>
                        </span>
                        <span className="text-right text-xs text-slate-400">
                          <span className="block font-medium text-amber-200">
                            {clockOf(match)}
                            {score ? ` · ${score}` : ""}
                          </span>
                          <span className="block">
                            {match.liveMinutes > 0 ? `${match.liveMinutes} live min` : "Not started"}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Collected rows
        </h3>
        {feed.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            Rows appear here as soon as a planned match is live and a new minute is saved.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-xl border border-white/10">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Saved</th>
                  <th className="px-3 py-2 font-medium">Match</th>
                  <th className="px-3 py-2 font-medium">Minute</th>
                  <th className="px-3 py-2 font-medium">Market</th>
                  <th className="px-3 py-2 font-medium">Over lines</th>
                </tr>
              </thead>
              <tbody>
                {feed.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-t border-white/5 ${
                      freshIds.has(row.id) ? "bg-amber-300/15" : ""
                    }`}
                  >
                    <td className="px-3 py-1.5 text-xs text-slate-400">
                      {formatKickoff(row.capturedAt)}
                    </td>
                    <td className="px-3 py-1.5 text-slate-200">
                      {row.homeTeam} vs {row.awayTeam}
                      <span className="ml-2 text-xs text-slate-500">{leagueTitle(row.sportKey)}</span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-amber-200">
                      {row.displayClock ?? `${row.elapsedMinute}'`}
                    </td>
                    <td className="px-3 py-1.5 text-slate-300">{marketLabel(row.market)}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-emerald-300">
                      {lineSummary(row)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </div>
      ) : null}
    </section>
  );
}
