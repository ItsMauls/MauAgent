// Direct tasks from a Boards workspace: one agent runs alone (event agent/task.requested), reusing the pipeline's
// agent functions. Input schemas are Zod; the workspace form is generated from them (z.toJSONSchema).
import { z } from "zod";
import { db } from "@/lib/db";
import { accountManager, artDirector, creativeDirector, llmCost, modelFor, producer, promptPackage } from "@/lib/agents";
import { ClientBrief, CreativeBrief, InternalBrief, Platform, VideoSource, VisualDirection, type Stage } from "@/lib/agents/schemas";
import { budgetGate, latestPrice, monthSpent } from "@/lib/cost";
import { seedanceConfig } from "@/lib/providers/seedance";

/** Form field that picks an existing artifact of `role` (campaign or task output). */
const ref = (role: string, title: string) => z.string().min(1).meta({ title, ref: role });
const text = (title: string, max = 2000) => z.string().trim().min(1).max(max).meta({ title, multiline: true });
const ids = (kind: string, title: string) => z.array(z.string()).max(10).default([]).meta({ title, library: kind });

export type TaskCtx = {
  taskId: string;
  settings: { campaignBudgetUsd: number; defaultVideoSource: z.infer<typeof VideoSource> };
  artifact: <T extends z.ZodTypeAny>(id: string, role: string, schema: T) => Promise<z.infer<T>>;
  kit: (ids: string[]) => Promise<{ kind: string; name: string; description: string; imageUrls: string[] }[]>;
};
type Out = { payload: unknown; costUsd: number };

type TaskDef<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  input: S;
  output: string;
  /** False = deterministic code, US$0, no estimate needed. */
  llm: boolean;
  /** Pipeline stage that continues from this output ("Send to flow"). */
  next?: Stage;
  run: (input: z.infer<S>, ctx: TaskCtx) => Promise<Out>;
};
const def = <S extends z.ZodTypeAny>(d: TaskDef<S>) => d as unknown as TaskDef;

/** A full ClientBrief from the few fields a task asks for (cap and source come from Settings). */
export const briefFrom = (b: { objective?: string; product: string; audience: string; platforms?: string[] }, s: TaskCtx["settings"]) =>
  ClientBrief.parse({
    objective: b.objective ?? "", product: b.product, audience: b.audience, platforms: b.platforms?.length ? b.platforms : ["instagram"],
    budgetCapUsd: s.campaignBudgetUsd, defaultSource: s.defaultVideoSource,
  });

export const TASKS: Record<string, TaskDef> = {
  accountManager: def({
    output: "InternalBrief",
    llm: true,
    next: "creativeDirector",
    input: z.object({
      objective: text("Goal or raw idea"),
      product: z.string().trim().min(1).max(200).meta({ title: "Product / business" }),
      audience: z.string().trim().min(1).max(500).meta({ title: "Niche / audience" }),
      platforms: z.array(Platform).min(1).meta({ title: "Platforms" }),
    }),
    // Trend signals: vidIQ Trend Scout is not built, so there is no cache to pick from yet.
    run: (i, c) => accountManager(briefFrom(i, c.settings), []),
  }),
  creativeDirector: def({
    output: "CreativeBrief (3 options + pick)",
    llm: true,
    next: "artDirector",
    input: z
      .object({
        internalBriefId: ref("accountManager", "Internal brief").optional(),
        idea: text("…or a free idea").optional(),
      })
      .refine((i) => i.internalBriefId || i.idea, "Pick an internal brief or write an idea"),
    run: async (i, c) => {
      const internal: InternalBrief = i.internalBriefId
        ? await c.artifact(i.internalBriefId, "accountManager", InternalBrief)
        : { problemStatement: i.idea!, insight: i.idea!, mandatories: [], tone: "", deliverables: [], trendRefs: [] };
      return creativeDirector(internal);
    },
  }),
  artDirector: def({
    output: "VisualDirection (shot list, moodboard)",
    llm: true,
    next: "producer",
    input: z.object({
      creativeBriefId: ref("creativeDirector", "Creative brief"),
      product: z.string().trim().min(1).max(200).meta({ title: "Product" }),
      audience: z.string().trim().min(1).max(500).meta({ title: "Audience" }),
      characterIds: ids("character", "Talent"),
      locationIds: ids("location", "Locations"),
      styleIds: ids("style", "Video style"),
    }),
    run: async (i, c) =>
      artDirector(
        await c.artifact(i.creativeBriefId, "creativeDirector", CreativeBrief),
        briefFrom(i, c.settings),
        undefined,
        undefined,
        await c.kit([...i.characterIds, ...i.locationIds, ...i.styleIds]),
      ),
  }),
  producer: def({
    output: "ProductionPlan (deterministic estimate)",
    llm: false,
    input: z.object({ visualDirectionId: ref("artDirector", "Visual direction"), source: VideoSource.meta({ title: "Video source" }) }),
    run: async (i, c) => {
      const visual = await c.artifact(i.visualDirectionId, "artDirector", VisualDirection);
      const { model, resolution } = seedanceConfig("draft");
      const prices = await db.priceBook.findMany({ where: { provider: "byteplus", unit: "second" } });
      return { payload: producer(visual, { defaultSource: i.source, draftModel: model, resolution, price: (m) => latestPrice(prices, "byteplus", m, "second") }), costUsd: 0 };
    },
  }),
  videographer: def({
    output: "Prompt packages (one per shot)",
    llm: false,
    input: z.object({ visualDirectionId: ref("artDirector", "Visual direction") }),
    run: async (i, c) => {
      const visual = await c.artifact(i.visualDirectionId, "artDirector", VisualDirection);
      return { payload: { packages: visual.shotList.map((s) => promptPackage(c.taskId, s, visual)) }, costUsd: 0 };
    },
  }),
};

