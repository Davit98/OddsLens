export function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatMinute(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  return `${rounded}'`;
}

export function formatOdds(value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(2);
}

export function formatScore(home: number | null, away: number | null): string | null {
  if (home === null || away === null) return null;
  return `${home}–${away}`;
}

export function matchStatus(commenceTime: string, completed: boolean): "upcoming" | "live" | "ft" {
  if (completed) return "ft";
  const start = Date.parse(commenceTime);
  const now = Date.now();
  if (now < start) return "upcoming";
  if (now < start + 150 * 60_000) return "live";
  return "ft";
}
