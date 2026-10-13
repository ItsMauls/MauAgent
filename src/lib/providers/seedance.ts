// BytePlus ModelArk — Seedance video generation (async task: create → poll).
// Verify fields against the official docs: https://docs.byteplus.com/en/docs/ModelArk
import type { Shot } from "@/lib/agents/schemas";

export type Tier = "draft" | "final";

const BASE = process.env.ARK_BASE_URL ?? "https://ark.ap-southeast.bytepluses.com/api/v3";

export function seedanceConfig(tier: Tier) {
  return tier === "draft"
    ? { model: process.env.SEEDANCE_MODEL_DRAFT ?? "", resolution: process.env.SEEDANCE_RES_DRAFT ?? "720p" }
    : { model: process.env.SEEDANCE_MODEL_FINAL ?? "", resolution: process.env.SEEDANCE_RES_FINAL ?? "1080p" };
}

async function ark(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`ModelArk ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Create a generation task and return its task id. Called in its own step.run so a retry does not create a new task. */
export async function createSeedanceTask(prompt: string, shot: Shot, tier: Tier, modelOverride?: string): Promise<string> {
  const { model: envModel, resolution } = seedanceConfig(tier);
  const model = modelOverride || envModel;
  if (!model) throw new Error(`SEEDANCE_MODEL_${tier.toUpperCase()} is not set`);
  const body = {
    model,
    content: [{ type: "text", text: prompt }],
    ratio: "9:16",
    duration: Math.round(shot.durationSec),
    resolution,
    generate_audio: true,
    watermark: false,
  };
  const { id } = await ark("/contents/generations/tasks", { method: "POST", body: JSON.stringify(body) });
  return id;
}

export type TaskState = { status: "running" } | { status: "succeeded"; videoUrl: string } | { status: "failed"; error: string };

export async function getSeedanceTask(id: string): Promise<TaskState> {
  const t = await ark(`/contents/generations/tasks/${id}`);
  if (t.status === "succeeded") return { status: "succeeded", videoUrl: t.content?.video_url };
  if (t.status === "failed" || t.status === "cancelled") return { status: "failed", error: JSON.stringify(t.error ?? t.status) };
  return { status: "running" };
}