/** Short human title for a task from its input. */
export const taskTitle = (input: unknown) => {
  const i = (input ?? {}) as Record<string, unknown>;
  const s = [i.idea, i.objective, i.request, i.product].find((v) => typeof v === "string" && v) as string | undefined;
  return s ? (s.length > 80 ? `${s.slice(0, 79)}…` : s) : "Task";
};

// ---------- estimate + budget gate (deterministic) ----------

/** Fixed allowance for system prompt, persona and instructions, and for the structured output. */
export const PROMPT_OVERHEAD_CHARS = 3000;
export const OUTPUT_TOKENS = 2000;
export const estTokens = (chars: number) => Math.ceil(chars / 4);

/** Upper-bound estimate of one LLM task from PriceBook: (input + referenced artifacts + overhead) chars/4 in, fixed out. */
export async function estimateTask(role: string, input: unknown, refChars = 0) {
  const d = TASKS[role];
  if (!d?.llm) return 0;
  const inTok = estTokens(JSON.stringify(input).length + refChars + PROMPT_OVERHEAD_CHARS);
  return Math.round((await llmCost(modelFor(role), inTok, OUTPUT_TOKENS)) * 10000) / 10000;
}

/** Direct tasks have no campaign, so only the monthly cap applies. Enforced in the server action and again in Inngest. */
export async function taskGate(estUsd: number, monthCapUsd: number) {
  // A free task (deterministic code) adds nothing, so it is never blocked.
  if (estUsd <= 0) return { blocked: false, reasons: [] as string[], totalUsd: 0, monthUsd: await monthSpent() };
  return budgetGate({ estUsd, spentUsd: 0, capUsd: Number.POSITIVE_INFINITY, monthSpentUsd: await monthSpent(), monthCapUsd });
}

/** Artifact ids an input points at (for the estimate and for seeding a campaign). */
export const refIds = (input: unknown) =>
  Object.entries((input ?? {}) as Record<string, unknown>).filter(([k, v]) => k.endsWith("Id") && typeof v === "string").map(([, v]) => v as string);

// ---------- flow (pure orchestration, tested with a fake step) ----------

export type StepLike = { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };

export type FlowDeps = {
  /** Marks RUNNING; returns what the task needs. */
  start: () => Promise<{ role: string; input: unknown; confirmedOverCap: boolean; estUsd: number }>;
  /** Monthly-cap re-check; returns a reason to stop or null. */
  gate: (estUsd: number) => Promise<string | null>;
  execute: (role: string, input: unknown) => Promise<Out>;
  /** Must be idempotent: a retry after a partial failure never writes a second artifact. */
  save: (out: Out) => Promise<void>;
  fail: (msg: string) => Promise<void>;
};

/**
 * Each paid call is its own step: Inngest memoizes a finished step, so when `save` fails and the function is retried,
 * the LLM step returns its stored result instead of being called (and billed) again.
 */
export async function taskFlow(step: StepLike, d: FlowDeps) {
  try {
    const t = await step.run("start", d.start);
    if (!t.confirmedOverCap) {
      const stop = await step.run("budget-gate", () => d.gate(t.estUsd));
      if (stop) return step.run("over-cap", () => d.fail(stop));
    }
    const out = await step.run("agent", () => d.execute(t.role, t.input));
    await step.run("save", () => d.save(out));
  } catch (e) {
    await step.run("mark-failed", () => d.fail(e instanceof Error ? e.message : String(e)));
    throw e;
  }
}
