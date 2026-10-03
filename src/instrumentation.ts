export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const { ensureLiveLoop } = await import("./lib/live-collect");
    ensureLiveLoop();
    const { backfillIncompleteLiveGoals } = await import("./lib/match-details");
    void backfillIncompleteLiveGoals().catch((error) => {
      console.error("Goal backfill failed", error);
    });
  }
}
