"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { z } from "zod";
import { BudgetDecisionInput, ClientBrief, DecisionInput, VideoSource, type PromptPackage } from "@/lib/agents/schemas";
import { saveArtifact } from "@/lib/agents";
import { presignPut } from "@/lib/s3";
import { recordAsset } from "@/lib/assets";
import { campaignSpent, estimateRegenerate, videoPricePerSec } from "@/lib/cost";
import { seedanceConfig } from "@/lib/providers/seedance";

export async function getSettings() {
  return db.setting.upsert({ where: { id: "default" }, create: {}, update: {} });
}

export async function saveSettings(form: FormData) {
  const data = {
    campaignBudgetUsd: Number(form.get("campaignBudgetUsd")),
    monthlyBudgetUsd: Number(form.get("monthlyBudgetUsd")),
    defaultVideoSource: VideoSource.parse(form.get("defaultVideoSource")),
  };
  if (!(data.campaignBudgetUsd > 0 && data.monthlyBudgetUsd > 0)) throw new Error("Budget must be > 0");
  await db.setting.upsert({ where: { id: "default" }, create: data, update: data });
  revalidatePath("/settings");
}

export async function createCampaign(form: FormData) {
  const lines = (k: string) => String(form.get(k) ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const brief = ClientBrief.parse({
    objective: form.get("objective"),
    product: form.get("product"),
    audience: form.get("audience"),
    kpi: form.get("kpi") ?? "",
    platforms: form.getAll("platforms"),
    budgetCapUsd: Number(form.get("budgetCapUsd")),
    deadline: form.get("deadline") ?? "",
    references: lines("references"),
    defaultSource: form.get("defaultSource"),
  });
  const c = await db.campaign.create({
    data: { clientBrief: brief, budgetCapUsd: brief.budgetCapUsd, defaultSource: brief.defaultSource },
  });
  await inngest.send({ name: "campaign/brief.submitted", data: { campaignId: c.id } });
  redirect(`/campaigns/${c.id}`);
}

export async function getUploadUrl(shotDbId: string) {
  const shot = await db.shot.findUniqueOrThrow({ where: { id: shotDbId } });
  const key = `campaigns/${shot.campaignId}/${shot.shotId}/upload-${Date.now()}.mp4`;
  return { key, url: await presignPut(key) };
}

export async function confirmUpload(shotDbId: string, key: string) {
  const shot = await db.shot.findUniqueOrThrow({ where: { id: shotDbId } });
  if (!key.startsWith(`campaigns/${shot.campaignId}/${shot.shotId}/`)) throw new Error("Invalid key");
  const used = await db.shotAsset.count({ where: { shotId: shot.id, origin: "upload" } });
  if (used >= shot.maxAttempts) return { ok: false, errors: [`The limit of ${shot.maxAttempts} attempts for this shot has been reached.`] };

  const expected = (shot.promptPackage as { durationSec?: number } | null)?.durationSec ?? 8;
  const res = await recordAsset(shot.id, key, "upload", expected);

  if (res.ok && (await db.shot.count({ where: { campaignId: shot.campaignId, status: { not: "ready" } } })) === 0)
    await inngest.send({ name: "campaign/assets.complete", data: { campaignId: shot.campaignId } });
  revalidatePath(`/campaigns/${shot.campaignId}`);
  return res;
}

/** Deterministic regenerate estimate from PriceBook (also re-checked inside decide()). */
export async function getRegenerateEstimate(campaignId: string, shotIds: string[]) {
  const ids = z.array(z.string().min(1)).min(1).parse(shotIds);
  const [c, shots] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    db.shot.findMany({ where: { campaignId, shotId: { in: ids } } }),
  ]);
  if (shots.length !== ids.length) throw new Error("Unknown shot");
  const { model } = seedanceConfig("draft");
  return estimateRegenerate({
    shots: shots.map((s) => ({ source: s.source, durationSec: (s.promptPackage as PromptPackage | null)?.durationSec ?? 8 })),
    pricePerSec: await videoPricePerSec(model),
    model: model || "(SEEDANCE_MODEL_DRAFT not set)",
    spentUsd: await campaignSpent(campaignId),
    capUsd: Number(c.budgetCapUsd),
  });
}

export async function decide(campaignId: string, input: DecisionInput) {
  const d = DecisionInput.parse(input);
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (c.status !== "AWAITING_APPROVAL") throw new Error("Campaign is not awaiting approval");
  if (d.type === "regenerate") {
    const est = await getRegenerateEstimate(campaignId, d.shotIds);
    if (est.overCap && !d.confirmOverCap) throw new Error(`Regenerate would bring the total to US$${est.totalUsd} (cap US$${est.capUsd}). Confirm to continue.`);
  }
  const row = await db.decision.create({
    data: {
      campaignId,
      type: d.type,
      notes: "notes" in d ? d.notes : null,
      targetAgent: d.type === "revise" ? d.targetAgent : null,
      shotIds: d.type === "regenerate" ? d.shotIds : [],
    },
  });
  await inngest.send({ name: "campaign/client.decision", data: { campaignId, decisionId: row.id, ...d } });
  revalidatePath("/", "layout");
}

export async function budgetDecision(campaignId: string, input: BudgetDecisionInput) {
  const d = BudgetDecisionInput.parse(input);
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (c.status !== "AWAITING_BUDGET") throw new Error("Campaign is not waiting on the budget gate");
  if (d.action === "raiseCap") await db.campaign.update({ where: { id: campaignId }, data: { budgetCapUsd: d.newCapUsd } });
  // A raised cap means "proceed with the new cap"; the user already saw the breakdown.
  await inngest.send({ name: "campaign/budget.decision", data: { campaignId, action: d.action === "cancel" ? "cancel" : "proceed" } });
  revalidatePath("/", "layout");
}

/** Free restore: make an older final cut current again (no generation, no cost). */
export async function restoreFinalCut(campaignId: string, version: number) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (c.status !== "AWAITING_APPROVAL") throw new Error("Only possible while awaiting approval");
  const a = await db.artifact.findUniqueOrThrow({
    where: { campaignId_agentRole_version: { campaignId, agentRole: "postProduction", version: z.number().int().parse(version) } },
  });
  const payload = { ...(a.payload as { finalCut: string }), restoredFrom: version };
  await saveArtifact(campaignId, "postProduction", payload);
  await db.campaign.update({ where: { id: campaignId }, data: { finalCutKey: payload.finalCut } });
  revalidatePath("/", "layout");
}

/** Free restore: copy an older valid shot asset as the newest version (used by the next post-production). */
export async function restoreShotAsset(assetId: string) {
  const a = await db.shotAsset.findUniqueOrThrow({ where: { id: z.string().parse(assetId) }, include: { shot: true } });
  if (!(a.validation as { ok?: boolean } | null)?.ok) throw new Error("Only a version that passed validation can be restored");
  const last = await db.shotAsset.findFirstOrThrow({ where: { shotId: a.shotId }, orderBy: { version: "desc" } });
  await db.shotAsset.create({
    data: {
      shotId: a.shotId, version: last.version + 1, s3Key: a.s3Key, durationSec: a.durationSec, hasAudio: a.hasAudio,
      origin: a.origin, validation: { ...(a.validation as object), restoredFrom: a.version },
    },
  });
  await db.shot.update({ where: { id: a.shotId }, data: { status: "ready" } });
  revalidatePath(`/campaigns/${a.shot.campaignId}`);
}
