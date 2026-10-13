// Video generation with provider fallback (BytePlus Seedance, Magic Hour), chosen in /settings/ai.
// Task ids are "<provider>:<id>" so polling knows where to ask; a bare id is a legacy Seedance task.
// ponytail: fallback happens when the task is created (trial out, 402, no key). A task that later fails while rendering
// leaves the slot open for manual upload, as before; add re-submit to the next provider if that happens often.
import type { Shot } from "@/lib/agents/schemas";
import { getAiSettings, parseVideoProviders, VideoModels, type VideoProvider } from "@/lib/ai/settings";
import { createSeedanceTask, getSeedanceTask, seedanceConfig, type TaskState, type Tier } from "./seedance";

const MH = "https://api.magichour.ai/v1";
const mhHeaders = () => {
  const key = process.env.MAGIC_HOUR_API_KEY;
  if (!key) throw new Error("MAGIC_HOUR_API_KEY is not set");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
};
const mh = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${MH}${path}`, { ...init, headers: mhHeaders(), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Magic Hour ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

/** Returns the task id and the provider/model that accepted it. */
export async function createVideoTask(prompt: string, shot: Shot, tier: Tier) {
  const s = await getAiSettings();
  const models = VideoModels.catch({}).parse(s.videoModels);
  const errors: string[] = [];
  for (const provider of parseVideoProviders(s.videoProviders)) {
    try {
      if (provider === "byteplus") {
        return { taskId: `byteplus:${await createSeedanceTask(prompt, shot, tier, models.byteplus)}`, provider, model: models.byteplus || seedanceConfig(tier).model };
      }
      const model = models.magichour || "default";
      const { id } = await mh("/text-to-video", {
        method: "POST",
        body: JSON.stringify({ end_seconds: Math.round(shot.durationSec), aspect_ratio: "9:16", resolution: "720p", model, audio: true, style: { prompt } }),
      });
      return { taskId: `magichour:${id}`, provider, model };
    } catch (e) {
      errors.push(`${provider}: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error(`All video providers failed. ${errors.join(" | ") || "No video provider is enabled in /settings/ai."}`);
}

export async function getVideoTask(taskId: string): Promise<TaskState> {
  const [provider, ...rest] = taskId.includes(":") ? taskId.split(":") : ["byteplus", taskId];
  const id = rest.join(":") || taskId;
  if ((provider as VideoProvider) === "byteplus") return getSeedanceTask(id);
  const p = await mh(`/video-projects/${id}`);
  if (p.status === "complete" && p.downloads?.[0]?.url) return { status: "succeeded", videoUrl: p.downloads[0].url };
  if (p.status === "error" || p.status === "canceled") return { status: "failed", error: p.error?.message ?? p.status };
  return { status: "running" };
}
