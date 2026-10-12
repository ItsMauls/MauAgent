import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { accountManager, artDirector, creativeDirector, producer, promptPackage, saveArtifact } from "@/lib/agents";
import { ClientBrief, type VisualDirection } from "@/lib/agents/schemas";
import { createSeedanceTask, getSeedanceTask, seedanceConfig } from "@/lib/providers/seedance";
import { finalCut } from "@/lib/media";
import { download, uploadFile, uploadFromUrl } from "@/lib/s3";
import { recordAsset } from "@/lib/assets";
import type { CampaignStatus } from "@prisma/client";

const setStatus = (id: string, status: CampaignStatus) => db.campaign.update({ where: { id }, data: { status } });

/** Record a Step in the DB (for the Pipeline dashboard) around the work of a step. */
async function tracked<T>(runId: string, agentRole: string, attempt: number, fn: () => Promise<T>): Promise<T> {
  const row = await db.step.create({ data: { runId, agentRole, status: "running", attempt: attempt + 1 } });
  try {
    const out = await fn();
    await db.step.update({ where: { id: row.id }, data: { status: "done", endedAt: new Date() } });
    return out;
  } catch (e) {
    await db.step.update({ where: { id: row.id }, data: { status: "failed", endedAt: new Date(), error: String(e) } });
    throw e;
  }
}

async function allShotsReady(campaignId: string) {
  const pending = await db.shot.count({ where: { campaignId, status: { not: "ready" } } });
  return pending === 0;
}

