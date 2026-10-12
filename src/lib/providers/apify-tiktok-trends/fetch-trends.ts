// Actor calls, split so the Inngest workflow can memoize each one: start → poll → items. Retry safety comes from
// the workflow (TrendRun.idemKey keeps the Apify run id, a retry polls that run instead of starting a new one).
import { apify, actorId } from "./client";
import { buildInput } from "./build-input";
import { normalize } from "./normalize";
import type { TikTokTrendsSettings } from "./schema";

export const RUN_TIMEOUT_SECS = 600;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Starts a run. maxTotalChargeUsd is enforced by Apify itself for pay-per-event actors (hard per-run cost cap). */
export async function startRun(s: TikTokTrendsSettings, maxTotalChargeUsd: number) {
  try {
    const run = await apify().actor(actorId()).start(buildInput(s), { timeout: RUN_TIMEOUT_SECS, memory: 256, maxTotalChargeUsd });
    return { runId: run.id };
  } catch (e) {
    throw new Error(`Apify start failed: ${msg(e)}`);
  }
}

export type RunState = { status: string; datasetId: string; usd: number; durationMs: number | null; done: boolean };

export async function getRun(runId: string): Promise<RunState> {
  const run = await apify().run(runId).get();
  if (!run) throw new Error(`Apify run ${runId} not found`);
  return {
    status: run.status,
    datasetId: run.defaultDatasetId,
    usd: Number(run.usageTotalUsd ?? 0),
    durationMs: run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
    done: !["READY", "RUNNING", "TIMING-OUT", "ABORTING"].includes(run.status),
  };
}

export async function listItems(datasetId: string, limit: number) {
  return (await apify().dataset(datasetId).listItems({ limit, clean: true })).items as unknown[];
}

/** One-shot fetch for callers outside Inngest (TrendSource interface). Inngest uses the split calls above. */
export async function fetchTrends(s: TikTokTrendsSettings, maxTotalChargeUsd: number) {
  const { runId } = await startRun(s, maxTotalChargeUsd);
  const run = await apify().run(runId).waitForFinish({ waitSecs: RUN_TIMEOUT_SECS });
  if (run.status !== "SUCCEEDED") throw new Error(`Apify run ${run.status}`);
  return normalize(s.trendType, await listItems(run.defaultDatasetId, s.maxItems), s.trendType === "hashtags" ? s.hashtagPeriod : s.videoPeriod);
}
