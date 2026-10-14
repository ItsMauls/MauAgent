// Automation campaigns, DB side: create a campaign with its full plan, and the per-post cost estimate. The rules live in
// the pure modules (config.ts, plan.ts); this file only loads, checks and writes.
import { randomInt } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { automationEnv } from "@/lib/ai/env";
import { estimateCallUsd } from "@/lib/ai/generate";
import { dbDeps } from "@/lib/content/generate";
import { contentSetup } from "@/lib/content/config";
import { targetAccounts } from "@/lib/publishPlan";
import { getSettings } from "@/lib/settings";
import { GenerationConfig, Goal, PlanConfig, QcConfig, ReviewPolicy } from "./config";
import { buildPlan, capacity, planDays, PlanInfeasible, targetFrom } from "./plan";

/** What the new-campaign form sends. The target comes from a total or a rate; the server derives it again. */
export const CreateInput = z.object({
  name: z.string().trim().min(1).max(120),
  goal: z.object({}).passthrough(),
  target: z.object({ mode: z.enum(["total", "rate"]), total: z.number().int().min(0), perDay: z.number().int().min(0) }),
  planConfig: PlanConfig,
  reviewPolicy: ReviewPolicy,
  qcConfig: QcConfig,
  generationConfig: GenerationConfig,
  budgetCapUsd: z.number().min(0.01).max(100000),
  warnAtPct: z.number().int().min(1).max(99).default(80),
});
export type CreateInput = z.input<typeof CreateInput>;

/** Buffer channels a campaign can post to: active X and Threads accounts. */
export const automationAccounts = async () => (await targetAccounts()).filter((a) => a.platform === "twitter" || a.platform === "threads");

const DAY = 86_400_000;

export async function createAutomationCampaign(raw: unknown) {
  const input = CreateInput.parse(raw);
  const max = automationEnv().AUTOMATION_MAX_POSTS;
  const days = planDays(Goal.parse({ ...input.goal, targetPosts: 1 }), input.planConfig).length;
  const targetPosts = targetFrom({ ...input.target, days });
  if (targetPosts < 1 || targetPosts > max) throw new Error(`The target must be between 1 and ${max} posts (got ${targetPosts})`);
  const goal = Goal.parse({ ...input.goal, targetPosts });

  const cap = capacity(goal, input.planConfig);
  if (cap.shortfall) throw new PlanInfeasible(cap.shortfall, cap);
  const usable = await automationAccounts();
  const accounts = goal.accountIds.map((id) => usable.find((a) => a.id === id));
  if (accounts.some((a) => !a)) throw new Error("Pick active X or Threads accounts from Connections");

  const setup = contentSetup();
  const { timezone } = await getSettings();
  // Earlier batches only constrain the first week when the plan starts within it.
  const history = Date.parse(goal.startDate) - Date.now() < 7 * DAY ? await dbDeps.history() : undefined;
  const seed = randomInt(2 ** 31);
  const posts = buildPlan({
    goal, cfg: input.planConfig, tz: timezone, seed, content: setup.config, angles: setup.angles, variants: input.generationConfig.variantsPerPost, history,
    accounts: accounts.map((a) => ({ id: a!.id, platform: a!.platform as "twitter" | "threads" })),
  });

  return db.$transaction(async (tx) => {
    const c = await tx.automationCampaign.create({
      data: {
        name: input.name, goal, budgetCapUsd: input.budgetCapUsd, warnAtPct: input.warnAtPct, planConfig: input.planConfig,
        reviewPolicy: input.reviewPolicy, qcConfig: input.qcConfig, generationConfig: input.generationConfig, seed,
      },
    });
    await tx.campaignPost.createMany({
      data: posts.map((p) => ({ ...p, automationCampaignId: c.id, pilot: p.slot < input.generationConfig.pilotSize })),
    });
    return c;
  }, { timeout: 30_000 });
}

// Rough prompt sizes per call (characters), for the upper-bound estimate before any post is measured.
const PROMPT_CHARS = { socmedSpecialist: 9000, contentJudge: 5000, postQc: 5000 };

/**
 * Estimated USD per post before the pilot measures it: one writer call, one judge call and one QC call, each at the
 * role's model with its max output tokens (an upper bound), plus 25% for second QC samples and regenerations.
 * Null when model prices cannot be read (no AI key yet).
 */
export async function estimatePostUsd(): Promise<number | null> {
  try {
    const parts = await Promise.all(Object.entries(PROMPT_CHARS).map(([role, chars]) => estimateCallUsd(role, chars)));
    return parts.reduce((a, b) => a + b, 0) * 1.25;
  } catch {
    return null;
  }
}
