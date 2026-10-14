// Post QC agent, the pure parts: layer 1 hard rules (config/qc-rules.yaml), the confidence score and the decision
// table that turns a QC result into regenerate / auto-approve / needs review. No LLM and no DB here; tested in
// qc.test.ts. The LLM judge (layer 2) lives in qcJudge.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CHAR_LIMIT, charCount } from "@/lib/publish";
import { parseYaml } from "@/lib/content/config";
import { emojis, jaccard, opening, questionHook } from "@/lib/content/validate";
import type { QcConfig, ReviewPolicy } from "./config";

const Severity = z.enum(["fail", "warn"]);
export const QcRules = z.object({
  unsourcedClaims: z.object({ severity: Severity, numbers: z.boolean(), years: z.boolean(), percent: z.boolean(), quotes: z.boolean() }),
  forbiddenClaims: z.object({ severity: Severity, patterns: z.array(z.string().min(1)) }),
  engagementBait: z.object({ severity: Severity, patterns: z.array(z.string().min(1)) }),
  links: z.object({ severity: Severity }),
  repeatOpening: z.object({ severity: Severity, lookback: z.number().int().min(1) }),
  repeatStructure: z.object({ severity: Severity, run: z.number().int().min(2) }),
  nearMiss: z.object({ similarityRatio: z.number().gt(0).max(1), lengthRatio: z.number().gt(0).max(1) }),
});
export type QcRules = z.infer<typeof QcRules>;

export const parseQcRules = (text: string) => parseYaml("config/qc-rules.yaml", text, QcRules);
// ponytail: read once per process, like content-types.yaml; restart after editing.
let cached: QcRules | undefined;
export const qcRules = () => (cached ??= parseQcRules(readFileSync(path.join(process.cwd(), "config", "qc-rules.yaml"), "utf8")));

export type RuleResult = { id: string; pass: boolean; severity: "fail" | "warn"; nearMiss?: boolean; detail: string };
export type QcPost = { text: string; thread: string[]; sourceNote?: string | null };
export type QcCtx = {
  platforms: string[];
  /** The brief's link (appended by code): the only URL allowed. */
  briefLink?: string;
  /** Texts of this campaign's recent posts, newest first (openings, structure). */
  recent: string[];
  /** Similarity corpus (campaign + last 30 days) and the threshold from content-types.yaml. */
  corpus: string[];
  similarityThreshold: number;
};

