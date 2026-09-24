"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { LeagueKey, LookbackKey } from "@/lib/leagues";

export type LeagueFilter = "all" | LeagueKey;

type BrowseFiltersValue = {
  league: LeagueFilter;
  lookback: LookbackKey;
  setLeague: (league: LeagueFilter) => void;
  setLookback: (lookback: LookbackKey) => void;
};

const BrowseFiltersContext = createContext<BrowseFiltersValue | null>(null);

export function BrowseFiltersProvider({ children }: { children: React.ReactNode }) {
  const [league, setLeague] = useState<LeagueFilter>("all");
  const [lookback, setLookback] = useState<LookbackKey>("3");
  const value = useMemo(
    () => ({ league, lookback, setLeague, setLookback }),
    [league, lookback],
  );

  return (
    <BrowseFiltersContext.Provider value={value}>{children}</BrowseFiltersContext.Provider>
  );
}

export function useBrowseFilters(): BrowseFiltersValue {
  const value = useContext(BrowseFiltersContext);
  if (!value) {
    throw new Error("useBrowseFilters must be used within BrowseFiltersProvider");
  }
  return value;
}
