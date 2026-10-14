// Automation campaign settings: the zod schemas behind AutomationCampaign's JSON columns, with their defaults. Pure and
// client-safe (the new-campaign form reads the same defaults and limits).
import { z } from "zod";
import { CONTENT_TYPES, CTAS } from "@/lib/agents/schemas";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
/** Max days a plan may span (keeps a plan to a few thousand rows). */
export const MAX_PLAN_DAYS = 366;

export const Goal = z.object({
  targetPosts: z.number().int().min(1),
  accountIds: z.array(z.string().min(1)).min(1, "Pick at least one account"),
  startDate: Day,
  endDate: Day,
  pillars: z.array(z.string().trim().min(1).max(200)).min(1, "Add at least one pillar or topic").max(30),
  audience: z.string().trim().min(1).max(500),
  objective: z.string().trim().max(500).default(""),
  /** auto = follow the audience or topic language (the same rule as text batches). */
  language: z.enum(["auto", "id", "en"]).default("auto"),
  cta: z.enum(CTAS).default("none"),
  linkUrl: z.url().optional(),
  kpiTarget: z.object({ metric: z.enum(["reach", "clicks", "followers"]), value: z.number().int().min(0) }).optional(),
}).refine((g) => g.endDate >= g.startDate, { message: "The end date must be on or after the start date", path: ["endDate"] });
export type Goal = z.infer<typeof Goal>;

export const PlanConfig = z.object({
  /** Posts per account per day. Every account gets every text, so this is also texts per day. */
  maxPostsPerDay: z.number().int().min(1).max(24).default(4),
  /** Active window in the owner's time zone, [start hour, end hour). */
  activeHours: z.tuple([z.number().int().min(0).max(23), z.number().int().min(1).max(24)]).default([8, 22])
    .refine(([a, b]) => b > a, "The active window must end after it starts"),
  /** 0 = Monday … 6 = Sunday. */
  quietWeekdays: z.array(z.number().int().min(0).max(6)).default([]),
  weekdayWeights: z.array(z.number().min(0)).length(7).default([1, 1, 1, 1, 1, 1, 1]),
  minGapMinutes: z.number().int().min(5).max(720).default(90),
  jitterMinutes: z.number().int().min(0).max(120).default(20),
});
export type PlanConfig = z.infer<typeof PlanConfig>;

/**
 * Types always reviewed by a person by default: educational posts state facts whose sources nobody verified, and story
 * posts are written from the topic, not a real event. The owner may empty the list.
 */
export const DEFAULT_FORCE_REVIEW = ["educational", "story"];

export const ReviewPolicy = z.object({
  /** There is no mode without QC: qc_auto auto-approves confident posts, manual_all sends every post to review. */
  mode: z.enum(["qc_auto", "manual_all"]).default("qc_auto"),
  forceReviewTypes: z.array(z.enum(CONTENT_TYPES)).default(DEFAULT_FORCE_REVIEW as (typeof CONTENT_TYPES)[number][]),
});
export type ReviewPolicy = z.infer<typeof ReviewPolicy>;

export const QcConfig = z.object({
  minConfidence: z.number().min(0.5).max(1).default(0.8),
  maxRetries: z.number().int().min(0).max(3).default(2),
  /** |confidence − minConfidence| at or under this = borderline: a second QC sample decides. */
  borderline: z.number().min(0).max(0.3).default(0.1),
});
export type QcConfig = z.infer<typeof QcConfig>;

export const GenerationConfig = z.object({
  variantsPerPost: z.number().int().min(1).max(3).default(3),
  /** Only posts due within this many days are generated (a daily top-up keeps the window full). */
  horizonDays: z.number().int().min(1).max(30).default(10),
  chunkSize: z.number().int().min(1).max(20).default(8),
  pilotSize: z.number().int().min(1).max(30).default(10),
});
export type GenerationConfig = z.infer<typeof GenerationConfig>;
