import { formatMinute } from "./format";
import {
  MARKETS,
  chartMinuteFor,
  formatChartMinute,
  liveChartAxis,
  liveClockFromParts,
  marketWindow,
  parseClockDisplay,
  type LiveClock,
  type MarketKey,
} from "./leagues";
import type { GoalEvent, HalfEnds, OddsPoint } from "./types";

export type OddsSheet = {
  name: string;
  rows: Array<Array<string | number | null>>;
};

export type OddsSeriesPoint = OddsPoint & { market: string };

type OddsSource = "historical" | "live";

type LinePrices = { overPrice: number | null; underPrice: number | null };

type MarketSnapshot = {
  timestamp: string;
  elapsedMinutes: number;
  chartMinute: number;
  clockLabel: string;
  liveClock?: LiveClock;
  prices: Map<number, LinePrices>;
};

const EXPORT_SHEETS: Array<{ market: MarketKey; name: string; liveOnly: boolean }> = [
  { market: MARKETS.h1, name: "1st half chart", liveOnly: false },
  { market: MARKETS.h2, name: "2nd half chart", liveOnly: false },
  { market: MARKETS.full, name: "Match totals", liveOnly: true },
];

export function buildOddsWorkbookSheets(input: {
  series: OddsSeriesPoint[];
  source: OddsSource;
  halfEnds: HalfEnds;
  goals: GoalEvent[];
}): OddsSheet[] {
  const sheets = EXPORT_SHEETS.flatMap((sheet) => {
    if (sheet.liveOnly && input.source !== "live") return [];
    const built = oddsSheet(
      input.series,
      sheet.market,
      input.source,
      input.halfEnds,
      input.goals,
      sheet.name,
    );
    return built ? [built] : [];
  });
  if (sheets.length === 0) return [];
  sheets.push(goalsSheet(input.goals));
  return sheets;
}

export async function downloadOddsWorkbook(sheets: OddsSheet[], filename: string) {
  const XLSX = await import("xlsx");
  const workbook = workbookFromSheets(XLSX, sheets);
  XLSX.writeFile(workbook, filename);
}

export async function oddsWorkbookBuffer(sheets: OddsSheet[]): Promise<Buffer> {
  const XLSX = await import("xlsx");
  const workbook = workbookFromSheets(XLSX, sheets);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function workbookFromSheets(
  XLSX: typeof import("xlsx"),
  sheets: OddsSheet[],
): import("xlsx").WorkBook {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    const ref = worksheet["!ref"];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      worksheet["!cols"] = Array.from({ length: range.e.c - range.s.c + 1 }, (_, index) => {
        const column = range.s.c + index;
        let width = 12;
        for (let row = range.s.r; row <= range.e.r; row += 1) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
          const length = cell?.v == null ? 0 : String(cell.v).length;
          if (length + 2 > width) width = length + 2;
        }
        return { wch: Math.min(width, 36) };
      });
      const oddsStart = sheet.name === "Goals" ? range.e.c + 1 : range.s.c + 2;
      for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
        for (let column = oddsStart; column <= range.e.c; column += 1) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
          if (cell && cell.t === "n") cell.z = "0.00";
        }
      }
      worksheet["!autofilter"] = { ref };
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  return workbook;
}

function oddsSheet(
  series: OddsSeriesPoint[],
  market: MarketKey,
  source: OddsSource,
  halfEnds: HalfEnds,
  goals: GoalEvent[],
  name: string,
): OddsSheet | null {
  const snapshots = buildChartSnapshots(series, market, source, halfEndFor(market, halfEnds));
  if (snapshots.length === 0) return null;
  const lines = linesForMarket(series, market);
  const clocks = snapshots
    .map((snapshot) => snapshot.liveClock)
    .filter((clock): clock is LiveClock => clock != null);
  const h1Added = source === "live" ? liveChartAxis(market, clocks).h1Added : 0;
  const { settled } = settleTimes(goals, market, lines, (goal) => {
    return goalChartMinute(goal, market, source, h1Added) ?? goal.elapsedMinutes;
  });
  const labels = goalLabelsByMinute(goals, market, source, h1Added);
  return {
    name,
    rows: [
      ["Minute", "Goal", ...lines.map((line) => `Over ${line}`)],
      ...snapshots.map((snapshot) => [
        snapshot.clockLabel,
        labels.get(minuteKey(snapshot.chartMinute, source)) ?? null,
        ...lines.map((line) => overAt(snapshot, line, settled)),
      ]),
    ],
  };
}

function goalsSheet(goals: GoalEvent[]): OddsSheet {
  const sorted = [...goals].sort(
    (a, b) => a.elapsedMinutes - b.elapsedMinutes || a.period - b.period,
  );
  return {
    name: "Goals",
    rows: [
      ["Minute", "Score", "Scorer", "Team"],
      ...sorted.map((goal) => [
        goalMinuteLabel(goal),
        `${goal.homeScore}–${goal.awayScore}`,
        scorerName(goal),
        goal.team,
      ]),
    ],
  };
}

function goalLabelsByMinute(
  goals: GoalEvent[],
  market: MarketKey,
  source: OddsSource,
  h1Added: number,
): Map<number, string> {
  const labels = new Map<number, string[]>();
  for (const goal of goals) {
    if (!goalInMarket(goal, market)) continue;
    const minute = goalChartMinute(goal, market, source, h1Added);
    if (minute == null) continue;
    const key = minuteKey(minute, source);
    const text = goalCell(goal);
    const current = labels.get(key);
    if (current) current.push(text);
    else labels.set(key, [text]);
  }
  return new Map([...labels].map(([key, parts]) => [key, parts.join(" · ")]));
}

