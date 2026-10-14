// Automation campaign settings: the zod schemas behind AutomationCampaign's JSON columns, with their defaults. Pure and
// client-safe (the new-campaign form reads the same defaults and limits).
import { z } from "zod";
import { CONTENT_TYPES, ContentType, CTAS, HashtagPolicy, PostLength } from "@/lib/agents/schemas";

/**
 * Platforms an automation campaign can post to, in one place. A campaign may mix platforms (text now; Instagram and
 * TikTok need a video generator first, so they are not listed yet). Add a platform here, give it a writer, and the
 * form, the planner, the worker and the account picker follow.
 */
export const AUTOMATION_PLATFORMS = ["twitter", "threads"] as const;
export type AutomationPlatform = (typeof AUTOMATION_PLATFORMS)[number];
export const isAutomationPlatform = (p: string): p is AutomationPlatform => (AUTOMATION_PLATFORMS as readonly string[]).includes(p);
export const PLATFORM_LABEL: Record<string, string> = { twitter: "X", threads: "Threads", instagram: "Instagram", tiktok: "TikTok" };

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
/** Max days a plan may span (keeps a plan to a few thousand rows). */
export const MAX_PLAN_DAYS = 366;

/**
 * Pay as you go: a campaign budget of 0 means no campaign cap. Spend is only limited by the monthly caps in Settings
 * (all providers and AI), which are still checked before every post. Stored as 0 to avoid a nullable column.
 */
export const PAY_AS_YOU_GO = 0;
export const isPayAsYouGo = (budgetCapUsd: number) => budgetCapUsd <= PAY_AS_YOU_GO;

/** Tone choices in the form; the Account Manager and the writers read them. */
export const TONES = ["casual", "witty", "professional", "inspiring", "educational", "bold", "warm", "straightforward", "storytelling"] as const;
export type Tone = (typeof TONES)[number];

/** Option lists of the form: what the posts should achieve and who they are for. The AI assistant picks from these. */
export const OBJECTIVES = ["Grow followers", "Build awareness and reach", "Spark conversation and replies", "Drive clicks to a link", "Promote an offer or product", "Establish expertise and authority", "Build a community", "Educate the audience"] as const;
export const AUDIENCE_TRAITS = ["Gen Z (13-24)", "Millennials (25-40)", "40 and older", "Students", "Young professionals", "Parents", "Entrepreneurs and founders", "Creators", "Tech workers", "Hobbyists and enthusiasts"] as const;
/** The account persona file (.md) is kept on the campaign and used as the account's writing voice; this many characters at most. */
export const PERSONA_MAX = 6000;

export const Goal = z.object({
  /** Whose account this is: a person (first person, the owner's voice) or a brand ("we", the brand's voice). */
  kind: z.enum(["personal", "brand"]).default("personal"),
  brandName: z.string().trim().max(80).optional(),
  /** What the brand sells or offers; used for promo CTAs and the brief. */
  brandOffer: z.string().trim().max(300).optional(),
  brandVoice: z.string().trim().max(500).optional(),
  /** The account persona the owner uploaded as a .md file: used as the writing voice for every post of the campaign. */
  persona: z.string().trim().max(PERSONA_MAX).optional(),
  tones: z.array(z.enum(TONES)).max(4).default([]),
  /** Content types to use; empty = the weighted mix of every type. */
  types: z.array(ContentType).default([]),
  length: PostLength.default("auto"),
  hashtags: HashtagPolicy.optional(),
  customTags: z.string().trim().max(200).optional(),
  /** Topics, words or claims the posts must stay away from (comma or line separated). */
  avoid: z.string().trim().max(500).default(""),
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
}).refine((g) => g.endDate >= g.startDate, { message: "The end date must be on or after the start date", path: ["endDate"] })
  .refine((g) => g.kind !== "brand" || !!g.brandName, { message: "Name the brand", path: ["brandName"] });
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
