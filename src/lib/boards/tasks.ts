// Direct tasks from a Boards workspace: one agent runs alone (event agent/task.requested), reusing the pipeline's
// agent functions. Input schemas are Zod; the workspace form is generated from them (z.toJSONSchema).
import { z } from "zod";
import { db } from "@/lib/db";
import { accountManager, accountTeam, artDirector, creativeDirector, producer, promptPackage, type CallCtx } from "@/lib/agents";
import { estimateCallUsd } from "@/lib/ai/generate";
import { topTrendRefs } from "@/lib/trends";
import { generate } from "@/lib/ai/image";
import { storyboardPdf } from "./storyboardPdf";
import { uploadBuffer } from "@/lib/s3";
import { renderCut } from "@/lib/media/renderCut";
import { ClientBrief, CreativeBrief, InternalBrief, Platform, VideoSource, VisualDirection, type Stage } from "@/lib/agents/schemas";
import { budgetGate, latestPrice, monthSpent } from "@/lib/cost";
import { seedanceConfig } from "@/lib/providers/seedance";

/** Form field that picks an existing artifact of `role` (campaign or task output). */
const ref = (role: string, title: string) => z.string().min(1).meta({ title, ref: role });
const text = (title: string, max = 2000) => z.string().trim().min(1).max(max).meta({ title, multiline: true });
/** Form field that picks a campaign. */
const campaignRef = (title: string) => z.string().min(1).meta({ title, ref: "campaign" });
const ids = (kind: string, title: string) => z.array(z.string()).max(10).default([]).meta({ title, library: kind });

export type TaskCtx = {
  taskId: string;
  settings: { campaignBudgetUsd: number; defaultVideoSource: z.infer<typeof VideoSource> };
  /** idemKey task:<id>:<attempt>, so an Inngest retry reuses a paid LLM result. */
  llm: CallCtx;
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
    // Top 5 cached trend signals (all sources), same as the pipeline.
    run: async (i, c) => accountManager(briefFrom(i, c.settings), await topTrendRefs(), undefined, c.llm),
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
      return creativeDirector(internal, undefined, undefined, c.llm);
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
        c.llm,
      ),
  }),
  storyboardArtist: def({
    output: "Storyboard (timed panels + illustrated PDF)",
    // ponytail: image generation is not priced or gated (see ai/image.ts), so this still reports US$0.
    llm: false,
    input: z.object({ visualDirectionId: ref("artDirector", "Visual direction") }),
    run: async (i, c) => {
      const visual = await c.artifact(i.visualDirectionId, "artDirector", VisualDirection);
      const sb = storyboard(visual);
      const images = await Promise.all(sb.panels.map((p) => panelImage(visual, sb, p).catch(() => null)));
      const key = `tasks/${c.taskId}/storyboard.pdf`;
      await uploadBuffer(key, await storyboardPdf(sb, images), "application/pdf");
      return { payload: { ...sb, pdfKey: key, illustrated: images.filter(Boolean).length }, costUsd: 0 };
    },
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
  postProduction: def({
    output: "RenderBundle (final cut from a campaign's clips)",
    llm: false,
    input: z.object({ campaignId: campaignRef("Campaign with clips") }),
    // A new cut under tasks/, the campaign itself (finalCutKey, status) is not touched.
    run: async (i, c) => ({
      payload: await renderCut(i.campaignId, await latestOf(i.campaignId, "artDirector", VisualDirection), `tasks/${c.taskId}/finalCut-${Date.now()}.mp4`),
      costUsd: 0,
    }),
  }),
  accountTeam: def({
    output: "ApprovalPackage (QC report)",
    llm: true,
    input: z.object({ campaignId: campaignRef("Campaign to check") }),
    run: async (i, c) => {
      const camp = await db.campaign.findUniqueOrThrow({ where: { id: i.campaignId }, select: { clientBrief: true } });
      return accountTeam(
        ClientBrief.parse(camp.clientBrief),
        await latestOf(i.campaignId, "creativeDirector", CreativeBrief),
        await latestOf(i.campaignId, "artDirector", VisualDirection),
        undefined,
        c.llm,
      );
    },
  }),
};

/** One panel per shot with running timecodes; the brief's character and palette travel with it. Pure, no LLM. */
export function storyboard(v: VisualDirection) {
  let t = 0;
  const panels = v.shotList.map((s, n) => {
    const p = { panel: n + 1, shotId: s.shotId, startSec: t, durationSec: s.durationSec, framing: s.cameraMove, action: s.subject, setting: s.setting, lighting: s.lighting, onScreenText: s.onScreenText, voLine: s.voLine };
    t += s.durationSec;
    return p;
  });
  return { character: v.characterDescription, palette: v.palette, totalSec: t, panels };
}

/** One illustration for a panel; callers catch failures so one bad image does not lose the PDF. */
async function panelImage(v: VisualDirection, sb: ReturnType<typeof storyboard>, p: ReturnType<typeof storyboard>["panels"][number]) {
  const url = await generate(
    `Storyboard frame, vertical 9:16, ${v.moodboardPrompts[0] ?? "clean illustrated style"}. No text or captions in the image.
Character: ${sb.character}
Setting: ${p.setting}. Lighting: ${p.lighting}. Camera: ${p.framing}.
Action: ${p.action}`,
    v.styleRefImageUrls[0],
  );
  return new Uint8Array(url.startsWith("data:") ? Buffer.from(url.split(",")[1], "base64") : await (await fetch(url)).arrayBuffer());
}

/** Latest artifact of a role in a campaign, validated. */
async function latestOf<T extends z.ZodTypeAny>(campaignId: string, role: string, schema: T): Promise<z.infer<T>> {
  const a = await db.artifact.findFirst({ where: { campaignId, agentRole: role }, orderBy: { version: "desc" } });
  if (!a) throw new Error(`This campaign has no ${role} output yet`);
  return schema.parse(a.payload);
}

// ---------- estimate + budget gate (deterministic) ----------

/** Fixed allowance for system prompt, persona, instructions and the JSON schema. */
export const PROMPT_OVERHEAD_CHARS = 3000;

/** Upper-bound estimate of one LLM task: (input + referenced artifacts + overhead) chars/4 at the model's prompt
 *  price, plus the role's max output tokens at the completion price (OpenRouter /models pricing). */
export async function estimateTask(role: string, input: unknown, refChars = 0) {
  const d = TASKS[role];
  if (!d?.llm) return 0;
  return Math.round((await estimateCallUsd(role, JSON.stringify(input).length + refChars + PROMPT_OVERHEAD_CHARS)) * 10000) / 10000;
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
