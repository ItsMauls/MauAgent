import { z } from "zod";
import { PublishTarget } from "@/lib/publish";

export const VideoSource = z.enum(["seedance_api", "manual_upload"]);
export const Platform = z.enum(["instagram", "tiktok"]);

export const ClientBrief = z.object({
  objective: z.string().min(1),
  product: z.string().min(1),
  audience: z.string().min(1),
  kpi: z.string().default(""),
  platforms: z.array(Platform).min(1),
  budgetCapUsd: z.number().positive(),
  startDate: z.string().default(""),
  deadline: z.string().default(""),
  brandKitId: z.string().nullable().default(null),
  references: z.array(z.string()).default([]),
  defaultSource: VideoSource,
});
export type ClientBrief = z.infer<typeof ClientBrief>;

export const InternalBrief = z.object({
  problemStatement: z.string(),
  insight: z.string(),
  mandatories: z.array(z.string()),
  tone: z.string(),
  deliverables: z.array(z.object({ platform: Platform, format: z.string(), durationSec: z.number() })),
  trendRefs: z.array(z.string()),
});
export type InternalBrief = z.infer<typeof InternalBrief>;

export const CreativeBrief = z.object({
  bigIdea: z.string(),
  conceptOptions: z
    .array(z.object({ title: z.string(), logline: z.string(), whyItWorks: z.string(), hook: z.string() }))
    .length(3),
  chosenConcept: z.string().describe("title of the chosen concept, with the reasoning"),
  keyMessage: z.string(),
  cta: z.string(),
});
export type CreativeBrief = z.infer<typeof CreativeBrief>;

export const Shot = z.object({
  shotId: z.string().describe("format: shot01, shot02, ..."),
  durationSec: z.number().min(4).max(12),
  cameraMove: z.string(),
  subject: z.string(),
  setting: z.string(),
  lighting: z.string(),
  onScreenText: z.string(),
  voLine: z.string().describe("dialogue/VO in English, empty if none"),
});
export type Shot = z.infer<typeof Shot>;

export const VisualDirection = z.object({
  moodboardPrompts: z.array(z.string()),
  palette: z.array(z.string()),
  typography: z.string(),
  characterDescription: z
    .string()
    .describe("identical character description for every shot, for consistency"),
  shotList: z.array(Shot).min(1).max(6),
  styleRefImageUrls: z.array(z.string()),
});
export type VisualDirection = z.infer<typeof VisualDirection>;

export const ProductionPlan = z.object({
  shots: z.array(
    z.object({
      shotId: z.string(),
      source: VideoSource,
      resolution: z.string(),
      maxAttempts: z.number().int(),
      estCostUsd: z.number(),
    }),
  ),
  estCostUsd: z.number(),
  timeline: z.string(),
  approvalsNeeded: z.array(z.string()),
});
export type ProductionPlan = z.infer<typeof ProductionPlan>;

/** Account Team QC. costSoFar and previewUrl are computed in code, not by the LLM. */
export const ApprovalPackage = z.object({
  captionPerPlatform: z.array(z.object({ platform: Platform, caption: z.string() })),
  hashtags: z.array(z.string()),
  brandSafetyChecklist: z.array(z.object({ item: z.string(), ok: z.boolean(), note: z.string() })),
  selfScore: z.number().min(0).max(10).describe("overall quality score 0-10"),
});
export type ApprovalPackage = z.infer<typeof ApprovalPackage> & { costSoFar?: number };

/** Pipeline stages a rerun can start from (in order). */
export const STAGES = ["accountManager", "creativeDirector", "artDirector", "producer", "videographer", "postProduction"] as const;
export const Stage = z.enum(STAGES);
export type Stage = z.infer<typeof Stage>;
export const RevisionTarget = z.enum(["creativeDirector", "artDirector", "postProduction"]);

export const DecisionInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approve"), publishTargets: z.array(PublishTarget).max(10).optional() }),
  z.object({ type: z.literal("reject"), notes: z.string().max(2000).default("") }),
  z.object({ type: z.literal("revise"), notes: z.string().trim().min(1).max(2000), targetAgent: RevisionTarget.optional() }),
  z.object({ type: z.literal("regenerate"), shotIds: z.array(z.string().min(1)).min(1), confirmOverCap: z.boolean().default(false) }),
]);
export type DecisionInput = z.input<typeof DecisionInput>;

