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

/** Soonest kickoff first. Finished matches stay after games that are still upcoming or live. */
export function compareMatchesSoonestFirst(
  a: { commenceTime: string; completed: boolean },
  b: { commenceTime: string; completed: boolean },
): number {
  const aFinished = matchStatus(a.commenceTime, a.completed) === "ft";
  const bFinished = matchStatus(b.commenceTime, b.completed) === "ft";
  if (aFinished !== bFinished) return aFinished ? 1 : -1;
  const aTime = Date.parse(a.commenceTime);
  const bTime = Date.parse(b.commenceTime);
  return aFinished ? bTime - aTime : aTime - bTime;
}

function soonestOpenKickoff(matches: { commenceTime: string; completed: boolean }[]): number | null {
  let soonest: number | null = null;
  for (const match of matches) {
    if (matchStatus(match.commenceTime, match.completed) === "ft") continue;
    const time = Date.parse(match.commenceTime);
    if (!Number.isFinite(time)) continue;
    if (soonest === null || time < soonest) soonest = time;
  }
  return soonest;
}

/** League groups with the next kickoff come first. Groups with only finished matches stay last. */
export function compareGroupsSoonestFirst(
  a: { commenceTime: string; completed: boolean }[],
  b: { commenceTime: string; completed: boolean }[],
): number {
  const aTime = soonestOpenKickoff(a);
  const bTime = soonestOpenKickoff(b);
  if (aTime === null && bTime === null) return 0;
  if (aTime === null) return 1;
  if (bTime === null) return -1;
  return aTime - bTime;
}
