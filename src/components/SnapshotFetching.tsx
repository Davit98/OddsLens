"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMinute } from "@/lib/format";
import { H1_WINDOW_MINUTES, walkSnapshotMinutes } from "@/lib/leagues";

function axisLabels(minutes: number[]): number[] {
  const min = minutes[0] ?? 0;
  const max = minutes[minutes.length - 1] ?? H1_WINDOW_MINUTES;
  const span = max - min;
  if (span <= 0) return [min];
  if (span === 45) return [min, min + 15, min + 30, max];
  if (span === 90) return [min, min + 45, max];
  return [min, Math.round((min + max) / 2), max];
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
}: {
  minutes: number[];
  activeIndex: number;
}) {
  const min = minutes[0] ?? 0;
  const max = minutes[minutes.length - 1] ?? H1_WINDOW_MINUTES;
  const span = Math.max(1, max - min);
  const current = minutes[activeIndex] ?? min;
  const playhead = ((current - min) / span) * 100;
  const labels = axisLabels(minutes);

  return (
    <div className="mt-3">
      <div className="relative h-7">
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
              key={`${minute}-${index}`}
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
        {labels.map((minute) => (
          <span key={minute}>{formatMinute(minute)}</span>
        ))}
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
  const minutes = useMemo(() => walkSnapshotMinutes(fetchH1, fetchH2), [fetchH1, fetchH2]);
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
      <Timeline minutes={minutes} activeIndex={tick} />
    </div>
  );
}
