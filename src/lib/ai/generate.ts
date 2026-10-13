// generateStructured: the one entry point every agent uses to call a model. It applies the resolved config
// (model, effort, max tokens), enforces the LLM caps, fails over between keys, validates with Zod (one repair
// round), writes every HTTP call to CostEntry and reuses a validated result on an Inngest retry (idemKey).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { NonRetriableError } from "inngest";
import type { CostReason, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { aiEnv } from "./env";
import { chatCompletion, type ChatBody, type ChatResponse, type Fetch } from "./client";
import { withFailover, type KeyLabel } from "./failover";
import { reasoningParams } from "./effort";
import { getAiSettings, mergeAiConfig, modelMeta, type AiConfig, type AiSettingsRow, type ModelMeta } from "./settings";

export const PROVIDER = "openrouter";

/** Where a call comes from: cost attribution and retry safety. */
export type CallCtx = { idemKey?: string; campaignId?: string | null; reason?: CostReason; step?: string };

export type LedgerEntry = {
  idemKey: string; campaignId: string | null; step: string; model: string; agentRole: string; reason: CostReason;
  usd: number; tokensIn: number; tokensOut: number; tokensReasoning: number; keyLabel: KeyLabel; output: unknown;
};

/** Cost ledger access, injectable for tests. */
export type Ledger = {
  prior(idemKey: string): Promise<{ output: unknown; calls: number; usd: number }>;
  month(): Promise<{ usd: number; tokens: number }>;
  record(e: LedgerEntry): Promise<void>;
};

const monthStart = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), 1);

export const dbLedger: Ledger = {
  async prior(idemKey) {
    const rows = await db.costEntry.findMany({
      where: { provider: PROVIDER, idemKey: { startsWith: `${idemKey}:c` } },
      select: { output: true, usd: true },
    });
    const hit = rows.find((r) => r.output !== null);
    return { output: hit?.output ?? null, calls: rows.length, usd: rows.reduce((a, r) => a + Number(r.usd), 0) };
  },
  async month() {
    const a = await db.costEntry.aggregate({
      _sum: { usd: true, tokensIn: true, tokensOut: true },
      where: { provider: PROVIDER, createdAt: { gte: monthStart() } },
    });
    return { usd: Number(a._sum.usd ?? 0), tokens: (a._sum.tokensIn ?? 0) + (a._sum.tokensOut ?? 0) };
  },
  async record(e) {
    const units = e.tokensIn + e.tokensOut;
    await db.costEntry.upsert({
      where: { idemKey: e.idemKey },
      create: {
        idemKey: e.idemKey, campaignId: e.campaignId, step: e.step, provider: PROVIDER, model: e.model, agentRole: e.agentRole,
        reason: e.reason, units, unitPrice: units ? e.usd / units : 0, usd: e.usd, tokensIn: e.tokensIn, tokensOut: e.tokensOut,
        tokensReasoning: e.tokensReasoning, keyLabel: e.keyLabel, output: (e.output ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      update: {},
    });
  },
};

export type Deps = {
  fetch?: Fetch;
  ledger?: Ledger;
  env?: Record<string, string | undefined>;
  settings?: () => Promise<AiSettingsRow>;
  meta?: (model: string) => Promise<ModelMeta>;
  sleep?: (ms: number) => Promise<void>;
};

/** `images` are data: or https URLs sent with the prompt; the model must accept images (see AI_VISION_MODEL). */
export type GenOpts = CallCtx & { system?: string; config?: Partial<AiConfig>; deps?: Deps; images?: string[] };

/** Thrown when a cap blocks a call. Not retried: Inngest marks the step failed and the error shows on the Pipeline page. */
export class AiBudgetError extends NonRetriableError {}

/** Upper-bound estimate of one call: prompt chars/4 at the prompt price + max output tokens at the completion price. */
export const estimateUsd = (meta: ModelMeta, promptChars: number, maxOutputTokens: number) =>
  Math.ceil(promptChars / 4) * meta.promptUsdPerToken + maxOutputTokens * meta.completionUsdPerToken;

/** Same estimate for a role, from its resolved config (used by the Boards task estimate). */
export async function estimateCallUsd(role: string, promptChars: number) {
  const cfg = mergeAiConfig(role, aiEnv().AI_MODEL, await getAiSettings());
  return estimateUsd(await modelMeta(cfg.model), promptChars, cfg.maxOutputTokens);
}

/** Pre-call guards. Pure, so the messages are tested. */
export function capCheck(o: { monthUsd: number; monthTokens: number; estUsd: number; settings: Pick<AiSettingsRow, "monthlyBudgetUsd" | "maxCostPerCallUsd" | "monthlyTokenCap"> }) {
  const budget = Number(o.settings.monthlyBudgetUsd);
  const perCall = Number(o.settings.maxCostPerCallUsd);
  const tokens = o.settings.monthlyTokenCap;
  if (o.monthUsd + o.estUsd > budget)
    return `LLM monthly budget reached: US$${o.monthUsd.toFixed(4)} spent + US$${o.estUsd.toFixed(4)} estimated > cap US$${budget.toFixed(2)}. Raise it in Settings → AI.`;
  if (o.estUsd > perCall)
    return `LLM call estimate US$${o.estUsd.toFixed(4)} exceeds the per-call cap US$${perCall.toFixed(4)}. Lower max output tokens or raise the cap in Settings → AI.`;
  if (o.monthTokens >= tokens)
    return `LLM monthly token cap reached: ${o.monthTokens.toLocaleString("en-US")} of ${tokens.toLocaleString("en-US")} tokens. Raise it in Settings → AI.`;
  return null;
}

/** Model text → JSON: tolerate code fences and prose around one JSON object. */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("Model reply is not JSON");
  }
}

