"use client";

import Link from "next/link";
import { useCredits } from "./CreditsProvider";

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

export function Header() {
  const { credits } = useCredits();
  const remaining = credits?.remaining;

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#081018]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/15 ring-1 ring-emerald-400/40">
            <span className="h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-wide text-white">
              OddsLens
            </span>
            <span className="block text-[11px] uppercase tracking-[0.18em] text-slate-400">
              Half totals
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-3 text-sm">
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
            <span className="text-slate-400">Credits left </span>
            <span
              className={`font-mono font-semibold ${
                remaining !== null && remaining < 500
                  ? "text-amber-300"
                  : "text-emerald-300"
              }`}
            >
              {formatNumber(remaining)}
            </span>
          </div>
          <div className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1.5 sm:block">
            <span className="text-slate-400">Used </span>
            <span className="font-mono text-slate-200">
              {formatNumber(credits?.used)}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
