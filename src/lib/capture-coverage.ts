import { MARKETS, liveClockFromKey } from "./leagues";
import type { CaptureCoverage } from "./types";

const H1_START = 0;
const H1_END = 45;
const H2_START = 46;
const H2_END = 90;

export type CaptureMinute = {
  market: string;
  elapsedMinute: number;
};

/**
 * A capture is partial when a regulation minute is missing.
 * 1st half chart must contain 0'–45'. Match totals must contain 46'–90'.
 * The 2nd half chart is ignored. Stoppage minutes are not required.
 * In-progress matches are checked only through the latest minute already saved.
 */
export function captureCoverage(minutes: CaptureMinute[], completed: boolean): CaptureCoverage {
  const h1 = new Set<number>();
  const full = new Set<number>();
  let h1ReachedEnd = false;
  let fullReachedEnd = false;

  for (const row of minutes) {
    const clock = liveClockFromKey(row.elapsedMinute);
    if (!clock) continue;
    if (row.market === MARKETS.h1 && clock.period === 1) {
      if (clock.added > 0) h1ReachedEnd = true;
      else if (clock.minute >= H1_START && clock.minute <= H1_END) h1.add(clock.minute);
    } else if (row.market === MARKETS.full && clock.period === 2) {
      if (clock.added > 0) fullReachedEnd = true;
      else if (clock.minute >= H2_START && clock.minute <= H2_END) full.add(clock.minute);
    }
  }

  const hasCapture = h1.size > 0 || h1ReachedEnd || full.size > 0 || fullReachedEnd;
  if (!hasCapture) return { partial: false, missingLabel: null };

  const h1End = completed ? H1_END : playedThrough(h1, h1ReachedEnd, H1_START, H1_END);
  const fullEnd = completed ? H2_END : playedThrough(full, fullReachedEnd, H2_START, H2_END);
  const missing: number[] = [];
  if (h1End !== null) missing.push(...missingInRange(h1, H1_START, h1End));
  if (fullEnd !== null) missing.push(...missingInRange(full, H2_START, fullEnd));

  if (missing.length === 0) return { partial: false, missingLabel: null };
  return { partial: true, missingLabel: formatMissing(missing) };
}

function playedThrough(
  present: Set<number>,
  reachedEnd: boolean,
  start: number,
  end: number,
): number | null {
  if (reachedEnd) return end;
  let latest: number | null = null;
  for (const minute of present) {
    if (minute < start || minute > end) continue;
    if (latest === null || minute > latest) latest = minute;
  }
  return latest;
}

function missingInRange(present: Set<number>, start: number, end: number): number[] {
  const missing: number[] = [];
  for (let minute = start; minute <= end; minute += 1) {
    if (!present.has(minute)) missing.push(minute);
  }
  return missing;
}

function formatMissing(minutes: number[]): string {
  const ranges: Array<[number, number]> = [];
  for (const minute of minutes) {
    const last = ranges[ranges.length - 1];
    if (last && minute === last[1] + 1) last[1] = minute;
    else ranges.push([minute, minute]);
  }
  if (ranges.length > 3) return `${minutes.length} min missing`;
  return ranges
    .map(([start, end]) => (start === end ? `${start}'` : `${start}'–${end}'`))
    .join(", ");
}
