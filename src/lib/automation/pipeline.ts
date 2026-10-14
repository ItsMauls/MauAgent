// One automation post, start to verdict: write it with the shared text-post code (prepareBatch + writePost: variants,
// rule checks, judge, best variant), run the Post QC hard rules and LLM judge, compute confidence and apply the
// decision table. Regenerates with the QC issues as feedback up to qcConfig.maxRetries. All I/O is injected, so the
// whole flow is tested without a DB or network (pipeline.test.ts).
import type { ContentType, Cta } from "@/lib/agents/schemas";
import { AiBudgetError, type CallCtx } from "@/lib/ai/generate";
import { prepareBatch, writePost, type ContentDeps } from "@/lib/content/generate";
import type { AutomationPlatform, GenerationConfig, Goal, QcConfig, ReviewPolicy } from "./config";
import { borderline, confidence, decide, hardFails, hardRules, nearMisses, type QcRules, type RuleResult, type Verdict } from "./qc";
import { qcIssues, qcPrompt, QcVerdict, type QcInput } from "./qcJudge";
import { briefFor, type CampaignBrief } from "./strategy";

export type PostJob = {
  campaignId: string;
  slot: number;
  type: ContentType;
  angles: string[];
  cta: Cta | null;
  pillar: string;
  pilot: boolean;
  /**
   * Rounds already used. IdemKeys are r<n>, so a step retry (same count) reuses stored outputs, and a manual
   * regenerate (count + 1) gets fresh calls. maxRetries counts from here.
   */
  retryCount: number;
  platforms: AutomationPlatform[];
  goal: Goal;
  policy: ReviewPolicy;
  qc: QcConfig;
  gen: GenerationConfig;
  /** The Account Manager's expanded brief; null = write from the form fields alone. */
  brief?: CampaignBrief | null;
  /** This campaign's latest post texts, newest first: batch checks, repeated openings and structure. */
  recent: string[];
};

/** A line of the team's discussion (shown live on the campaign page). */
export type Say = (who: "accountManager" | "socmedSpecialist" | "qc" | "postQc", text: string, slot?: number) => Promise<void>;

export type PipelineDeps = {
  content: ContentDeps;
  /** Optional: where the discussion goes. Nothing is said when absent. */
  say?: Say;
  rules: () => QcRules;
  qcJudge: (prompt: string, ctx: CallCtx & { temperature: number }) => Promise<{ payload: unknown; costUsd: number }>;
};

export type PostOutcome = {
  status: "approved" | "needs_review";
  text: string | null;
  thread: string[];
  alternatives: unknown[];
  sourceNote: string | null;
  confidence: number | null;
  retryCount: number;
  failureReason: string | null;
  costUsd: number;
  qcReport: Record<string, unknown>;
};

