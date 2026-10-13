// A Socmed Specialist batch by content type: pick a type per post, ask for N variants, validate them and keep the
// best. Data access is injected (dbDeps below), so the whole flow is unit-tested without a DB.
import { db } from "@/lib/db";
import { writeContentVariants, type CallCtx, type PostBrief } from "@/lib/agents";
import { AiBudgetError } from "@/lib/ai/generate";
import { contentVariants, SocialPosts } from "@/lib/agents/schemas";
import { contentSetup, type ContentConfig, type ContentSetup } from "./config";
import { loadContext } from "./context";
import { angleFor, isThreadType, pickType } from "./select";
import { topicLanguage, validateVariant } from "./validate";

/** `types` = the owner's picks in the brief form; empty means the weighted mix of every type. */
export type BatchInput = PostBrief & { count: number; types?: string[] };

/**
 * Config limited to the owner's picks (weights kept). A single pick is an explicit request for that type, so the
 * anti-repeat rule is lifted; with two or more picks it still holds.
 */
export function onlyTypes(cfg: ContentConfig, types: string[], count: number): ContentConfig {
  const picked = Object.entries(cfg.types).filter(([t, c]) => types.includes(t) && c.weight > 0);
  if (!picked.length) return cfg;
  return { ...cfg, types: Object.fromEntries(picked), maxConsecutive: picked.length === 1 ? Math.max(count, cfg.maxConsecutive) : cfg.maxConsecutive };
}
type Written = { payload: unknown; costUsd: number };

export type ContentDeps = {
  setup: () => ContentSetup;
  /** The owner's uploaded context files as one prompt block ("" = none). */
  context: () => Promise<string>;
  /** Types of earlier batches, most recent last, and how many thread posts they made in the last 7 days. */
  history: () => Promise<{ recent: string[]; threadsThisWeek: number }>;
  /** Texts of posts created in the last `days` days (similarity corpus). */
  recentTexts: (days: number) => Promise<string[]>;
  voice: () => Promise<string | null | undefined>;
  write: (p: Parameters<typeof writeContentVariants>[0], ctx: CallCtx) => Promise<Written>;
  rand: () => number;
};

const DAY = 86_400_000;

export const dbDeps: ContentDeps = {
  setup: contentSetup,
  context: loadContext,
  async history() {
    const rows = await db.artifact.findMany({
      where: { agentRole: "socmedSpecialist", createdAt: { gte: new Date(Date.now() - 7 * DAY) } },
      orderBy: { createdAt: "asc" }, select: { payload: true },
    });
    const types = rows.flatMap((r) => SocialPosts.safeParse(r.payload).data?.posts.map((p) => p.type ?? "") ?? []).filter(Boolean);
    const cfg = contentSetup().config;
    return { recent: types.slice(-10), threadsThisWeek: types.filter((t) => isThreadType(cfg, t)).length };
  },
  async recentTexts(days) {
    const rows = await db.publishJob.findMany({
      where: { createdAt: { gte: new Date(Date.now() - days * DAY) }, caption: { not: null } },
      select: { caption: true, thread: true }, distinct: ["caption"], take: 500,
    });
    return rows.map((r) => [r.caption, ...r.thread].join("\n"));
  },
  voice: async () => (await db.setting.findUnique({ where: { id: "default" }, select: { writingVoice: true } }))?.writingVoice,
  write: writeContentVariants,
  rand: Math.random,
};

