"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatKickoff, formatScore, matchStatus } from "@/lib/format";
import { BOOKMAKERS, leagueTitle } from "@/lib/leagues";
import type { CapturedLiveMatch } from "@/lib/types";
import type { LeagueFilter } from "./BrowseFilters";

function bookmakerTitle(key: string): string {
  return BOOKMAKERS.find((item) => item.key === key)?.title ?? key;
}

function formatAgo(iso: string): string {
  const delta = Date.now() - Date.parse(iso);
  if (!Number.isFinite(delta) || delta < 45_000) return "just now";
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function clockOf(match: CapturedLiveMatch): string | null {
  if (match.displayClock) return match.displayClock;
  if (match.elapsedMinute !== null) return `${match.elapsedMinute}'`;
  return null;
}

export function CapturedMatches({ league = "all" }: { league?: LeagueFilter }) {
  const [matches, setMatches] = useState<CapturedLiveMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (window.location.hash === "#captured-live") setOpen(true);
    function onHash() {
      if (window.location.hash === "#captured-live") setOpen(true);
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch("/api/live/captured", { cache: "no-store" });
        const data = (await response.json()) as {
          matches?: CapturedLiveMatch[];
          error?: string;
        };
        if (!active) return;
        if (!response.ok) throw new Error(data.error ?? "Failed to load captured matches");
        setMatches(data.matches ?? []);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load captured matches");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const visible = useMemo(() => {
    const filtered =
      league === "all" ? matches : matches.filter((match) => match.sportKey === league);
    return [...filtered].sort((a, b) => {
      const aLive = matchStatus(a.commenceTime, a.completed) === "live" ? 0 : 1;
      const bLive = matchStatus(b.commenceTime, b.completed) === "live" ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      return Date.parse(b.lastCapturedAt) - Date.parse(a.lastCapturedAt);
    });
  }, [league, matches]);

  const countLabel = loading
    ? "Loading"
    : `${visible.length} match${visible.length === 1 ? "" : "es"}`;

  return (
    <section id="captured-live" className="scroll-mt-20 rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="captured-live-list"
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
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Captured live
            </h2>
            {open ? null : (
              <span className="mt-0.5 block text-xs font-normal normal-case tracking-normal text-slate-500">
                {countLabel}
              </span>
            )}
          </span>
        </button>
        {open ? (
          <span className="shrink-0 text-xs text-slate-500">{countLabel}</span>
        ) : null}
      </div>

      {open ? (
        <div id="captured-live-list">
          <p className="mt-3 text-sm text-slate-400">
            Every match with minute-by-minute odds already saved. Open one to see the charts.
          </p>

          {error ? <p className="mt-3 text-sm text-rose-200">{error}</p> : null}

          {loading ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="h-28 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
              <div className="h-28 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
            </div>
          ) : visible.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-white/10 bg-slate-950/40 px-4 py-6 text-sm text-slate-500">
              {matches.length === 0
                ? "No live minutes saved yet. Plan a match in the collector and start it."
                : "No captured matches in this league."}
            </p>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {visible.map((match) => (
                <CapturedCard key={match.id} match={match} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function CapturedCard({ match }: { match: CapturedLiveMatch }) {
  const status = matchStatus(match.commenceTime, match.completed);
  const score = formatScore(match.homeScore, match.awayScore);
  const clock = clockOf(match);
  const books = match.bookmakers.map(bookmakerTitle);
  const capturing = match.planned && status !== "ft";

  return (
    <Link
      href={`/matches/${match.id}`}
      className="group block rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-400/10 via-white/5 to-white/5 p-4 transition hover:border-emerald-400/50 hover:from-emerald-400/15"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
            {leagueTitle(match.sportKey)}
          </p>
          <p className="mt-2 truncate text-base font-medium text-white">
            {match.homeTeam}{" "}
            <span className="text-slate-500">vs</span> {match.awayTeam}
          </p>
          <p className="mt-1 text-sm text-slate-400">{formatKickoff(match.commenceTime)}</p>
        </div>
        <div className="text-right">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              status === "live"
                ? "bg-amber-400/15 text-amber-300"
                : status === "upcoming"
                  ? "bg-sky-400/15 text-sky-300"
                  : "bg-white/10 text-slate-300"
            }`}
          >
            {status === "live" ? "Live" : status === "upcoming" ? "Upcoming" : "FT"}
          </span>
          {score ? (
            <p className="mt-2 font-mono text-lg text-white">{score}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span className="min-w-0 truncate">
          <span className="font-medium text-amber-200">{clock ?? "Clock pending"}</span>
          <span>
            {" "}
            · {match.liveMinutes} live min
            {books.length > 0 ? ` · ${books.join(", ")}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {capturing ? (
            <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-emerald-300">
              Capturing
            </span>
          ) : (
            <span>Saved {formatAgo(match.lastCapturedAt)}</span>
          )}
          <span
            aria-hidden="true"
            className="text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-emerald-300"
          >
            →
          </span>
        </span>
      </div>
    </Link>
  );
}
