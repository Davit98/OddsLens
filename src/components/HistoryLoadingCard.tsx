"use client";

export function HistoryLoadingCard({
  extraHistory,
  pendingDays,
  progress,
}: {
  extraHistory: boolean;
  pendingDays: number;
  progress: number;
}) {
  const determinate = extraHistory && pendingDays > 0;
  const width = `${Math.min(100, Math.max(6, progress))}%`;

  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/10 via-white/5 to-white/5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-white">
            {extraHistory ? "Loading extra history" : "Loading fixtures"}
            <span className="inline-flex gap-0.5" aria-hidden>
              <span className="history-dot h-1 w-1 rounded-full bg-emerald-300" />
              <span className="history-dot h-1 w-1 rounded-full bg-emerald-300" />
              <span className="history-dot h-1 w-1 rounded-full bg-emerald-300" />
            </span>
          </p>
          <p className="mt-1 max-w-xl text-sm leading-6 text-slate-400">
            {extraHistory
              ? pendingDays > 0
                ? `Fetching ${pendingDays} uncached fixture-day snapshot${
                    pendingDays === 1 ? "" : "s"
                  }. Week and longer use 1 credit per league per uncached day.`
                : "Checking cached fixture days. Week and longer use 1 credit per league per uncached day."
              : "Refreshing upcoming fixtures and the last 3 days of scores."}
          </p>
        </div>
        <p className="shrink-0 font-mono text-lg text-emerald-300">
          {determinate ? `${Math.round(progress)}%` : ""}
        </p>
      </div>

      <div
        className="relative mt-5 h-2 overflow-hidden rounded-full bg-slate-950/70 ring-1 ring-white/10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? Math.round(progress) : undefined}
        aria-label={extraHistory ? "Loading extra history" : "Loading fixtures"}
      >
        {determinate ? (
          <div
            className="history-pulse relative h-full overflow-hidden rounded-full bg-gradient-to-r from-emerald-500 to-sky-400 transition-[width] duration-200 ease-out"
            style={{ width }}
          >
            <span className="history-shimmer absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/50 to-transparent" />
          </div>
        ) : (
          <div className="history-indeterminate absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-to-r from-emerald-500 via-sky-400 to-emerald-400" />
        )}
      </div>

      {determinate ? (
        <p className="mt-3 text-xs text-slate-500">
          About {pendingDays} credit{pendingDays === 1 ? "" : "s"} this time. Later visits reuse the local cache.
        </p>
      ) : extraHistory ? (
        <p className="mt-3 text-xs text-slate-500">
          Uncached days are billed once, then stored locally.
        </p>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-xl border border-white/10 bg-white/5"
            style={{ animationDelay: `${index * 90}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
