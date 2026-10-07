import { NextResponse } from "next/server";
import JSZip from "jszip";
import {
  getCaptureCoverage,
  getLiveOddsSeries,
  getMatch,
  listCapturedLiveMatches,
} from "@/lib/db";
import { buildOddsWorkbookSheets, oddsWorkbookBuffer } from "@/lib/excel-odds";
import { BOOKMAKERS, MARKETS, type MarketKey } from "@/lib/leagues";
import { ensureMatchDetails } from "@/lib/match-details";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LIVE_CHART_MARKETS: MarketKey[] = [MARKETS.h1, MARKETS.h2, MARKETS.full];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const excludePartial = searchParams.get("excludePartial") !== "0";
  const league = searchParams.get("league") ?? "all";

  let matches = listCapturedLiveMatches();
  if (league !== "all") matches = matches.filter((match) => match.sportKey === league);
  if (excludePartial) matches = matches.filter((match) => !match.partial);
  if (matches.length === 0) {
    return NextResponse.json({ error: "No matches to export" }, { status: 400 });
  }

  const zip = new JSZip();
  const used = new Set<string>();

  for (const captured of matches) {
    const match = getMatch(captured.id);
    if (!match) continue;
    const details = await ensureMatchDetails(match);
    const coverage = getCaptureCoverage(match.id, match.completed);
    if (excludePartial && coverage.partial) continue;

    for (const bookmaker of captured.bookmakers) {
      const series = LIVE_CHART_MARKETS.flatMap((market) =>
        getLiveOddsSeries({ eventId: match.id, bookmaker, market }).map((point) => ({
          ...point,
          market,
        })),
      );
      const sheets = buildOddsWorkbookSheets({
        series,
        source: "live",
        halfEnds: details.halfEnds,
        goals: details.goals,
      });
      if (sheets.length === 0) continue;
      const book = BOOKMAKERS.find((item) => item.key === bookmaker)?.title ?? bookmaker;
      const filename = uniqueName(
        used,
        `${filePart(match.homeTeam)}-vs-${filePart(match.awayTeam)}-${kickoffDate(match.commenceTime)}-live-${filePart(book)}.xlsx`,
      );
      zip.file(filename, await oddsWorkbookBuffer(sheets));
    }
  }

  if (Object.keys(zip.files).length === 0) {
    return NextResponse.json({ error: "No matches to export" }, { status: 400 });
  }

  const archive = await zip.generateAsync({ type: "nodebuffer" });
  return new NextResponse(new Uint8Array(archive), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="oddslens-captured.zip"',
      "Cache-Control": "no-store",
    },
  });
}

function kickoffDate(iso: string): string {
  const date = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "match";
}

function filePart(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return cleaned || "match";
}

function uniqueName(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);
  let index = 2;
  let next = `${stem}-${index}${ext}`;
  while (used.has(next)) {
    index += 1;
    next = `${stem}-${index}${ext}`;
  }
  used.add(next);
  return next;
}
