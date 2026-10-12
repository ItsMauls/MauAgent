import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import {
  accountManager,
  accountTeam,
  artDirector,
  creativeDirector,
  producer,
  promptPackage,
  routeRevision,
  saveArtifact,
} from "@/lib/agents";
import {
  ClientBrief,
  RevisionTarget,
  Stage,
  STAGES,
  type CreativeBrief,
  type InternalBrief,
  type ProductionPlan,
  type VisualDirection,
} from "@/lib/agents/schemas";
import { createSeedanceTask, getSeedanceTask, seedanceConfig } from "@/lib/providers/seedance";
import { finalCut } from "@/lib/media";
import { download, uploadFile, uploadFromUrl } from "@/lib/s3";
import { recordAsset } from "@/lib/assets";
import { budgetGate, campaignSpent, latestPrice, monthSpent } from "@/lib/cost";
import { allowedFrom } from "@/lib/status";
import { NonRetriableError } from "inngest";
import type { CampaignStatus, Prisma } from "@prisma/client";

/** Status change guarded by the state machine (atomic: the WHERE only matches allowed source statuses). */
async function setStatus(id: string, status: CampaignStatus, extra: Prisma.CampaignUpdateManyMutationInput = {}) {
  const { count } = await db.campaign.updateMany({ where: { id, status: { in: allowedFrom(status) } }, data: { ...extra, status } });
  if (!count) {
    const c = await db.campaign.findUniqueOrThrow({ where: { id }, select: { status: true } });
    throw new NonRetriableError(`Invalid status transition ${c.status} → ${status}`);
  }
}

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

async function allShotsReady(campaignId: string, shotIds: string[]) {
  const pending = await db.shot.count({ where: { campaignId, shotId: { in: shotIds }, status: { not: "ready" } } });
  return pending === 0;
}

async function latestPayload<T>(campaignId: string, agentRole: string) {
  const a = await db.artifact.findFirstOrThrow({ where: { campaignId, agentRole }, orderBy: { version: "desc" } });
  return a.payload as T;
}

/**
 * First run: { campaignId }. Revise/regenerate start a new run of this same function from a later stage;
 * stages before `from` reuse their latest Artifact instead of calling the LLM again.
 */
const RunData = z.object({
  campaignId: z.string(),
  from: Stage.default("accountManager"),
  notes: z.string().optional(),
  shotIds: z.array(z.string()).optional(),
  reason: z.enum(["initial", "revision", "regenerate"]).default("initial"),
  budgetConfirmed: z.boolean().default(false),
});

