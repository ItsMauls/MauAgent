// F12 Trend Scout (Apify TikTok Trends). Cron every 15 min checks the stored schedule; "Sync now" sends
// trends/run.requested. One sync = SYNC_JOBS (hashtags + top videos, 7 and 30 days) run in parallel and cached as
// TrendSignal rows, so pages never call the actor. Every actor run is a TrendRun row whose idemKey is this Inngest
// run + job, so a retry resumes the same Apify run instead of paying for a second one.
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { actorId } from "@/lib/providers/apify-tiktok-trends/client";
import { getRun, listItems, normalize, startRun, type TikTokTrendsSettings } from "@/lib/providers/apify-tiktok-trends";
import { SOURCE, SYNC_JOBS, actorSettings, cronDue, estimateRunUsd, getTrendSettings, jobSettings, monthRuns, runGate, type SyncJob } from "@/lib/trends";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export const trendScout = inngest.createFunction(
  { id: "trend-scout", retries: 3, concurrency: { limit: 1 } },
  [{ cron: "*/15 * * * *" }, { event: "trends/run.requested" }],
  async ({ event, step, runId }) => {
    const trigger = event.name === "trends/run.requested" ? "manual" : "cron";

    const plan = await step.run("check", async () => {
      const row = await getTrendSettings();
      if (!row) return { skip: "No trend settings yet (open Trends once)" };
      if (trigger === "cron") {
        const { timezone } = await getSettings();
        if (!cronDue(row.scheduleCron, new Date(), timezone)) return { skip: "Not scheduled now" };
        // Cache window: a recent successful sync is reused, the actor is not called again.
        const fresh = await db.trendRun.findFirst({
          where: { source: SOURCE, status: "succeeded", startedAt: { gte: new Date(Date.now() - row.cacheHours * 3_600_000) } },
        });
        if (fresh) return { skip: `Cached (last success ${fresh.startedAt.toISOString()})` };
      }
      const settings = actorSettings(row);
      const maxCost = Number(row.maxCostPerRunUsd);
      // Counts the runs this sync adds: blocked when the whole sync does not fit the monthly cap.
      const blocked = runGate({
        runsThisMonth: (await monthRuns()) + SYNC_JOBS.length - 1, monthlyRunCap: row.monthlyRunCap,
        estUsd: await estimateRunUsd(settings.maxItems), maxCostPerRunUsd: maxCost,
      });
      if (blocked) {
        // Visible on the Trends page; no actor call.
        const idemKey = `trend:${runId}`;
        await db.trendRun.upsert({ where: { idemKey }, create: { idemKey, trigger, status: "blocked", error: blocked, finishedAt: new Date() }, update: {} });
        return { skip: blocked };
      }
      return { settings, maxCost };
    });
    if ("skip" in plan) return plan;
    const base = plan.settings as TikTokTrendsSettings;
    const maxCost = plan.maxCost;

    async function scout(job: SyncJob) {
      const key = job.join("-");
      const idemKey = `trend:${runId}:${key}`;
      const settings = jobSettings(base, job);
      try {
        const apifyRunId = await step.run(`${key}:start`, async () => {
          const r = await db.trendRun.upsert({ where: { idemKey }, create: { idemKey, trigger, status: "starting" }, update: {} });
          if (r.apifyRunId) return r.apifyRunId; // a previous attempt already started it
          const { runId: id } = await startRun(settings, maxCost);
          await db.trendRun.update({ where: { idemKey }, data: { apifyRunId: id, status: "running" } });
          return id;
        });

        let state = await step.run(`${key}:poll-0`, () => getRun(apifyRunId));
        for (let i = 1; i <= 40 && !state.done; i++) {
          await step.sleep(`${key}:wait-${i}`, "15s");
          state = await step.run(`${key}:poll-${i}`, () => getRun(apifyRunId));
        }

        return await step.run(`${key}:save`, async () => {
          const finish = (data: { status: string; error?: string; itemCount?: number }) =>
            db.trendRun.update({ where: { idemKey }, data: { ...data, usd: state.usd, durationMs: state.durationMs, finishedAt: new Date() } });
          // Whatever the outcome, Apify charged for the run: record it once.
          await db.costEntry.upsert({
            where: { idemKey },
            create: {
              idemKey, step: "trend-scout", provider: "apify", model: actorId(), agentRole: "trendScout", reason: "trend",
              units: 1, unitPrice: state.usd, usd: state.usd, // one unit = one run
            },
            update: { usd: state.usd, unitPrice: state.usd },
          });
          if (!state.done) return finish({ status: "failed", error: "Apify run still running after 10 minutes" });
          if (state.status !== "SUCCEEDED") return finish({ status: "failed", error: `Apify run ${state.status}` });

          const items = await listItems(state.datasetId, settings.maxItems);
          const signals = normalize(job[0], items, job[1]);
          if (!signals.length) return finish({ status: "empty", error: items.length ? "No usable items in the dataset" : "Dataset is empty", itemCount: 0 });
          const capturedDay = utcDay(new Date());
          for (const s of signals) {
            const { rawPayload, ...rest } = s;
            const data = { ...rest, capturedDay, rawPayload: rawPayload as object };
            await db.trendSignal.upsert({
              where: { source_externalId_capturedDay: { source: s.source, externalId: s.externalId, capturedDay } },
              create: data,
              update: { outlierScore: s.outlierScore, hook: s.hook, url: s.url, rawPayload: data.rawPayload, capturedAt: s.capturedAt },
            });
          }
          return finish({ status: "succeeded", itemCount: signals.length });
        });
      } catch (e) {
        // One failed window must not lose the others; the error shows on /trends.
        await step.run(`${key}:mark-failed`, () =>
          db.trendRun.updateMany({ where: { idemKey, status: { notIn: ["succeeded", "empty"] } }, data: { status: "failed", error: msg(e), finishedAt: new Date() } }),
        );
        return null;
      }
    }

    await Promise.all(SYNC_JOBS.map(scout));
    return { synced: SYNC_JOBS.length };
  },
);