function minuteKey(minute: number, source: OddsSource): number {
  if (source === "live") return Math.round(minute * 1000) / 1000;
  return Math.round(minute);
}

function goalChartMinute(
  goal: GoalEvent,
  market: MarketKey,
  source: OddsSource,
  h1Added: number,
): number | null {
  if (source !== "live") return goal.elapsedMinutes;
  const clock = goalClock(goal);
  if (!clock) return null;
  return chartMinuteFor(clock, market, h1Added);
}

function goalInMarket(goal: GoalEvent, market: MarketKey): boolean {
  if (market === MARKETS.h1) return goal.period === 1;
  if (market === MARKETS.h2) return goal.period === 2;
  return true;
}

function goalCell(goal: GoalEvent): string {
  const name = lastName(goal.scorer) ?? goal.team;
  return `${goal.homeScore}–${goal.awayScore} ${name}${goalFlags(goal)}`;
}

function scorerName(goal: GoalEvent): string {
  return `${goal.scorer ?? goal.team}${goalFlags(goal)}`;
}

function goalFlags(goal: GoalEvent): string {
  return `${goal.ownGoal ? " (OG)" : ""}${goal.penalty ? " (P)" : ""}`;
}

function goalMinuteLabel(goal: GoalEvent): string {
  const clock = goalClock(goal);
  if (!clock) return goal.displayMinute;
  const market = goal.period === 1 ? MARKETS.h1 : MARKETS.h2;
  return formatChartMinute(market, clock.minute + clock.added, 0);
}

function lastName(name: string | null): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

function goalClock(goal: GoalEvent): LiveClock | null {
  const parsed = parseClockDisplay(goal.displayMinute);
  if (!parsed) return null;
  return liveClockFromParts(goal.period, parsed.minute, parsed.added);
}

function settleTimes(
  goals: GoalEvent[],
  market: MarketKey,
  lines: number[],
  at: (goal: GoalEvent) => number,
) {
  const halfGoals = goals
    .filter((goal) => goalInMarket(goal, market))
    .sort((a, b) => at(a) - at(b));
  const settled = new Map<number, number>();
  for (const line of lines) {
    let count = 0;
    for (const goal of halfGoals) {
      count += 1;
      if (count > line) {
        settled.set(line, at(goal));
        break;
      }
    }
  }
  return { settled };
}

function buildChartSnapshots(
  series: OddsSeriesPoint[],
  market: MarketKey,
  source: OddsSource,
  halfEndMinute: number | null,
): MarketSnapshot[] {
  const rows = marketSnapshots(series, market);
  if (source === "live") {
    const clocks = rows
      .map((snapshot) => snapshot.liveClock)
      .filter((clock): clock is LiveClock => clock != null);
    const axis = liveChartAxis(market, clocks);
    return rows
      .flatMap((snapshot) => {
        if (!snapshot.liveClock) return [];
        const chartMinute = chartMinuteFor(snapshot.liveClock, market, axis.h1Added);
        if (chartMinute == null) return [];
        return [
          {
            ...snapshot,
            chartMinute,
            clockLabel: formatChartMinute(market, chartMinute, axis.h1Added),
          },
        ];
      })
      .sort((a, b) => a.chartMinute - b.chartMinute);
  }
  const { min, max } = marketWindow(market, halfEndMinute);
  return rows
    .filter((snapshot) => snapshot.elapsedMinutes >= min && snapshot.elapsedMinutes <= max)
    .map((snapshot) => ({
      ...snapshot,
      chartMinute: snapshot.elapsedMinutes,
      clockLabel: formatMinute(snapshot.elapsedMinutes),
    }));
}

function marketSnapshots(series: OddsSeriesPoint[], market: MarketKey): MarketSnapshot[] {
  const byTimestamp = new Map<string, MarketSnapshot>();
  for (const row of series) {
    if (row.market !== market) continue;
    const current = byTimestamp.get(row.timestamp) ?? {
      timestamp: row.timestamp,
      elapsedMinutes: row.elapsedMinutes,
      chartMinute: row.elapsedMinutes,
      clockLabel: formatMinute(row.elapsedMinutes),
      liveClock: row.liveClock,
      prices: new Map(),
    };
    if (row.point !== null) {
      current.prices.set(row.point, {
        overPrice: row.overPrice,
        underPrice: row.underPrice,
      });
    }
    byTimestamp.set(row.timestamp, current);
  }
  return [...byTimestamp.values()].sort((a, b) => a.chartMinute - b.chartMinute);
}

function overAt(
  snapshot: MarketSnapshot,
  line: number,
  settled: Map<number, number>,
): number | null {
  const settledAt = settled.get(line);
  if (settledAt !== undefined && snapshot.chartMinute > settledAt) return null;
  return snapshot.prices.get(line)?.overPrice ?? null;
}

function linesForMarket(series: OddsSeriesPoint[], market: MarketKey): number[] {
  const points = new Set<number>();
  for (const row of series) {
    if (row.market === market && row.point !== null) points.add(row.point);
  }
  return [...points].sort((a, b) => a - b);
}

function halfEndFor(market: MarketKey, halfEnds: HalfEnds): number | null {
  if (market === MARKETS.h1) return halfEnds.h1EndMinute;
  if (market === MARKETS.h2) return halfEnds.h2EndMinute;
  return null;
}