export const campaignPipeline = inngest.createFunction(
  { id: "campaign-pipeline", retries: 3 },
  { event: "campaign/brief.submitted" },
  async ({ event, step, attempt, runId: inngestRunId }) => {
    const campaignId: string = event.data.campaignId;

    const { runId, brief } = await step.run("init", async () => {
      const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
      const run = await db.run.create({ data: { campaignId, inngestRunId, status: "running" } });
      return { runId: run.id, brief: ClientBrief.parse(c.clientBrief) };
    });

    const agent = <T>(role: string, fn: () => Promise<{ payload: T; costUsd: number }>) =>
      step.run(role, () =>
        tracked(runId, role, attempt, async () => {
          const { payload, costUsd } = await fn();
          await saveArtifact(campaignId, role, payload, costUsd, runId);
          return payload;
        }),
      );

    try {
      // vidIQ Trend Scout arrives in Phase 2; no trend signals for now.
      const internal = await agent("accountManager", () => accountManager(brief));
      const creative = await agent("creativeDirector", () => creativeDirector(internal));
      const visual = (await agent("artDirector", () => artDirector(creative, brief))) as VisualDirection;

      const plan = await step.run("producer", () =>
        tracked(runId, "producer", attempt, async () => {
          const { model, resolution } = seedanceConfig("draft");
          const prices = await db.priceBook.findMany({ where: { provider: "byteplus", unit: "second" }, orderBy: { effectiveFrom: "desc" } });
          const plan = producer(visual, {
            defaultSource: brief.defaultSource,
            draftModel: model,
            resolution,
            price: (m) => Number(prices.find((p) => p.model === m)?.unitPrice ?? 0),
          });
          await saveArtifact(campaignId, "producer", plan, 0, runId);
          // Create shot slots (idempotent via upsert).
          for (const s of plan.shots) {
            const spec = visual.shotList.find((x) => x.shotId === s.shotId)!;
            const pkg = promptPackage(campaignId, spec, visual);
            await db.shot.upsert({
              where: { campaignId_shotId: { campaignId, shotId: s.shotId } },
              create: { campaignId, shotId: s.shotId, source: s.source, maxAttempts: s.maxAttempts, promptPackage: pkg },
              update: { source: s.source, maxAttempts: s.maxAttempts, promptPackage: pkg },
            });
          }
          return plan;
        }),
      );
      // ponytail: full budget gate (stop + wait for confirmation) lands in Phase 1.

      // ---- Videographer: Seedance API path ----
      for (const s of plan.shots.filter((x) => x.source === "seedance_api")) {
        const spec = visual.shotList.find((x) => x.shotId === s.shotId)!;
        // Task is created in its own step → the result is memoized by Inngest, so retrying later steps does not create a new task.
        const taskId = await step.run(`seedance-create-${s.shotId}`, async () => {
          const pkg = promptPackage(campaignId, spec, visual);
          const id = await createSeedanceTask(`${pkg.prompt}\nDialogue: ${pkg.vo}`, spec, "draft");
          const { model } = seedanceConfig("draft");
          await db.costEntry.upsert({
            where: { idemKey: `${campaignId}:seedance:${s.shotId}:1` },
            create: {
              campaignId, step: `seedance-${s.shotId}`, provider: "byteplus", model,
              units: spec.durationSec, unitPrice: s.estCostUsd / spec.durationSec || 0, usd: s.estCostUsd,
              idemKey: `${campaignId}:seedance:${s.shotId}:1`,
            },
            update: {},
          });
          return id;
        });

        let videoUrl: string | null = null;
        for (let i = 0; i < 60 && !videoUrl; i++) {
          await step.sleep(`seedance-wait-${s.shotId}-${i}`, "15s");
          const st = await step.run(`seedance-poll-${s.shotId}-${i}`, () => getSeedanceTask(taskId));
          if (st.status === "failed") break; // slot is left open for manual upload
          if (st.status === "succeeded") videoUrl = st.videoUrl;
        }

        await step.run(`seedance-save-${s.shotId}`, async () => {
          const shot = await db.shot.findUniqueOrThrow({ where: { campaignId_shotId: { campaignId, shotId: s.shotId } } });
          if (!videoUrl) return db.shot.update({ where: { id: shot.id }, data: { status: "failed" } });
          const key = `campaigns/${campaignId}/${s.shotId}/seedance-${taskId}.mp4`;
          await uploadFromUrl(key, videoUrl);
          return recordAsset(shot.id, key, "seedance", spec.durationSec);
        });
      }

      // ---- Manual / fallback path: wait until all slots are filled ----
      // Re-check the DB every hour because an event sent before waitForEvent is active is not caught.
      if (!(await step.run("check-assets-0", () => allShotsReady(campaignId)))) {
        await step.run("status-awaiting-upload", () => setStatus(campaignId, "AWAITING_VIDEO_UPLOAD"));
        let ready = false;
        for (let i = 1; i <= 14 * 24 && !ready; i++) {
          await step.waitForEvent(`wait-uploads-${i}`, { event: "campaign/assets.complete", if: `async.data.campaignId == "${campaignId}"`, timeout: "1h" });
          ready = await step.run(`check-assets-${i}`, () => allShotsReady(campaignId));
        }
        if (!ready) return step.run("expired-upload", () => setStatus(campaignId, "EXPIRED"));
      }

      // ---- Minimal post-production ----
      await step.run("post-production", () =>
        tracked(runId, "postProduction", attempt, async () => {
          await setStatus(campaignId, "POST_PRODUCTION");
          const dir = await mkdtemp(join(tmpdir(), "mauagent-"));
          try {
            const clips = [];
            for (const spec of visual.shotList) {
              const shot = await db.shot.findUniqueOrThrow({
                where: { campaignId_shotId: { campaignId, shotId: spec.shotId } },
                include: { assets: { where: { validation: { path: ["ok"], equals: true } }, orderBy: { version: "desc" }, take: 1 } },
              });
              const a = shot.assets[0];
              const file = join(dir, `${spec.shotId}.mp4`);
              await download(a.s3Key, file);
              clips.push({ file, durationSec: a.durationSec ?? spec.durationSec, voLine: spec.voLine });
            }
            const out = await finalCut(dir, clips);
            const key = `campaigns/${campaignId}/finalCut-${Date.now()}.mp4`;
            await uploadFile(key, out);
            await db.campaign.update({ where: { id: campaignId }, data: { finalCutKey: key, status: "AWAITING_APPROVAL" } });
            await saveArtifact(campaignId, "postProduction", { finalCut: key, clips: clips.map((c) => c.file.split(/[\\/]/).pop()) }, 0, runId);
          } finally {
            await rm(dir, { recursive: true, force: true });
          }
        }),
      );

      // ---- Client approval (revision/regenerate in Phase 1) ----
      const decision = await step.waitForEvent("client-decision", {
        event: "campaign/client.decision",
        if: `async.data.campaignId == "${campaignId}"`,
        timeout: "7d",
      });
      await step.run("finish", async () => {
        const status: CampaignStatus = !decision ? "EXPIRED" : decision.data.type === "approve" ? "APPROVED" : "REJECTED";
        await setStatus(campaignId, status);
        await db.run.update({ where: { id: runId }, data: { status: "done", endedAt: new Date() } });
      });
    } catch (e) {
      // Permanent failure after retries are exhausted. NonRetriable/step errors are rethrown after the status is recorded.
      await step.run("mark-failed", async () => {
        await setStatus(campaignId, "FAILED");
        await db.run.update({ where: { id: runId }, data: { status: "failed", endedAt: new Date() } });
      });
      throw e;
    }
  },
);
