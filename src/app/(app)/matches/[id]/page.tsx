import { notFound } from "next/navigation";
import { MatchExplorer } from "@/components/MatchExplorer";
import { getCaptureCoverage, getMatch } from "@/lib/db";
import { ensureMatchDetails } from "@/lib/match-details";

export const dynamic = "force-dynamic";

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const match = getMatch(id);
  if (!match) notFound();
  const { goals, halfEnds } = await ensureMatchDetails(match);
  const fresh = getMatch(id) ?? match;
  return (
    <MatchExplorer
      match={fresh}
      initialGoals={goals}
      initialHalfEnds={halfEnds}
      initialCapture={getCaptureCoverage(fresh.id, fresh.completed)}
    />
  );
}
