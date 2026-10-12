import { z } from "zod";

export const VideoSource = z.enum(["seedance_api", "manual_upload"]);
export const Platform = z.enum(["instagram", "tiktok"]);

export const ClientBrief = z.object({
  objective: z.string().min(1),
  product: z.string().min(1),
  audience: z.string().min(1),
  kpi: z.string().default(""),
  platforms: z.array(Platform).min(1),
  budgetCapUsd: z.number().positive(),
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

export type PromptPackage = {
  shotId: string;
  durationSec: number;
  prompt: string;
  vo: string;
  referenceNotes: string;
  fileName: string;
  tips: string;
};
