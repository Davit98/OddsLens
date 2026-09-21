"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMinute } from "@/lib/format";
import {
  H1_WINDOW_MINUTES,
  MATCH_WINDOW_MINUTES,
  SNAPSHOT_INTERVAL_MINUTES,
} from "@/lib/leagues";

function walkMinutes(fetchH1: boolean, fetchH2: boolean): number[] {
  const start = fetchH1 ? 0 : H1_WINDOW_MINUTES;
  const end = fetchH2 ? MATCH_WINDOW_MINUTES : H1_WINDOW_MINUTES;
  const minutes: number[] = [];
  for (let minute = start; minute < end; minute += SNAPSHOT_INTERVAL_MINUTES) {
    minutes.push(minute);
  }
  return minutes.length > 0 ? minutes : [0];
}

function useWalkClock(active: boolean, length: number) {
  const [tick, setTick] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active) {
      setTick(0);
      setElapsedMs(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => {
      const ms = Date.now() - started;
      setElapsedMs(ms);
      setTick(Math.floor(ms / 1100) % Math.max(1, length));
    }, 100);
    return () => window.clearInterval(id);
  }, [active, length]);

  return { tick, elapsedMs };
}

function Timeline({
  minutes,
  activeIndex,
  compact = false,
}: {
  minutes: number[];
  activeIndex: number;
  compact?: boolean;
}) {
  const min = minutes[0] ?? 0;
  const max = minutes[minutes.length - 1] ?? H1_WINDOW_MINUTES;
  const span = Math.max(1, max - min);
  const current = minutes[activeIndex] ?? min;
  const playhead = ((current - min) / span) * 100;

  return (
    <div className={compact ? "mt-3" : "mt-6"}>
      <div className={`relative ${compact ? "h-7" : "h-10"}`}>
        <div className="absolute top-1/2 right-0 left-0 h-px bg-white/10" />
        <div
          className="absolute top-1/2 left-0 h-px bg-gradient-to-r from-emerald-400/80 to-sky-400/40 transition-[width] duration-700 ease-out"
          style={{ width: `${playhead}%` }}
        />
        {minutes.map((minute, index) => {
          const left = ((minute - min) / span) * 100;
          const on = index === activeIndex;
          const passed = index < activeIndex;
          return (
            <span
              key={minute}
              className={`absolute top-1/2 rounded-full transition-all duration-300 ${
                on
                  ? "h-2.5 w-2.5 bg-emerald-300 shadow-[0_0_12px_#34d399]"
                  : passed
                    ? "h-1.5 w-1.5 bg-emerald-400/80"
                    : "h-1.5 w-1.5 bg-slate-600"
              }`}
              style={{ left: `${left}%`, transform: "translate(-50%, -50%)" }}
            />
          );
        })}
        <span
          className="absolute top-0 h-full w-px bg-emerald-200 shadow-[0_0_12px_#34d399] transition-[left] duration-700 ease-out"
          style={{ left: `${playhead}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] tracking-wide text-slate-500">
        <span>{formatMinute(min)}</span>
        <span>{formatMinute(Math.round((min + max) / 2))}</span>
        <span>{formatMinute(max)}</span>
      </div>
    </div>
  );
}

export function SnapshotFetchingBanner({
  fetchH1,
  fetchH2,
  remaining,
}: {
  fetchH1: boolean;
  fetchH2: boolean;
  remaining: number;
}) {
  const minutes = useMemo(() => walkMinutes(fetchH1, fetchH2), [fetchH1, fetchH2]);
  const { tick, elapsedMs } = useWalkClock(true, minutes.length);
  const current = minutes[tick] ?? 0;
  const seconds = Math.max(1, Math.round(elapsedMs / 1000));

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-400/25 bg-gradient-to-r from-emerald-400/10 via-sky-400/5 to-white/5 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-white">
            Walking 5-minute snapshots
            <span className="inline-flex gap-0.5" aria-hidden>
              <span className="history-dot h-1 w-1 rounded-full bg-emerald-300" />
              <span className="history-dot h-1 w-1 rounded-full bg-emerald-300" />
              <span className="history-dot h-1 w-1 rounded-full bg-emerald-300" />
            </span>
          </p>
          <p className="mt-1 text-sm text-slate-400" aria-live="polite">
            Checking {formatMinute(current)} · {remaining}{" "}
            {remaining === 1 ? "snapshot" : "snapshots"} in this window
          </p>
        </div>
        <p className="shrink-0 font-mono text-xs text-emerald-300/80">{seconds}s</p>
      </div>
      <Timeline minutes={minutes} activeIndex={tick} compact />
    </div>
  );
}

export function SnapshotFetchingStage({
  fetchH1,
  fetchH2,
}: {
  fetchH1: boolean;
  fetchH2: boolean;
}) {
  const minutes = useMemo(() => walkMinutes(fetchH1, fetchH2), [fetchH1, fetchH2]);
  const { tick } = useWalkClock(true, minutes.length);
  const current = minutes[tick] ?? 0;

  return (
    <div className="relative overflow-hidden py-6">
      <div className="fetch-radar pointer-events-none absolute inset-y-4 w-1/3 bg-gradient-to-r from-transparent via-emerald-300/10 to-transparent" />
      <div className="relative mx-auto max-w-2xl text-center">
        <p className="fetch-float text-xs uppercase tracking-[0.22em] text-emerald-300/80">
          Snapshot clock
        </p>
        <p className="mt-2 font-mono text-4xl font-semibold text-white" aria-live="polite">
          {formatMinute(current)}
        </p>
        <p className="mt-1 text-sm text-slate-400">
          Requesting historical half totals at ~5 minute resolution
        </p>
      </div>
      <svg
        viewBox="0 0 120 42"
        className="mx-auto mt-6 h-28 w-full max-w-3xl text-emerald-300"
        aria-hidden
      >
        <polyline
          className="fetch-draw"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          points="0,28 10,26 20,27 30,18 40,20 50,14 60,16 70,11 80,15 90,13 100,17 110,12 120,14"
        />
        <polyline
          className="fetch-draw fetch-draw-delay"
          fill="none"
          stroke="#38bdf8"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.8"
          points="0,32 10,31 20,30 30,29 40,27 50,24 60,25 70,22 80,23 90,21 100,22 110,20 120,21"
        />
        <polyline
          fill="none"
          stroke="rgba(251,191,36,0.7)"
          strokeWidth="1.1"
          strokeLinecap="round"
          className="fetch-draw"
          style={{ animationDelay: "0.9s" }}
          points="0,22 10,21 20,19 30,21 40,16 50,17 60,12 70,14 80,10 90,12 100,9 110,11 120,8"
        />
      </svg>
      <Timeline minutes={minutes} activeIndex={tick} />
    </div>
  );
}