export async function generateStructured<T extends z.ZodTypeAny>(role: string, prompt: string, schema: T, opts: GenOpts = {}) {
  const d = opts.deps ?? {};
  const ledger = d.ledger ?? dbLedger;
  const env = aiEnv(d.env);
  const settings = await (d.settings ?? getAiSettings)();
  const cfg = { ...mergeAiConfig(role, env.AI_MODEL, settings), ...opts.config };
  const meta = await (d.meta ?? ((m) => modelMeta(m, d.fetch)))(cfg.model);
  const base = opts.idemKey ?? `adhoc:${role}:${randomUUID()}`;

  // Retry safety: a previous attempt of this step already got a valid result → reuse it, no new call.
  const prior = await ledger.prior(base);
  if (prior.output !== null) {
    const hit = schema.safeParse(prior.output);
    if (hit.success) return { payload: hit.data as z.infer<T>, costUsd: prior.usd, model: cfg.model, keyLabel: "primary" as KeyLabel, cached: true };
  }

  const system = opts.system ?? "";
  const month = await ledger.month();
  const estUsd = estimateUsd(meta, system.length + prompt.length, cfg.maxOutputTokens);
  const blocked = capCheck({ monthUsd: month.usd, monthTokens: month.tokens, estUsd, settings });
  if (blocked) throw new AiBudgetError(blocked);

  const jsonSchema = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  const messages: ChatBody["messages"] = [
    { role: "system", content: `${system}\n\nReply with one JSON object only, matching this JSON schema:\n${JSON.stringify(jsonSchema)}`.trim() },
    { role: "user", content: opts.images?.length ? [{ type: "text", text: prompt }, ...opts.images.map((url) => ({ type: "image_url" as const, image_url: { url } }))] : prompt },
  ];
  const keys = { primary: env.AI_API_KEY, fallback: settings.enableFallbackKey ? env.AI_API_KEY_FALLBACK : undefined };

  let calls = prior.calls;
  let costUsd = prior.usd;
  let lastError = "";
  // Two rounds at most: the call, then one repair with the validation errors.
  for (let round = 0; round < 2; round++) {
    const body: ChatBody = {
      model: cfg.model,
      messages,
      max_tokens: cfg.maxOutputTokens,
      temperature: cfg.temperature,
      ...reasoningParams(cfg.reasoningEffort, meta.reasoning),
      ...(meta.supportsJsonSchema && { response_format: { type: "json_schema", json_schema: { name: "output", strict: false, schema: jsonSchema } } }),
    };
    const { result: res, keyLabel } = await withFailover<ChatResponse>(
      keys,
      (key) => chatCompletion(env.AI_BASE_URL, key, body, { fetch: d.fetch }),
      { sleep: d.sleep },
    );
    const text = res.choices?.[0]?.message?.content ?? "";
    let parsed: z.ZodSafeParseResult<z.infer<T>> | null = null;
    try {
      parsed = schema.safeParse(extractJson(text));
      if (!parsed.success) lastError = z.prettifyError(parsed.error);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    const usd = Number(res.usage?.cost ?? 0) || 0;
    costUsd += usd;
    await ledger.record({
      idemKey: `${base}:c${++calls}`, campaignId: opts.campaignId ?? null, step: opts.step ?? role, model: res.model ?? cfg.model,
      agentRole: role, reason: opts.reason ?? "initial", usd, keyLabel,
      tokensIn: res.usage?.prompt_tokens ?? 0, tokensOut: res.usage?.completion_tokens ?? 0,
      tokensReasoning: res.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      output: parsed?.success ? parsed.data : null,
    });
    if (parsed?.success) return { payload: parsed.data as z.infer<T>, costUsd, model: cfg.model, keyLabel, cached: false };
    messages.push(
      { role: "assistant", content: text.slice(0, 20_000) },
      { role: "user", content: `That reply failed validation:\n${lastError.slice(0, 2000)}\nReturn the corrected JSON object only.` },
    );
  }
  throw new Error(`Model output failed validation after one repair: ${lastError.slice(0, 500)}`);
}
