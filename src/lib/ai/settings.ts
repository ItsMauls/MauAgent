// AI settings from /settings/ai (DB) merged with env defaults. Read through a short cache so a change applies
// within seconds, without a restart.
import { z } from "zod";
import { db } from "@/lib/db";
import { aiEnv } from "./env";
import { EFFORTS, type Effort, type ReasoningMeta } from "./effort";

/** LLM roles that can be tuned. `router` is the revision router; the Producer has no LLM (deterministic). */
export const AI_ROLES = ["accountManager", "creativeDirector", "artDirector", "accountTeam", "router", "socmedSpecialist", "contentJudge", "postQc"] as const;
export type AiRole = (typeof AI_ROLES)[number];
export const AI_ROLE_LABEL: Record<AiRole, string> = {
  accountManager: "Account Manager",
  creativeDirector: "Creative Director",
  artDirector: "Art Director",
  accountTeam: "Account Team (QC)",
  router: "Revision router",
  socmedSpecialist: "Socmed Specialist (text posts)",
  contentJudge: "Text-post judge",
  postQc: "Post QC (automation)",
};

export const MAX_OUTPUT_TOKENS = { min: 256, max: 32000 };
const Tokens = z.coerce.number().int().min(MAX_OUTPUT_TOKENS.min).max(MAX_OUTPUT_TOKENS.max);
const EffortSchema = z.enum(EFFORTS as [Effort, ...Effort[]]);
const Model = z.string().trim().max(200).regex(/^[\w.:/-]*$/, "Invalid model id");

const Override = z.object({ model: Model.optional(), reasoningEffort: EffortSchema.optional(), maxOutputTokens: Tokens.optional() });
export const AiOverrides = z.partialRecord(z.enum(AI_ROLES), Override);
export type AiOverrides = z.infer<typeof AiOverrides>;

/** Everything the /settings/ai form can change. */
export const AiSettingsInput = z.object({
  defaultModel: Model.transform((v) => v || null),
  reasoningEffort: EffortSchema,
  maxOutputTokens: Tokens,
  temperature: z.coerce.number().min(0).max(2),
  perAgentOverrides: AiOverrides,
  monthlyBudgetUsd: z.coerce.number().min(0).max(100000),
  maxCostPerCallUsd: z.coerce.number().min(0).max(1000),
  monthlyTokenCap: z.coerce.number().int().min(0).max(1e10),
  enableFallbackKey: z.boolean(),
});
export type AiSettingsInput = z.infer<typeof AiSettingsInput>;

export type AiSettingsRow = Awaited<ReturnType<typeof loadRow>>;
const loadRow = () => db.aiSettings.upsert({ where: { id: "default" }, create: {}, update: {} });

const TTL_MS = 30_000;
let cache: { at: number; row: AiSettingsRow } | null = null;

export async function getAiSettings() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.row;
  cache = { at: Date.now(), row: await loadRow() };
  return cache.row;
}
export const clearAiSettingsCache = () => void (cache = null);

/** topP is never set from Settings; a caller passes it per call (content types set it per type). */
export type AiConfig = { model: string; reasoningEffort: Effort; maxOutputTokens: number; temperature: number; topP?: number };

/** Pure merge: env default model < DB global < per-agent override. */
export function mergeAiConfig(role: string, envModel: string, s: Pick<AiSettingsRow, "defaultModel" | "reasoningEffort" | "maxOutputTokens" | "temperature" | "perAgentOverrides">): AiConfig {
  const parsed = AiOverrides.safeParse(s.perAgentOverrides);
  const o = (parsed.success ? parsed.data : {})[role as AiRole] ?? {};
  return {
    model: o.model || s.defaultModel || envModel,
    reasoningEffort: o.reasoningEffort ?? s.reasoningEffort,
    maxOutputTokens: o.maxOutputTokens ?? s.maxOutputTokens,
    temperature: s.temperature,
  };
}

export async function resolveAiConfig(role: string) {
  return mergeAiConfig(role, aiEnv().AI_MODEL, await getAiSettings());
}

// ---------- model metadata (/models: pricing per token + reasoning support), cached 1 h ----------

export type ModelMeta = { promptUsdPerToken: number; completionUsdPerToken: number; reasoning: ReasoningMeta; supportsJsonSchema: boolean };
type RawModel = { id: string; pricing?: { prompt?: string; completion?: string }; reasoning?: ReasoningMeta; supported_parameters?: string[] };

let models: { at: number; byId: Map<string, RawModel> } | null = null;

/** Unknown model (or /models unreachable) = no price, no reasoning param, JSON schema still requested. */
export async function modelMeta(model: string, fetchImpl: typeof fetch = fetch): Promise<ModelMeta> {
  if (!models || Date.now() - models.at > 3_600_000) {
    try {
      // Public endpoint: no key needed.
      const res = await fetchImpl(`${aiEnv().AI_BASE_URL}/models`, { signal: AbortSignal.timeout(10_000) });
      const data = ((await res.json()) as { data?: RawModel[] }).data ?? [];
      models = { at: Date.now(), byId: new Map(data.map((m) => [m.id, m])) };
    } catch {
      models = { at: Date.now() - 3_000_000, byId: models?.byId ?? new Map() }; // retry in ~10 min
    }
  }
  const m = models.byId.get(model);
  return {
    promptUsdPerToken: Number(m?.pricing?.prompt ?? 0) || 0,
    completionUsdPerToken: Number(m?.pricing?.completion ?? 0) || 0,
    reasoning: m?.reasoning,
    supportsJsonSchema: !m || !!m.supported_parameters?.some((p) => p === "response_format" || p === "structured_outputs"),
  };
}

// ---------- image generation providers (/settings/ai) ----------

export const IMAGE_PROVIDERS = ["magichour", "modelark", "openrouter"] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];
export const IMAGE_PROVIDER_LABEL: Record<ImageProvider, string> = {
  magichour: "Magic Hour",
  modelark: "BytePlus Seedream (ModelArk)",
  openrouter: "OpenRouter",
};

/** Ordered, deduplicated, known providers only. */
export const parseProviders = <T extends string>(v: string, all: readonly T[]) => [...new Set(v.split(",").map((s) => s.trim()))].filter((s): s is T => (all as readonly string[]).includes(s));
export const parseImageProviders = (v: string) => parseProviders(v, IMAGE_PROVIDERS);

export const ImageModels = z.partialRecord(z.enum(IMAGE_PROVIDERS), Model);

export const VIDEO_PROVIDERS = ["byteplus", "magichour"] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];
export const VIDEO_PROVIDER_LABEL: Record<VideoProvider, string> = { byteplus: "BytePlus Seedance (ModelArk)", magichour: "Magic Hour" };
export const parseVideoProviders = (v: string) => parseProviders(v, VIDEO_PROVIDERS);
export const VideoModels = z.partialRecord(z.enum(VIDEO_PROVIDERS), Model);