export const campaignPipeline = inngest.createFunction(
  { id: "campaign-pipeline", retries: 3 },
  { event: "campaign/brief.submitted" },
  async ({ event, step, attempt, runId: inngestRunId }) => {
    const data = RunData.parse(event.data);
    const { campaignId, from, notes, reason } = data;
    const runs = (s: (typeof STAGES)[number]) => STAGES.indexOf(from) <= STAGES.indexOf(s);

    const { runId, brief, kit } = await step.run("init", async () => {
      const c = await db.campaign.findUniqueOrThrow({
        where: { id: campaignId },
        include: { creativeAssets: { select: { kind: true, name: true, description: true, imageUrls: true } } },
      });
      const run = await db.run.create({ data: { campaignId, inngestRunId, status: "running" } });
      return { runId: run.id, brief: ClientBrief.parse(c.clientBrief), kit: c.creativeAssets };
    });

    // Run the agent when its stage is due, otherwise reuse its latest artifact.
    const agent = <T>(role: (typeof STAGES)[number], fn: () => Promise<{ payload: T; costUsd: number }>) =>
      runs(role)
        ? step.run(role, () =>
            tracked(runId, role, attempt, async () => {
              const { payload, costUsd } = await fn();
              await saveArtifact(campaignId, role, payload, costUsd, runId);
              return payload;
            }),
          )
        : // A campaign seeded from a Boards task may lack earlier stages (e.g. a Creative Director idea has no internal
          // brief). Null is safe: a skipped stage's output is only read by later stages, which are seeded too.
          step.run(`load-${role}`, async () => (await db.artifact.findFirst({ where: { campaignId, agentRole: role }, orderBy: { version: "desc" } }))?.payload as T);

    const noteFor = (role: string) => (role === from ? notes : undefined);

    try {
      // vidIQ Trend Scout arrives in Phase 2; no trend signals for now.
      const mem = { runId, campaignId, brief };
      const internal = (await agent("accountManager", () => accountManager(brief, [], mem))) as InternalBrief;
      const creative = (await agent("creativeDirector", () => creativeDirector(internal, noteFor("creativeDirector"), mem))) as CreativeBrief;
      const visual = (await agent("artDirector", () => artDirector(creative, brief, noteFor("artDirector"), mem, kit))) as VisualDirection;

      const plan: ProductionPlan = runs("producer")
        ? await step.run("producer", () =>
            tracked(runId, "producer", attempt, async () => {
              const { model, resolution } = seedanceConfig("draft");
              const prices = await db.priceBook.findMany({ where: { provider: "byteplus", unit: "second" } });
              const plan = producer(visual, {
                defaultSource: brief.defaultSource,
                draftModel: model,
                resolution,
                price: (m) => latestPrice(prices, "byteplus", m, "second"),
              });
              await saveArtifact(campaignId, "producer", plan, 0, runId);
              // Create shot slots (idempotent via upsert). A new plan resets slots so new footage is required.
              for (const s of plan.shots) {
                const spec = visual.shotList.find((x) => x.shotId === s.shotId)!;
                const pkg = promptPackage(campaignId, spec, visual);
                await db.shot.upsert({
                  where: { campaignId_shotId: { campaignId, shotId: s.shotId } },
                  create: { campaignId, shotId: s.shotId, source: s.source, maxAttempts: s.maxAttempts, promptPackage: pkg },
                  update: { source: s.source, maxAttempts: s.maxAttempts, promptPackage: pkg, status: "pending" },
                });
              }
              return plan;
            }),
          )
        : await step.run("load-producer", () => latestPayload<ProductionPlan>(campaignId, "producer"));

      // ---- Budget gate (F5): campaign cap and monthly cap, enforced here, not only in the UI ----
      if (runs("producer") && !data.budgetConfirmed) {
        const gate = await step.run("budget-gate", async () => {
          const [c, s, spent, month] = await Promise.all([
            db.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
            db.setting.upsert({ where: { id: "default" }, create: {}, update: {} }),
            campaignSpent(campaignId),
            monthSpent(),
          ]);
          const g = budgetGate({
            estUsd: plan.estCostUsd, spentUsd: spent, capUsd: Number(c.budgetCapUsd),
            monthSpentUsd: month, monthCapUsd: Number(s.monthlyBudgetUsd),
          });
          if (g.blocked) await setStatus(campaignId, "AWAITING_BUDGET");
          return g;
        });
        if (gate.blocked) {
          const d = await step.waitForEvent("budget-decision", {
            event: "campaign/budget.decision",
            if: `async.data.campaignId == "${campaignId}"`,
            timeout: "7d",
          });
          if (!d || d.data.action === "cancel")
            return step.run("budget-stop", async () => {
              await setStatus(campaignId, d ? "REJECTED" : "EXPIRED");
              await db.run.update({ where: { id: runId }, data: { status: "done", endedAt: new Date() } });
            });
          await step.run("budget-proceed", () => setStatus(campaignId, "DRAFTING"));
        }
      }

      // ---- Videographer: all shots on a fresh plan, only the chosen ones on regenerate ----
      const planShotIds = plan.shots.map((s) => s.shotId);
      const targets = runs("videographer") ? plan.shots.filter((s) => !data.shotIds || data.shotIds.includes(s.shotId)) : [];
      if (data.shotIds?.length)
        await step.run("reopen-shots", async () => {
          const shots = await db.shot.findMany({ where: { campaignId, shotId: { in: data.shotIds } } });
          await db.shot.updateMany({ where: { id: { in: shots.map((s) => s.id) } }, data: { status: "pending" } });
          // Regenerate counts as a new round of attempts for manual shots.
          for (const s of shots) await db.shot.update({ where: { id: s.id }, data: { maxAttempts: { increment: s.maxAttempts } } });
        });

      for (const s of targets.filter((x) => x.source === "seedance_api")) {
        const spec = visual.shotList.find((x) => x.shotId === s.shotId)!;
        // Task is created in its own step → the result is memoized by Inngest, so retrying later steps does not create a new task.
        const taskId = await step.run(`seedance-create-${s.shotId}`, async () => {
          const pkg = promptPackage(campaignId, spec, visual);
          const id = await createSeedanceTask(`${pkg.prompt}\nDialogue: ${pkg.vo}`, spec, "draft");
          const { model } = seedanceConfig("draft");
          // One charge per shot per run: a retry of this run reuses the key, a regenerate run gets a new one.
          const idemKey = `${campaignId}:seedance:${s.shotId}:${runId}`;
          await db.costEntry.upsert({
            where: { idemKey },
            create: {
              campaignId, step: `seedance-${s.shotId}`, provider: "byteplus", model, reason,
              units: spec.durationSec, unitPrice: s.estCostUsd / spec.durationSec || 0, usd: s.estCostUsd, idemKey,
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
      if (!(await step.run("check-assets-0", () => allShotsReady(campaignId, planShotIds)))) {
        await step.run("status-awaiting-upload", () => setStatus(campaignId, "AWAITING_VIDEO_UPLOAD"));
        let ready = false;
        for (let i = 1; i <= 14 * 24 && !ready; i++) {
          await step.waitForEvent(`wait-uploads-${i}`, { event: "campaign/assets.complete", if: `async.data.campaignId == "${campaignId}"`, timeout: "1h" });
          ready = await step.run(`check-assets-${i}`, () => allShotsReady(campaignId, planShotIds));
        }
        if (!ready) return step.run("expired-upload", () => setStatus(campaignId, "EXPIRED"));
      }

      // ---- Minimal post-production ----
      // ponytail: edit notes are not interpreted yet; a postProduction revision re-renders the same cut until F8 lands.
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
              clips.push({ file, durationSec: a.durationSec ?? spec.durationSec, voLine: spec.voLine, assetVersion: a.version });
            }
            const out = await finalCut(dir, clips);
            const key = `campaigns/${campaignId}/finalCut-${Date.now()}.mp4`;
            await uploadFile(key, out);
            await db.campaign.update({ where: { id: campaignId }, data: { finalCutKey: key } });
            await saveArtifact(
              campaignId, "postProduction",
              { finalCut: key, clips: clips.map((c) => ({ file: c.file.split(/[\\/]/).pop(), assetVersion: c.assetVersion })), notes: noteFor("postProduction") ?? null },
              0, runId,
            );
          } finally {
            await rm(dir, { recursive: true, force: true });
          }
        }),
      );

      // ---- Account Team QC → approval package ----
      await step.run("accountTeam", () =>
        tracked(runId, "accountTeam", attempt, async () => {
          const { payload, costUsd } = await accountTeam(brief, creative, visual, mem);
          await saveArtifact(campaignId, "accountTeam", payload, costUsd, runId);
          const pkg = { ...payload, costSoFar: await campaignSpent(campaignId) };
          await setStatus(campaignId, "AWAITING_APPROVAL", { approvalPackage: pkg });
        }),
      );

      // ---- Client decision: approve / reject end the campaign; revise / regenerate start a new run ----
      const decision = await step.waitForEvent("client-decision", {
        event: "campaign/client.decision",
        if: `async.data.campaignId == "${campaignId}"`,
        timeout: "7d",
      });
      const d = decision?.data as
        | { type: "approve" | "reject"; decisionId?: string }
        | { type: "revise"; decisionId?: string; notes: string; targetAgent?: z.infer<typeof RevisionTarget> }
        | { type: "regenerate"; decisionId?: string; shotIds: string[] }
        | undefined;

      if (d?.type === "revise") {
        const target = d.targetAgent ?? (await step.run("route-revision", async () => {
          const { payload, costUsd } = await routeRevision(d.notes);
          await saveArtifact(campaignId, "router", payload, costUsd, runId);
          return payload.target;
        }));
        await step.run("revise", async () => {
          if (d.decisionId) await db.decision.update({ where: { id: d.decisionId }, data: { targetAgent: target } });
          await setStatus(campaignId, "REVISING");
          await db.run.update({ where: { id: runId }, data: { status: "superseded", endedAt: new Date() } });
        });
        await step.sendEvent("rerun-revision", {
          name: "campaign/brief.submitted",
          data: { campaignId, from: target, notes: d.notes, reason: "revision" },
        });
        return;
      }
      if (d?.type === "regenerate") {
        await step.run("regenerate", async () => {
          await setStatus(campaignId, "REGENERATING");
          await db.run.update({ where: { id: runId }, data: { status: "superseded", endedAt: new Date() } });
        });
        // The estimate and the over-cap confirmation were checked by the server action.
        await step.sendEvent("rerun-regenerate", {
          name: "campaign/brief.submitted",
          data: { campaignId, from: "videographer", shotIds: d.shotIds, reason: "regenerate", budgetConfirmed: true },
        });
        return;
      }

      await step.run("finish", async () => {
        const status: CampaignStatus = !d ? "EXPIRED" : d.type === "approve" ? "APPROVED" : "REJECTED";
        await setStatus(campaignId, status);
        await db.run.update({ where: { id: runId }, data: { status: "done", endedAt: new Date() } });
      });
      // Episodic memory is written by its own function, so a memory failure never touches the campaign.
      if (d?.type === "approve") await step.sendEvent("approved", { name: "campaign/approved", data: { campaignId } });
    } catch (e) {
      // Permanent failure after retries are exhausted. NonRetriable/step errors are rethrown after the status is recorded.
      await step.run("mark-failed", async () => {
        // No throw here: a campaign already in a terminal status keeps it.
        await db.campaign.updateMany({ where: { id: campaignId, status: { in: allowedFrom("FAILED") } }, data: { status: "FAILED" } });
        await db.run.update({ where: { id: runId }, data: { status: "failed", endedAt: new Date() } });
      });
      throw e;
    }
  },
);
