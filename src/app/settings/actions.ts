"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { AI_ROLES, AiSettingsInput, IMAGE_PROVIDERS, ImageModels, VIDEO_PROVIDERS, VideoModels, clearAiSettingsCache, parseImageProviders, parseVideoProviders } from "@/lib/ai/settings";
import { generateStructured } from "@/lib/ai/generate";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const on = (f: FormData, k: string) => f.get(k) === "on";

// ---------- /settings/ai ----------

export async function saveAiSettings(form: FormData) {
  const overrides: Record<string, Record<string, string>> = {};
  for (const role of AI_ROLES) {
    const o = Object.fromEntries(
      (["model", "reasoningEffort", "maxOutputTokens"] as const).map((k) => [k, str(form, `${role}.${k}`)]).filter(([, v]) => v),
    );
    if (Object.keys(o).length) overrides[role] = o;
  }
  const data = AiSettingsInput.parse({
    defaultModel: str(form, "defaultModel"),
    reasoningEffort: str(form, "reasoningEffort"),
    maxOutputTokens: str(form, "maxOutputTokens"),
    temperature: str(form, "temperature"),
    perAgentOverrides: overrides,
    monthlyBudgetUsd: str(form, "monthlyBudgetUsd"),
    maxCostPerCallUsd: str(form, "maxCostPerCallUsd"),
    monthlyTokenCap: str(form, "monthlyTokenCap"),
    enableFallbackKey: on(form, "enableFallbackKey"),
  });
  await db.aiSettings.upsert({ where: { id: "default" }, create: data, update: data });
  clearAiSettingsCache();
  revalidatePath("/settings/ai");
}

export type TestResult = { ok: boolean; message: string };

/** Small real call (64 output tokens, no reasoning). Recorded in CostEntry with reason "test", caps apply. */
export async function testAiConnection(): Promise<TestResult> {
  const t0 = Date.now();
  try {
    const r = await generateStructured("test", 'Return {"ok": true}.', z.object({ ok: z.boolean() }), {
      config: { maxOutputTokens: 64, reasoningEffort: "off" },
      reason: "test",
      step: "settings-test",
    });
    revalidatePath("/settings/ai");
    return { ok: true, message: `OK in ${Date.now() - t0} ms · ${r.model} · ${r.keyLabel} key · US$${r.costUsd.toFixed(6)}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 300) : "Failed" };
  }
}

// ---------- image + video providers (/settings/ai) ----------

/** Form: `order.0..2` / `vorder.0..1` = provider id or "" (off), `model.<provider>` / `vmodel.<provider>` = optional model id. */
export async function saveImageSettings(form: FormData) {
  const imageProviders = parseImageProviders([0, 1, 2].map((i) => str(form, `order.${i}`)).join(","));
  const imageModels = ImageModels.parse(Object.fromEntries(IMAGE_PROVIDERS.map((p) => [p, str(form, `model.${p}`)]).filter(([, v]) => v)));
  const videoProviders = parseVideoProviders([0, 1].map((i) => str(form, `vorder.${i}`)).join(","));
  const videoModels = VideoModels.parse(Object.fromEntries(VIDEO_PROVIDERS.map((p) => [p, str(form, `vmodel.${p}`)]).filter(([, v]) => v)));
  const data = { imageProviders: imageProviders.join(","), imageModels, videoProviders: videoProviders.join(","), videoModels };
  await db.aiSettings.upsert({ where: { id: "default" }, create: data, update: data });
  clearAiSettingsCache();
  revalidatePath("/settings/ai");
}