const RANK = { approved: 0, needs_review: 1, rejected: 2 } as const;
const SURE = { high: 0, medium: 1, low: 2 } as const;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export async function generatePosts(input: BatchInput, ctx: CallCtx = {}, deps: ContentDeps = dbDeps) {
  const setup = deps.setup();
  const cfg = onlyTypes(setup.config, input.types ?? [], input.count);
  let uploaded: string, history: Awaited<ReturnType<ContentDeps["history"]>>, corpus: string[], voice: string | null | undefined;
  try {
    [uploaded, history, corpus, voice] = await Promise.all([deps.context(), deps.history(), deps.recentTexts(cfg.similarity.lookbackDays), deps.voice()]);
  } catch (e) {
    throw new Error(`Could not load your context files or recent posts: ${message(e)}`);
  }

  const language = topicLanguage(input.topic);
  const topic = [input.topic, input.brand].filter(Boolean).join(" ");
  const recent = [...history.recent];
  let threads = history.threadsThisWeek;
  const angles = new Set<string>();
  const posts: SocialPosts["posts"] = [];
  const skipped: SocialPosts["skipped"] = [];
  let costUsd = 0;

  for (let slot = 0; slot < input.count; slot++) {
    // Step 1: the type for this post.
    const type = pickType(cfg, { recent, threadsThisWeek: threads }, deps.rand);
    if (!type) { skipped.push({ type: "-", reason: "No content type is allowed right now (weekly thread cap or repeat rule)" }); continue; }
    recent.push(type);
    if (isThreadType(cfg, type)) threads++;
    const angle = angleFor(cfg, type, angles, deps.rand);
    if (angle) angles.add(angle);

    // Step 3: N variants from the model, checked against the exact count.
    let variants;
    try {
      const out = await deps.write(
        { brief: input, type, guide: cfg.types[type].guide, examples: setup.examples[type] ?? [], angle, context: uploaded, language, n: cfg.variants, voice },
        { ...ctx, idemKey: ctx.idemKey ? `${ctx.idemKey}:p${slot}` : undefined },
      );
      costUsd += out.costUsd;
      const parsed = contentVariants(cfg.variants).safeParse(out.payload);
      if (!parsed.success) throw new Error(`the model reply did not match the variant schema (${parsed.error.issues[0]?.message})`);
      // Some models drop the backslash of "\n" before a list line ("work?nA. Yes"); restore the line break.
      const lines = (s: string) => s.replace(/([?.!:])n(?=(?:[A-Da-d][.)]|\d[.)])\s)/g, "$1\n");
      variants = parsed.data.variants.map((x) => ({ ...x, text: lines(x.text), thread: x.thread.map(lines) }));
    } catch (e) {
      if (e instanceof AiBudgetError) throw e;
      skipped.push({ type, reason: `Generation failed: ${message(e)}` });
      continue;
    }

    // Step 4 + 5: validate every variant, keep the best, offer the other usable ones as alternatives.
    const check = { cfg, type, platforms: input.platforms, topic, context: uploaded, banned: setup.banned, corpus: [...corpus, ...posts.map((p) => [p.text, ...p.thread].join("\n"))] };
    const all = variants.map((v) => ({ v, verdict: validateVariant(v, check) }));
    // Best first: approved over needs_review, then the more sure the AI is of its source.
    const checked = all
      .filter((x) => x.verdict.status !== "rejected")
      .sort((a, b) => RANK[a.verdict.status] - RANK[b.verdict.status] || SURE[a.v.confidence ?? "high"] - SURE[b.v.confidence ?? "high"]);
    if (!checked.length) {
      skipped.push({ type, reason: `All ${variants.length} variants were rejected: ${all[0].verdict.reasons.join("; ")}` });
      continue;
    }
    const [best, ...rest] = checked;
    posts.push({
      text: best.v.text, thread: best.v.thread, type, status: best.verdict.status, reasons: best.verdict.reasons,
      sourceNote: best.v.sourceNote, confidence: best.v.confidence,
      alternatives: rest.map(({ v, verdict }) => ({ text: v.text, thread: v.thread, sourceNote: v.sourceNote, confidence: v.confidence, status: verdict.status, reasons: verdict.reasons })),
    });
  }

  if (!posts.length) throw new Error(`No usable post: ${skipped.map((s) => `${s.type}: ${s.reason}`).join(" | ").slice(0, 900)}`);
  return { payload: SocialPosts.parse({ posts, skipped }), costUsd };
}
