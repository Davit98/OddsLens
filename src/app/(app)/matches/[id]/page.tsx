import { notFound } from "next/navigation";
import { MatchExplorer } from "@/components/MatchExplorer";
import { getMatch } from "@/lib/db";
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
  return (
    <MatchExplorer
      match={getMatch(id) ?? match}
      initialGoals={goals}
      initialHalfEnds={halfEnds}
    />
  );
}
