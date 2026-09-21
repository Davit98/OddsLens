import { notFound } from "next/navigation";
import { MatchExplorer } from "@/components/MatchExplorer";
import { getMatch } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const match = getMatch(id);
  if (!match) notFound();
  return <MatchExplorer match={match} />;
}