const words = (patterns: string[]) => patterns.map((p) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${p})(?![\\p{L}\\p{N}])`, "iu"));
const URL = /https?:\/\/\S+/g;

/** What the claim checks read: no URLs, no thread numbering, no clock times (09:30, jam 10). */
function claimText(post: QcPost) {
  return [post.text, ...post.thread]
    .join("\n")
    .replace(URL, " ")
    .replace(/^\s*\d{1,2}\s*[./)]\s/gm, " ")
    .replace(/\b\d{1,2}[:.]\d{2}\b/g, " ")
    .replace(/\bjam \d{1,2}\b/gi, " ");
}

/** Line count, question hook, emoji ending, thread, numbered opening: two posts with the same shape read alike. */
export const shape = (text: string, thread: string[] = []) =>
  [text.trim().split("\n").length > 1 ? "lines" : "line", questionHook(text) ? "q" : "", emojis(text.trim().slice(-4)).length ? "emoji" : "", thread.length ? "thread" : "", /^\d/.test(text.trim()) ? "num" : ""].join("|");

export function hardRules(post: QcPost, ctx: QcCtx, rules: QcRules): RuleResult[] {
  const out: RuleResult[] = [];
  const all = [post.text, ...post.thread].join("\n");
  const add = (id: string, severity: RuleResult["severity"], hits: string[], label: string) =>
    out.push({ id, severity, pass: !hits.length, detail: hits.length ? `${label}: ${[...new Set(hits)].slice(0, 3).join(", ")}` : "" });

  // Unsourced claims: only when the post cites no research item.
  const u = rules.unsourcedClaims;
  const claims = claimText(post);
  const hits: string[] = [];
  if (!post.sourceNote?.trim()) {
    if (u.percent) hits.push(...(claims.match(/\d+(?:[.,]\d+)?\s*(?:%|persen\b|percent\b)/giu) ?? []));
    if (u.years) hits.push(...(claims.match(/\b(?:19|20)\d{2}\b/g) ?? []));
    if (u.numbers) hits.push(...(claims.match(/(?<![\p{L}\p{N}])\d{2,}(?:[.,]\d+)*/gu) ?? []));
    if (u.quotes) hits.push(...(claims.match(/["“][^"”]{15,}["”]/g) ?? []).map((q) => q.slice(0, 30)));
  }
  add("unsourced_claims", u.severity, hits, "Numbers, years or quotes without a research source (remove them or keep it general)");

  add("forbidden_claims", rules.forbiddenClaims.severity, words(rules.forbiddenClaims.patterns).flatMap((r) => all.match(r)?.[0] ?? []), "Forbidden claim");
  add("engagement_bait", rules.engagementBait.severity, words(rules.engagementBait.patterns).flatMap((r) => all.match(r)?.[0] ?? []), "Engagement bait");
  add("links", rules.links.severity, (all.match(URL) ?? []).filter((l) => l !== ctx.briefLink), "Link that is not the brief's link");

  const open = opening(post.text);
  const recent = ctx.recent.slice(0, rules.repeatOpening.lookback);
  add("repeat_opening", rules.repeatOpening.severity, open && recent.some((t) => opening(t) === open) ? [`"${open}"`] : [], "Opens like a recent post of this campaign");

  const s = shape(post.text, post.thread);
  const run = ctx.recent.slice(0, rules.repeatStructure.run - 1);
  add("repeat_structure", rules.repeatStructure.severity, run.length === rules.repeatStructure.run - 1 && run.every((t) => shape(t) === s) ? [s] : [], "Same structure as the last posts");

  // Near misses: they pass, but they count against confidence.
  const top = Math.max(0, ...ctx.corpus.map((t) => jaccard(all, t)));
  if (top >= ctx.similarityThreshold * rules.nearMiss.similarityRatio && top < ctx.similarityThreshold)
    out.push({ id: "near_similarity", severity: "warn", pass: true, nearMiss: true, detail: `${Math.round(top * 100)}% word overlap with a recent post` });
  const fill = Math.max(0, ...ctx.platforms.flatMap((p) => [post.text, ...post.thread].map((t) => (CHAR_LIMIT[p] ? charCount(p, t) / CHAR_LIMIT[p] : 0))));
  if (fill >= rules.nearMiss.lengthRatio && fill <= 1)
    out.push({ id: "near_length", severity: "warn", pass: true, nearMiss: true, detail: `${Math.round(fill * 100)}% of the character limit` });
  return out;
}

export const hardFails = (r: RuleResult[]) => r.filter((x) => !x.pass && x.severity === "fail");
/** Warn-level failures and near misses: they lower confidence. */
export const nearMisses = (r: RuleResult[]) => r.filter((x) => x.nearMiss || (!x.pass && x.severity === "warn")).length;

// ---------- confidence ----------

export type Verdict = "pass" | "fail" | "uncertain";
export type ConfidenceInputs = {
  /** Post QC judge score 0-10 per sample (one, or two for a borderline post). */
  qcScores: number[];
  qcVerdicts: Verdict[];
  /** Text-post judge score 0-10 of the chosen variant and of the best other usable variant (null = not judged). */
  genBest: number | null;
  genSecond: number | null;
  variants: number;
  /** The type's source rule (content-types.yaml) and the cited source with the AI's own confidence. */
  sourceRule: string;
  sourceNote: string | null;
  sourceConfidence: "high" | "medium" | "low" | null;
  /** All hard rules passed. */
  rulesPass: boolean;
  nearMisses: number;
};

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const SOURCE_SCORE = { high: 1, medium: 0.6, low: 0.2 } as const;

/**
 * Confidence that a post can publish without a person reading it. Not the LLM's own number (poorly calibrated): a
 * weighted mix of signals, so a perfect judge score alone reaches at most 0.55.
 *
 *   qc     = Post QC score / 10 (the lower sample when there are two)            weight 0.40
 *   gen    = text-post judge score of the chosen variant / 10 (0 if not judged)  weight 0.15
 *   margin = lead of the chosen variant over the next usable one, /3, in [0,1]   weight 0.10
 *            (0.5 with a single variant or no runner-up score)
 *   source = 1 for types without source rules; sourced types: high 1, medium 0.6, low 0.2, no source 0   weight 0.15
 *   agree  = rules pass and QC says pass: 1; QC uncertain: 0.5; otherwise 0;     weight 0.20
 *            with two samples, halved when their verdicts differ
 *   − 0.08 per near miss (warn rules, close similarity or length), at most 3
 */
export function confidence(i: ConfidenceInputs) {
  const qc = i.qcScores.length ? Math.min(...i.qcScores) / 10 : 0;
  const gen = i.genBest == null ? 0 : i.genBest / 10;
  const margin = i.variants > 1 && i.genBest != null && i.genSecond != null ? clamp((i.genBest - i.genSecond) / 3) : 0.5;
  const sourced = i.sourceRule === "required" || i.sourceRule === "strict";
  const source = !sourced ? 1 : i.sourceNote ? SOURCE_SCORE[i.sourceConfidence ?? "medium"] : 0;
  const v = i.qcVerdicts[0];
  let agree = i.rulesPass && v === "pass" ? 1 : v === "uncertain" ? 0.5 : 0;
  if (i.qcVerdicts.length > 1 && new Set(i.qcVerdicts).size > 1) agree *= 0.5;
  const value = clamp(0.4 * qc + 0.15 * gen + 0.1 * margin + 0.15 * source + 0.2 * agree - 0.08 * Math.min(i.nearMisses, 3));
  return { value: Math.round(value * 1000) / 1000, parts: { qc, gen, margin, source, agree, nearMisses: i.nearMisses } };
}

/** A second, independent QC sample is taken only for a pass close to the threshold (cost control). */
export const borderline = (verdict: Verdict, conf: number, cfg: QcConfig) => verdict === "pass" && Math.abs(conf - cfg.minConfidence) <= cfg.borderline;

// ---------- decision table ----------

export type Decision = { action: "regenerate" | "auto_approve" | "needs_review"; reasons: string[] };

export function decide(o: {
  hardFails: string[];
  /** Reasons a person must look regardless of score (real person, story, sensitive words, language, trim). */
  forceReview: string[];
  verdict: Verdict | null;
  confidence: number;
  type: string;
  policy: ReviewPolicy;
  cfg: QcConfig;
  retry: number;
  pilot: boolean;
}): Decision {
  if (o.hardFails.length)
    return o.retry < o.cfg.maxRetries
      ? { action: "regenerate", reasons: o.hardFails }
      : { action: "needs_review", reasons: [`Still failing after ${o.retry} regeneration(s)`, ...o.hardFails] };
  const reasons: string[] = [];
  if (o.pilot) reasons.push("Pilot post: every pilot post is reviewed");
  if (o.policy.mode === "manual_all") reasons.push("Review policy: every post is reviewed");
  if (o.policy.forceReviewTypes.includes(o.type as never)) reasons.push(`"${o.type.replace(/_/g, " ")}" posts are always reviewed`);
  reasons.push(...o.forceReview);
  if (o.verdict !== "pass") reasons.push(o.verdict ? `QC verdict: ${o.verdict}` : "QC did not run");
  if (o.confidence < o.cfg.minConfidence) reasons.push(`Confidence ${Math.round(o.confidence * 100)}% is under the ${Math.round(o.cfg.minConfidence * 100)}% threshold`);
  return reasons.length ? { action: "needs_review", reasons } : { action: "auto_approve", reasons: [] };
}
