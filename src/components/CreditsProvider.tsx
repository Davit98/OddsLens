"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Credits } from "@/lib/types";

type CreditsContextValue = {
  credits: Credits | null;
  setCredits: (credits: Credits) => void;
  refreshCredits: () => Promise<void>;
};

const CreditsContext = createContext<CreditsContextValue | null>(null);

export function CreditsProvider({ children }: { children: React.ReactNode }) {
  const [credits, setCredits] = useState<Credits | null>(null);

  const refreshCredits = useCallback(async () => {
    const response = await fetch("/api/credits");
    const data = (await response.json()) as { credits?: Credits };
    if (data.credits) setCredits(data.credits);
  }, []);

  useEffect(() => {
    void refreshCredits();
  }, [refreshCredits]);

  const value = useMemo(
    () => ({ credits, setCredits, refreshCredits }),
    [credits, refreshCredits],
  );

  return (
    <CreditsContext.Provider value={value}>{children}</CreditsContext.Provider>
  );
}

export function useCredits(): CreditsContextValue {
  const ctx = useContext(CreditsContext);
  if (!ctx) {
    throw new Error("useCredits must be used within CreditsProvider");
  }
  return ctx;
}