export const BudgetDecisionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("proceed") }),
  z.object({ action: z.literal("raiseCap"), newCapUsd: z.number().positive() }),
  z.object({ action: z.literal("cancel") }),
]);
export type BudgetDecisionInput = z.input<typeof BudgetDecisionInput>;

/** Text platforms Buffer can post to as text or a thread. Separate from Platform, which is video-only. */
export const TextPlatform = z.enum(["twitter", "threads"]);
export type TextPlatform = z.infer<typeof TextPlatform>;

/**
 * Socmed Specialist output: a batch of ready-to-schedule posts. `thread` holds the parts after `text`, so an empty
 * array is a single post. Buffer rejects a thread longer than 25 items in total (MAX_THREAD).
 */
const postText = z.string().trim().min(1).max(2000).describe("the post itself, or part 1 of a thread");
const postThread = z.array(z.string().trim().min(1).max(2000)).max(24).default([]).describe("further thread parts, empty for a single post");
export const ReviewStatus = z.enum(["approved", "needs_review", "rejected"]);
export const Confidence = z.enum(["high", "medium", "low"]);

/** One validated variant kept next to a post, so the owner can swap it in. */
const AltVariant = z.object({ text: postText, thread: postThread, sourceNote: z.string().nullish(), confidence: Confidence.nullish(), status: ReviewStatus, reasons: z.array(z.string()).default([]) });

/**
 * Text-post batch artifact. Batches made before content types only have text + thread; the other fields are set by
 * the content pipeline (src/lib/content): type, validation status and reasons, the AI's source and confidence, the alternatives,
 * and the slots that produced nothing usable.
 */
export const SocialPosts = z.object({
  posts: z
    .array(
      z.object({
        text: postText,
        thread: postThread,
        type: z.string().optional(),
        status: ReviewStatus.optional(),
        reasons: z.array(z.string()).default([]),
        sourceNote: z.string().nullish(),
        confidence: Confidence.nullish(),
        alternatives: z.array(AltVariant).default([]),
      }),
    )
    .min(1)
    .max(20),
  skipped: z.array(z.object({ type: z.string(), reason: z.string() })).default([]),
});
export type SocialPosts = z.infer<typeof SocialPosts>;

/** The model's answer for one post: exactly `n` variants of the picked content type. */
export const contentVariants = (n: number) =>
  z.object({
    type: z.string(),
    variants: z
      .array(
        z.object({
          text: postText,
          thread: postThread,
          sourceNote: z.string().nullable().describe("for a factual claim: the real publisher or institution, title and year of the source; null when the post states no fact"),
          confidence: Confidence.nullable().describe("for a factual claim: how sure you are that the fact and its source are real and correct (high, medium or low); null when the post states no fact"),
          needsSource: z.boolean().describe("true when a claim still has no source you can name"),
        }),
      )
      .length(n),
  });
export type ContentVariants = z.infer<ReturnType<typeof contentVariants>>;

/** A style guide distilled from the owner's own tweets. Plain text, so the owner can edit it before it is used. */
export const VoiceProfile = z.object({
  voice: z.string().trim().min(1).max(1800).describe("the style guide, a short bulleted list in plain text"),
});
export type VoiceProfile = z.infer<typeof VoiceProfile>;

/** Agent roles that have a persona (Producer/Videographer/Post-production only speak in deliberations). */
export const AGENT_ROLES = [
  "accountManager", "creativeDirector", "artDirector", "producer", "videographer", "postProduction", "accountTeam",
] as const;
export const AgentRole = z.enum(AGENT_ROLES);
export type AgentRole = z.infer<typeof AgentRole>;

/** Persona shapes tone and perspective only, never the artifact format. */
export const Persona = z.object({
  nickname: z.string().trim().min(1).max(40),
  communicationStyle: z.string().trim().min(1).max(500),
  values: z.array(z.string().trim().min(1)).min(1).max(8),
  strengths: z.array(z.string().trim().min(1)).min(1).max(8),
  blindSpots: z.array(z.string().trim().min(1)).max(8),
  signatureQuestions: z.array(z.string().trim().min(1)).max(8),
  nonNegotiables: z.array(z.string().trim().min(1)).max(8),
});
export type Persona = z.infer<typeof Persona>;

export type PromptPackage = {
  shotId: string;
  durationSec: number;
  prompt: string;
  vo: string;
  referenceNotes: string;
  fileName: string;
  tips: string;
};
