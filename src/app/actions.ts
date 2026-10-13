"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { generateCharacterViews } from "@/lib/ai/image";
import { db } from "@/lib/db";
import { ASSET_FIELDS, IMAGE_VIEWS } from "@/lib/creativeFields";
import { inngest } from "@/lib/inngest";
import { z } from "zod";
import { BudgetDecisionInput, ClientBrief, DecisionInput, VideoSource, type PromptPackage } from "@/lib/agents/schemas";
import { saveArtifact } from "@/lib/agents";
import { presignPut } from "@/lib/s3";
import { uploadImage } from "@/lib/cloudinary";
import { syncBufferAccounts } from "@/lib/bufferAccounts";
import { PublishTarget } from "@/lib/publish";
import { checkTargets, createPublishJobs, createRetryJob } from "@/lib/publishPlan";
import { recordAsset } from "@/lib/assets";
import { campaignSpent, estimateRegenerate, videoPricePerSec } from "@/lib/cost";
import { seedanceConfig } from "@/lib/providers/seedance";
import { getSettings as loadSettings } from "@/lib/settings";

export async function getSettings() {
  return loadSettings();
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
  // Multi-select chips + optional free-text detail collapse into the single string the agents read.
  const merge = (chips: string, detail: string) =>
    [form.getAll(chips).map(String).join("; "), String(form.get(detail) ?? "").trim()].filter(Boolean).join(". ");
  const startDate = String(form.get("startDate") ?? "");
  const deadline = String(form.get("deadline") ?? "");
  if (startDate && deadline && startDate > deadline) throw new Error("Campaign end date must be on or after the start date");
  const objective = merge("goals", "objective");
  const audience = merge("audiences", "audience");
  if (!objective) throw new Error("Pick at least one business goal or describe the goal");
  if (!audience) throw new Error("Pick at least one target audience or describe the audience");
  const brief = ClientBrief.parse({
    objective,
    product: form.get("product"),
    audience,
    kpi: form.get("kpi") ?? "",
    platforms: form.getAll("platforms"),
    budgetCapUsd: Number(form.get("budgetCapUsd")),
    startDate,
    deadline,
    references: lines("references"),
    defaultSource: form.get("defaultSource"),
  });
  const c = await db.campaign.create({
    data: {
      clientBrief: brief,
      budgetCapUsd: brief.budgetCapUsd,
      defaultSource: brief.defaultSource,
      creativeAssets: { connect: form.getAll("creativeAssetIds").map((id) => ({ id: String(id) })) },
    },
  });
  try {
    await inngest.send({ name: "campaign/brief.submitted", data: { campaignId: c.id } });
  } catch (e) {
    // Inngest unreachable: do not leave the campaign sitting at "not started".
    await db.campaign.update({ where: { id: c.id }, data: { status: "FAILED" } });
    console.error("[createCampaign] inngest.send failed", e);
  }
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
  if (d.type === "approve" && d.publishTargets?.length) await checkTargets(d.publishTargets); // fail here, not later inside the pipeline
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

const AccountInput = z.object({
  publisher: z.enum(["instagram_graph", "tiktok_inbox", "orshot", "buffer"]),
  brandKitId: z.string().min(1).nullable(),
  accountType: z.enum(["BUSINESS", "CREATOR", "MEDIA_CREATOR"]).nullable(),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "Unknown time zone"),
  tiktokAuditStatus: z.enum(["not_submitted", "pending", "approved", "rejected"]).nullable(),
});

export async function updateAccount(id: string, input: z.infer<typeof AccountInput>) {
  const d = AccountInput.parse(input);
  const a = await db.socialAccount.findUniqueOrThrow({ where: { id: z.string().parse(id) }, select: { platform: true } });
  if (d.publisher === "instagram_graph" && a.platform !== "instagram") throw new Error("Instagram Graph can only publish to Instagram");
  if (d.publisher === "tiktok_inbox" && a.platform !== "tiktok") throw new Error("TikTok inbox can only publish to TikTok");
  await db.socialAccount.update({ where: { id }, data: { ...d, tiktokAuditStatus: a.platform === "tiktok" ? d.tiktokAuditStatus : null } });
  revalidatePath("/accounts");
}

/** Deactivate keeps the row and its publish history; nothing is deleted. */
export async function setAccountActive(id: string, active: boolean) {
  await db.socialAccount.update({ where: { id: z.string().parse(id) }, data: { active: z.boolean().parse(active) } });
  revalidatePath("/accounts");
}

/** Boards "Check": runs the free integration health checks in Inngest; the card reads the cached result. */
export async function checkIntegrations() {
  await inngest.send({ name: "integrations/check", data: {} });
}

