"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { ClientBrief, VideoSource } from "@/lib/agents/schemas";
import { presignPut } from "@/lib/s3";
import { recordAsset } from "@/lib/assets";

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

export async function decide(campaignId: string, type: "approve" | "reject", notes = "") {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (c.status !== "AWAITING_APPROVAL") throw new Error("Campaign is not awaiting approval");
  await db.decision.create({ data: { campaignId, type, notes } });
  await inngest.send({ name: "campaign/client.decision", data: { campaignId, type } });
  revalidatePath(`/campaigns/${campaignId}`);
}
