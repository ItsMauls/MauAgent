// Automation campaigns, DB side of generation: claim the posts inside the generation window, write and QC one slot,
// budget gates, the pilot hand-off and the owner's decisions. The Inngest functions in
// src/lib/workflows/automationGenerate.ts call these, one step per slot.
import { Prisma, type AutomationPause, type AutomationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { AiBudgetError, generateStructured } from "@/lib/ai/generate";
import { budgetGate, monthSpent } from "@/lib/cost";
import { dbDeps } from "@/lib/content/generate";
import { writeFeedback } from "@/lib/boards/feedback";
import { getSettings } from "@/lib/settings";
import type { ContentType, Cta } from "@/lib/agents/schemas";
import { GenerationConfig, Goal, QcConfig, ReviewPolicy } from "./config";
import { runPost } from "./pipeline";
import { qcRules } from "./qc";
import { QcVerdict } from "./qcJudge";
import { allowedFromAuto, GENERATING } from "./status";
import { estimatePostUsd } from "./store";

const DAY = 86_400_000;

/** Lifecycle change guarded by the transition table (atomic: the WHERE only matches allowed source statuses). */
export async function setAutomationStatus(id: string, to: AutomationStatus, extra: Prisma.AutomationCampaignUpdateManyMutationInput = {}) {
  const { count } = await db.automationCampaign.updateMany({ where: { id, status: { in: allowedFromAuto(to) } }, data: { ...extra, status: to } });
  if (!count) {
    const c = await db.automationCampaign.findUniqueOrThrow({ where: { id }, select: { status: true } });
    throw new Error(`Cannot move this campaign from ${c.status.replace("_", " ")} to ${to.replace("_", " ")}`);
  }
}

const pause = (id: string, reason: AutomationPause) =>
  db.automationCampaign.updateMany({ where: { id, status: { in: GENERATING } }, data: { status: "paused", pauseReason: reason } });

export const loadCampaign = async (id: string) => {
  const c = await db.automationCampaign.findUniqueOrThrow({ where: { id } });
  return {
    ...c, goal: Goal.parse(c.goal), policy: ReviewPolicy.parse(c.reviewPolicy), qc: QcConfig.parse(c.qcConfig), gen: GenerationConfig.parse(c.generationConfig),
  };
};

/**
 * Claims the slots to generate now (planned → generating, atomically) and splits them into chunks. The pilot takes its
 * flagged slots; a running campaign takes the slots due within horizonDays. Returns [] when nothing is due.
 */
export async function claimWindow(id: string, now = new Date()): Promise<number[][]> {
  const c = await loadCampaign(id);
  if (!GENERATING.includes(c.status)) return [];
  const where: Prisma.CampaignPostWhereInput = c.status === "piloting"
    ? { automationCampaignId: id, status: "planned", pilot: true }
    : { automationCampaignId: id, status: "planned", scheduledAt: { lt: new Date(now.getTime() + c.gen.horizonDays * DAY) } };
  const slots = [...new Set((await db.campaignPost.findMany({ where, select: { slot: true }, orderBy: { slot: "asc" } })).map((r) => r.slot))];
  if (!slots.length) return [];
  await db.campaignPost.updateMany({ where: { automationCampaignId: id, slot: { in: slots }, status: "planned" }, data: { status: "generating" } });
  const chunks: number[][] = [];
  for (let i = 0; i < slots.length; i += c.gen.chunkSize) chunks.push(slots.slice(i, i + c.gen.chunkSize));
  return chunks;
}

/** Puts claimed slots that were not written back to planned (pause, cancel, budget stop, failed run). */
export const releaseSlots = (id: string, slots: number[]) =>
  db.campaignPost.updateMany({ where: { automationCampaignId: id, slot: { in: slots }, status: { in: ["generating", "qc"] } }, data: { status: "planned" } });

export const automationSpent = async (id: string) => Number((await db.costEntry.aggregate({ where: { automationCampaignId: id }, _sum: { usd: true } }))._sum.usd ?? 0);

/** Measured average cost of a generated slot (null before the first one). */
export async function avgSlotUsd(id: string, firstAccount: string) {
  const a = await db.campaignPost.aggregate({ where: { automationCampaignId: id, socialAccountId: firstAccount, status: { notIn: ["planned", "generating", "qc", "cancelled"] } }, _avg: { costUsd: true }, _count: true });
  return a._count ? Number(a._avg.costUsd ?? 0) : null;
}

/** Monthly cap first (all providers), then the campaign cap. The LLM caps still apply per call in generateStructured. */
async function budgetStop(c: Awaited<ReturnType<typeof loadCampaign>>): Promise<AutomationPause | null> {
  const [spent, month, s, avg] = await Promise.all([automationSpent(c.id), monthSpent(), getSettings(), avgSlotUsd(c.id, c.goal.accountIds[0])]);
  const estUsd = avg ?? (await estimatePostUsd()) ?? 0;
  const g = budgetGate({ estUsd, spentUsd: spent, capUsd: Number(c.budgetCapUsd), monthSpentUsd: month, monthCapUsd: Number(s.monthlyBudgetUsd) });
  if (!g.blocked) return null;
  return g.monthUsd > Number(s.monthlyBudgetUsd) ? "quota" : "budget";
}

/** The newest written texts of this campaign (one per slot), newest first. */
async function campaignTexts(id: string, firstAccount: string, take: number) {
  const rows = await db.campaignPost.findMany({
    where: { automationCampaignId: id, socialAccountId: firstAccount, text: { not: null } }, orderBy: { updatedAt: "desc" }, take, select: { text: true, thread: true },
  });
  return rows.map((r) => [r.text, ...r.thread].join("\n"));
}

export type SlotResult = { stopped?: string; status?: string; confidence?: number | null };

/** A regenerate the owner asked for may also run while the pilot waits for scale-up. */
const MANUAL_OK: AutomationStatus[] = [...GENERATING, "awaiting_scale"];

/** Writes and QCs one slot (all its account rows). Idempotent: a retried step reuses every stored LLM output. */
export async function processSlot(id: string, slot: number, manual = false): Promise<SlotResult> {
  const c = await loadCampaign(id);
  if (!(manual ? MANUAL_OK : GENERATING).includes(c.status)) {
    await releaseSlots(id, [slot]);
    return { stopped: `campaign is ${c.status}` };
  }
  const stop = await budgetStop(c);
  if (stop) {
    await pause(id, stop);
    await releaseSlots(id, [slot]);
    return { stopped: stop === "budget" ? "campaign budget reached" : "monthly budget reached" };
  }
  const rows = await db.campaignPost.findMany({ where: { automationCampaignId: id, slot }, orderBy: { scheduledAt: "asc" } });
  const head = rows[0];
  if (!head || !["generating", "qc"].includes(head.status)) return { stopped: `slot is ${head?.status ?? "missing"}` };
  await db.campaignPost.updateMany({ where: { automationCampaignId: id, slot, status: "generating" }, data: { status: "qc" } });

  const first = c.goal.accountIds[0];
  const recent = await campaignTexts(id, first, 50);
  // Dedup corpus: this campaign's posts plus every post of the last 30 days (not only the last 50 artifacts).
  const corpus = await campaignTexts(id, first, 2000);
  const base = `auto:${id}:s${slot}`;
  let out;
  try {
    out = await runPost(
      {
        campaignId: id, slot, type: head.contentType as ContentType, angles: head.angles, cta: head.cta as Cta | null, pillar: head.pillar ?? head.topicSeed,
        pilot: head.pilot, retryCount: head.retryCount, platforms: [...new Set(rows.map((r) => r.platform))] as ("twitter" | "threads")[],
        goal: c.goal, policy: c.policy, qc: c.qc, gen: c.gen, recent,
      },
      { idemKey: base, automationCampaignId: id, step: "automation" },
      {
        content: { ...dbDeps, recentTexts: async (days) => [...corpus, ...(await dbDeps.recentTexts(days))] },
        rules: qcRules,
        qcJudge: (prompt, ctx) => generateStructured("postQc", prompt, QcVerdict, { ...ctx, config: { temperature: ctx.temperature } }),
      },
    );
  } catch (e) {
    if (!(e instanceof AiBudgetError)) throw e;
    await pause(id, "quota");
    await releaseSlots(id, [slot]);
    return { stopped: e.message };
  }

  const cost = Number((await db.costEntry.aggregate({ where: { idemKey: { startsWith: `${base}:` } }, _sum: { usd: true } }))._sum.usd ?? 0);
  const approved = out.status === "approved";
  await db.campaignPost.updateMany({
    where: { automationCampaignId: id, slot, status: { in: ["generating", "qc"] } },
    data: {
      status: out.status, text: out.text, thread: out.thread, variants: out.alternatives as Prisma.InputJsonValue, sourceNote: out.sourceNote,
      qcReport: out.qcReport as Prisma.InputJsonValue, confidence: out.confidence, retryCount: out.retryCount, failureReason: out.failureReason, costUsd: cost,
      ...(approved && { approvalSource: "qc_auto", approvedAt: new Date(), approvalPolicySnapshot: { policy: c.policy, qc: c.qc, confidence: out.confidence } }),
    },
  });
  return { status: out.status, confidence: out.confidence };
}

/**
 * Sends a reviewed or rejected slot back for a fresh write: one more round (new idemKeys), cleared text, QC and
 * approval. Returns the new round, or null when the slot was not in a state that can be regenerated.
 */
export async function requeueSlot(id: string, slot: number) {
  const c = await loadCampaign(id);
  if (!MANUAL_OK.includes(c.status)) throw new Error(`The campaign is ${c.status.replace("_", " ")}: resume it first`);
  const head = await db.campaignPost.findFirst({ where: { automationCampaignId: id, slot }, orderBy: { scheduledAt: "asc" } });
  if (!head || !["needs_review", "rejected"].includes(head.status)) throw new Error(`Post ${slot + 1} cannot be regenerated now`);
  const round = head.retryCount + 1;
  const { count } = await db.campaignPost.updateMany({
    where: { automationCampaignId: id, slot, status: { in: ["needs_review", "rejected"] } },
    data: {
      status: "generating", retryCount: round, text: null, thread: [], variants: Prisma.DbNull, sourceNote: null, qcReport: Prisma.DbNull, confidence: null,
      approvalSource: null, approvalPolicySnapshot: Prisma.DbNull, approvedAt: null, humanDecision: null, failureReason: null,
    },
  });
  return count ? round : null;
}

/** Ends the pilot once every pilot slot has a result. */
export async function finishPilotIfDone(id: string) {
  const open = await db.campaignPost.count({ where: { automationCampaignId: id, pilot: true, status: { in: ["planned", "generating", "qc"] } } });
  if (open) return false;
  const { count } = await db.automationCampaign.updateMany({ where: { id, status: "piloting" }, data: { status: "awaiting_scale" } });
  return count > 0;
}

/**
 * The owner's decision on a slot QC sent to review. Stored on every row of the slot with the policy snapshot; whether
 * QC would have approved it on its own is recorded for calibration, and the decision becomes feedback for Post QC (and
 * for the Socmed Specialist when a post is rejected).
 */
export async function decideSlot(id: string, slot: number, decision: "approved" | "rejected", note = "") {
  const c = await loadCampaign(id);
  const head = await db.campaignPost.findFirst({ where: { automationCampaignId: id, slot }, orderBy: { scheduledAt: "asc" } });
  if (!head || head.status !== "needs_review") throw new Error(`Post ${slot + 1} is not waiting for review`);
  if (decision === "approved" && !head.text?.trim()) throw new Error(`Post ${slot + 1} has no text: regenerate it first`);
  const report = (head.qcReport ?? {}) as { verdict?: string; rules?: { pass: boolean; severity: string }[] };
  const qcWouldApprove = report.verdict === "pass" && (head.confidence ?? 0) >= c.qc.minConfidence && !(report.rules ?? []).some((r) => !r.pass && r.severity === "fail");
  const agreed = qcWouldApprove === (decision === "approved");
  const { count } = await db.campaignPost.updateMany({
    where: { automationCampaignId: id, slot, status: "needs_review" },
    data: {
      status: decision, humanDecision: decision, qcAgreed: agreed,
      ...(decision === "approved" && { approvalSource: "human", approvedAt: new Date(), approvalPolicySnapshot: { policy: c.policy, qc: c.qc, decidedBy: "owner" } }),
    },
  });
  if (!count) return;
  const what = `Automation post "${head.text?.slice(0, 120) ?? "(no text)"}" (${head.contentType}, campaign "${c.name}")`;
  await writeFeedback({
    agentRole: "postQc", source: "client_decision", sentiment: agreed ? "positive" : "negative", idemKey: `auto-decision:${head.id}`,
    text: `${what}: the owner ${decision} it; QC ${qcWouldApprove ? "would have approved" : "sent it to review"} (confidence ${Math.round((head.confidence ?? 0) * 100)}%).${note ? ` Note: ${note}` : ""}`,
  });
  if (decision === "rejected")
    await writeFeedback({ agentRole: "socmedSpecialist", source: "client_decision", sentiment: "negative", idemKey: `auto-reject:${head.id}`, text: `${what} was rejected by the owner.${note ? ` Note: ${note}` : ""}` });
}

/** QC-vs-human agreement on decided slots (calibration of the threshold). */
export async function agreement(id: string, firstAccount: string) {
  const rows = await db.campaignPost.groupBy({ by: ["qcAgreed"], where: { automationCampaignId: id, socialAccountId: firstAccount, qcAgreed: { not: null } }, _count: true });
  const yes = rows.find((r) => r.qcAgreed)?._count ?? 0;
  const total = rows.reduce((n, r) => n + r._count, 0);
  return { agreed: yes, total, rate: total ? yes / total : null };
}