/** The campaign's language choice reaches the writer as an audience signal (briefLanguage reads it). */
const audienceFor = (g: Goal) => g.audience + (g.language === "en" ? " (international, English)" : g.language === "id" ? " (Indonesia)" : "");
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export async function runPost(job: PostJob, ctx: CallCtx, deps: PipelineDeps): Promise<PostOutcome> {
  const rulesCfg = deps.rules();
  const say: Say = deps.say ?? (async () => {});
  const n = job.slot + 1;
  const bf = briefFor(job.brief ?? null, job.goal, job.pillar, job.slot, job.angles, job.gen.variantsPerPost);
  const base = ctx.idemKey ?? `auto:${job.campaignId}:s${job.slot}`;
  let avoid: string[] = [];
  let costUsd = 0;
  const attempts: Record<string, unknown>[] = [];

  for (let retry = job.retryCount; ; retry++) {
    const shared = await prepareBatch({
      topic: job.pillar, objective: bf.objective, audience: audienceFor(job.goal),
      avoid: [job.goal.avoid, bf.avoid].filter(Boolean).join("; ") || undefined,
      brand: job.goal.kind === "brand" ? job.goal.brandName : undefined, offer: job.goal.brandOffer,
      hashtags: job.goal.hashtags, customTags: job.goal.customTags, platforms: job.platforms, cta: job.goal.cta,
      // The link (if any) is appended by code only to posts whose CTA is visit_link.
      linkUrl: job.goal.linkUrl, mediaType: "text_only", length: job.goal.length,
      count: job.gen.chunkSize, types: [job.type], variants: job.gen.variantsPerPost, siblings: job.recent.slice(0, job.gen.chunkSize),
    }, deps.content);
    const written = await writePost(shared, { slot: job.slot, type: job.type, angles: bf.angles, cta: job.cta, avoid }, { ...ctx, idemKey: `${base}:r${retry}` }, deps.content);
    costUsd += written.costUsd;
    const last = retry - job.retryCount >= job.qc.maxRetries;

    if (!written.post) {
      attempts.push({ retry, problem: written.problem });
      await say("socmedSpecialist", `I could not write a usable post ${n}: ${written.problem.slice(0, 200)}. ${last ? "No retries left, it goes to you." : "Trying again."}`, job.slot);
      if (!last) { avoid = [written.problem.slice(0, 300)]; continue; }
      return {
        status: "needs_review", text: null, thread: [], alternatives: [], sourceNote: null, confidence: null, retryCount: retry, costUsd,
        failureReason: `No usable post: ${written.problem}`, qcReport: { attempts, decision: { action: "needs_review", reasons: [written.problem] } },
      };
    }
    const post = written.post;
    const rules: RuleResult[] = hardRules(
      { text: post.text, thread: post.thread, sourceNote: post.sourceNote },
      { platforms: job.platforms, briefLink: job.goal.linkUrl, recent: job.recent, corpus: shared.corpus, similarityThreshold: shared.cfg.similarity.threshold },
      rulesCfg,
    );
    const fails = hardFails(rules).map((r) => r.detail);
    await say("socmedSpecialist", `Post ${n} is ready, handing it to Post QC.`, job.slot);
    await say("postQc", fails.length
      ? `Rule check failed: ${fails.slice(0, 3).join("; ")}. ${last ? "No retries left, it goes to you." : "Sending it back to the Socmed Specialist to rewrite."}`
      : `Rule check passed${rules.some((r) => r.nearMiss) ? " (close to a limit)" : ""}. Reading it as a stranger would.`, job.slot);
    // A hard fail is regenerated before paying for the QC judge.
    if (fails.length && !last) {
      attempts.push({ retry, text: post.text, fails });
      avoid = fails;
      continue;
    }

    const typeCfg = shared.cfg.types[job.type]!;
    const input: QcInput = {
      text: post.text, thread: post.thread, type: job.type, typeLabel: typeCfg.label, topic: shared.topic, audience: job.goal.audience,
      persona: shared.persona!, voice: shared.voice, context: [shared.uploaded, shared.research.places, ...shared.research.facts.map((f) => `${f.title}: ${f.summary}`)].filter(Boolean).join("\n"),
      sourceNote: post.sourceNote ?? null,
    };
    const samples: QcVerdict[] = [];
    const judge = async (suffix: string, temperature: number) => {
      try {
        const out = await deps.qcJudge(qcPrompt(input), { ...ctx, idemKey: `${base}:r${retry}:${suffix}`, step: "post-qc", temperature });
        costUsd += out.costUsd;
        samples.push(QcVerdict.parse(out.payload));
      } catch (e) {
        if (e instanceof AiBudgetError) throw e;
        attempts.push({ retry, qcError: message(e) });
      }
    };
    if (!fails.length) await judge("qc", 0.1);
    const conf = () => confidence({
      qcScores: samples.map((s) => s.score), qcVerdicts: samples.map((s) => s.verdict), genBest: written.scores.best, genSecond: written.scores.second,
      variants: job.gen.variantsPerPost, sourceRule: typeCfg.source, sourceNote: post.sourceNote ?? null, sourceConfidence: post.confidence ?? null,
      rulesPass: !fails.length, nearMisses: nearMisses(rules),
    });
    let c = conf();
    if (samples[0] && borderline(samples[0].verdict, c.value, job.qc)) {
      await say("postQc", `It is close to the ${Math.round(job.qc.minConfidence * 100)}% threshold (${Math.round(c.value * 100)}%), asking for a second opinion.`, job.slot);
      await judge("qc2", 0.4);
      c = conf();
    }
    // Two samples that disagree: the stricter verdict counts.
    const verdict: Verdict | null = samples.length ? (samples.some((s) => s.verdict === "fail") ? "fail" : samples.some((s) => s.verdict === "uncertain") ? "uncertain" : "pass") : null;
    const decision = decide({
      hardFails: fails, forceReview: written.ruleReview, verdict, confidence: c.value, type: job.type, policy: job.policy, cfg: job.qc, retry: retry - job.retryCount, pilot: job.pilot,
    });
    const issues = samples.flatMap(qcIssues).slice(0, 2);
    await say("postQc", `Verdict: ${verdict ?? "no verdict"}${samples[0] ? ` (${samples.map((s) => s.score).join(" / ")} of 10)` : ""}. Confidence ${Math.round(c.value * 100)}%${issues.length ? `. ${issues.join(" ")}` : ""}. ${
      decision.action === "auto_approve" ? "Approved automatically." : `Sent to you: ${decision.reasons.slice(0, 2).join("; ")}.`}`, job.slot);
    return {
      status: decision.action === "auto_approve" ? "approved" : "needs_review",
      text: post.text, thread: post.thread, alternatives: post.alternatives, sourceNote: post.sourceNote ?? null,
      confidence: c.value, retryCount: retry, costUsd, failureReason: null,
      qcReport: {
        decision, verdict, rules, ruleReview: written.ruleReview, samples, issues: samples.flatMap(qcIssues),
        suggestedFix: samples[0]?.suggestedFix ?? "", confidenceInputs: c.parts, genScores: written.scores, writerReasons: post.reasons, attempts,
      },
    };
  }
}