export async function refreshAccounts(accountId?: string) {
  await inngest.send({ name: "accounts/refresh", data: { accountId: z.string().optional().parse(accountId) } });
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

const CreativeAssetInput = z.object({
  kind: z.enum(["character", "location", "style"]),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(1500),
  imageUrls: z.array(z.url({ protocol: /^https$/ })).max(12),
});

/** Uploads the filled view slots (img:<view>) to Cloudinary and returns their URLs (tagged ?v=<view>), in view order. */
async function uploadViews(kind: keyof typeof IMAGE_VIEWS, form: FormData) {
  const urls: string[] = [];
  for (const v of IMAGE_VIEWS[kind]) {
    const file = form.get(`img:${v}`);
    if (!(file instanceof File) || !file.size) continue;
    if (!file.type.startsWith("image/") || file.size > 8_000_000) throw new Error(`${v}: images only, max 8 MB`);
    urls.push(`${await uploadImage(file)}?v=${encodeURIComponent(v)}`);
  }
  return urls;
}

/** AI Content Creator: add a character, location or video style to the library. */
export async function saveCreativeAsset(form: FormData) {
  const kind = CreativeAssetInput.shape.kind.parse(form.get("kind"));
  const lines = ASSET_FIELDS[kind].map((x) => [x.label, form.getAll(`f_${kind}_${x.key}`).map(String).join(", ")]).filter(([, v]) => v).map(([l, v]) => `${l}: ${v}`);
  const notes = String(form.get("description") ?? "").trim();
  const data = CreativeAssetInput.parse({
    kind,
    name: form.get("name"),
    description: [...lines, notes].filter(Boolean).join("\n"),
    imageUrls: await uploadViews(kind, form),
  });
  const campaignIds = form.getAll("campaignId").map(String).filter(Boolean);
  const asset = await db.creativeAsset.create({ data: { ...data, campaigns: { connect: campaignIds.map((id) => ({ id })) } } });
  // Characters get a generated turnaround for the views the owner did not upload; runs after the response.
  if (kind === "character") after(() => generateCharacterViews(asset.id).catch((e) => console.error("character image generation failed:", e)));
  campaignIds.forEach((id) => revalidatePath(`/campaigns/${id}`));
  revalidatePath("/boards", "layout");
}

export async function deleteCreativeAsset(form: FormData) {
  await db.creativeAsset.delete({ where: { id: z.string().min(1).parse(form.get("id")) } });
  revalidatePath("/boards", "layout");
}

/** Link or unlink a library item to a campaign. Applies from the next Art Director run of that campaign. */
export async function linkCreativeAsset(form: FormData) {
  const id = z.string().min(1).parse(form.get("id"));
  const campaignId = z.string().min(1).parse(form.get("campaignId"));
  const op = form.get("unlink") ? "disconnect" : "connect";
  await db.creativeAsset.update({ where: { id }, data: { campaigns: { [op]: { id: campaignId } } } });
  revalidatePath("/boards", "layout");
  revalidatePath(`/campaigns/${campaignId}`);
}

/** Accounts page: pull the channels linked in Buffer. */
export async function syncBuffer() {
  const r = await syncBufferAccounts();
  revalidatePath("/accounts");
  revalidatePath("/boards", "layout");
  return r;
}

const PublishPlan = z.object({
  campaignId: z.string().min(1),
  targets: z.array(PublishTarget).min(1, "Pick at least one account"),
});

/** Content Creator: publish an approved campaign through Buffer (queue, exact time, draft or now). */
export async function planPublish(input: z.input<typeof PublishPlan>) {
  const d = PublishPlan.parse(input);
  const jobs = await createPublishJobs(d.campaignId, d.targets);
  if (jobs.some((j) => !j.created)) throw new Error("Some of these accounts are already planned for this campaign");
  await inngest.send(jobs.map((j) => ({ name: "publish/job", data: { jobId: j.id } })));
  revalidatePath("/", "layout");
}

/** New attempt for a channel whose last attempt failed before Buffer accepted anything. */
export async function retryPublish(jobId: string) {
  const jobs = await createRetryJob(z.string().min(1).parse(jobId));
  await inngest.send(jobs.filter((j) => j.created).map((j) => ({ name: "publish/job", data: { jobId: j.id } })));
  revalidatePath("/", "layout");
}

/** Cancel a job that has not started yet; the sleeping Inngest run then skips it. */
export async function cancelPublish(jobId: string) {
  const { count } = await db.publishJob.updateMany({ where: { id: z.string().parse(jobId), status: { in: ["draft", "scheduled"] }, postId: null }, data: { status: "failed", error: "Cancelled" } });
  if (!count) throw new Error("Already started; manage it in Buffer");
  revalidatePath("/boards", "layout");
}
