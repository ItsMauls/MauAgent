import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import type { z } from "zod";
import { db } from "@/lib/db";
import {
  ClientBrief,
  CreativeBrief,
  InternalBrief,
  ProductionPlan,
  VisualDirection,
  type PromptPackage,
} from "./schemas";

const SYSTEM_ID = "You are part of a creative agency. All output in English. Vertical 9:16 video for Reels/TikTok.";

function modelFor(role: string) {
  return process.env[`AGENT_MODEL_${role.toUpperCase()}`] ?? process.env.AGENT_MODEL_DEFAULT ?? "gemini-2.5-flash";
}

/** LLM cost from PriceBook (unit: "1M_input_tokens" / "1M_output_tokens"). No price = 0. */
async function llmCost(model: string, inTok = 0, outTok = 0) {
  const rows = await db.priceBook.findMany({
    where: { provider: "google", model, effectiveFrom: { lte: new Date() } },
    orderBy: { effectiveFrom: "desc" },
  });
  const price = (unit: string) => Number(rows.find((r) => r.unit === unit)?.unitPrice ?? 0);
  return (inTok / 1e6) * price("1M_input_tokens") + (outTok / 1e6) * price("1M_output_tokens");
}

async function callLlm<T extends z.ZodTypeAny>(role: string, schema: T, prompt: string) {
  const model = modelFor(role);
  const { object, usage } = await generateObject({ model: google(model), schema, system: SYSTEM_ID, prompt });
  return { payload: object as z.infer<T>, costUsd: await llmCost(model, usage.inputTokens, usage.outputTokens) };
}

export async function saveArtifact(campaignId: string, agentRole: string, payload: unknown, costUsd = 0, runId?: string) {
  const last = await db.artifact.findFirst({ where: { campaignId, agentRole }, orderBy: { version: "desc" } });
  return db.artifact.create({
    data: { campaignId, agentRole, version: (last?.version ?? 0) + 1, payload: payload as object, costUsd, runId },
  });
}

export const accountManager = (brief: ClientBrief, trendRefs: string[] = []) =>
  callLlm(
    "accountManager",
    InternalBrief,
    `Role: Account Manager. Turn the client brief into an internal brief.
Trend signals: ${trendRefs.length ? trendRefs.join("\n") : "(none yet)"}
Client brief: ${JSON.stringify(brief)}`,
  );

export const creativeDirector = (internal: InternalBrief) =>
  callLlm(
    "creativeDirector",
    CreativeBrief,
    `Role: Creative Director. Create exactly 3 short-video concept options, pick one and explain why.
Internal brief: ${JSON.stringify(internal)}`,
  );

export const artDirector = (creative: CreativeBrief, brief: ClientBrief) =>
  callLlm(
    "artDirector",
    VisualDirection,
    `Role: Art Director. Turn the chosen concept into visual direction and a shot list (3-5 shots, total <= 40 seconds, each shot 4-12 seconds).
Concept: ${JSON.stringify(creative)}
Product: ${brief.product}. Audience: ${brief.audience}.`,
  );

export type PriceLookup = (model: string) => number; // USD per detik video

/** Producer: deterministic, no LLM. Manual shots = US$0 (subscription quota). */
export function producer(
  visual: VisualDirection,
  opts: { defaultSource: ClientBrief["defaultSource"]; draftModel: string; resolution: string; price: PriceLookup; maxAttempts?: number },
): ProductionPlan {
  const maxAttempts = opts.maxAttempts ?? 3;
  const shots = visual.shotList.map((s) => ({
    shotId: s.shotId,
    source: opts.defaultSource,
    resolution: opts.resolution,
    maxAttempts,
    estCostUsd: opts.defaultSource === "seedance_api" ? round(s.durationSec * opts.price(opts.draftModel)) : 0,
  }));
  const estCostUsd = round(shots.reduce((a, s) => a + s.estCostUsd, 0));
  return ProductionPlan.parse({
    shots,
    estCostUsd,
    timeline: `${shots.length} shot; draft, then client approval`,
    approvalsNeeded: ["client-approval"],
  });
}

const round = (n: number) => Math.round(n * 10000) / 10000;

export function promptPackage(campaignId: string, shot: VisualDirection["shotList"][number], visual: VisualDirection): PromptPackage {
  return {
    shotId: shot.shotId,
    durationSec: shot.durationSec,
    prompt: [
      `Subject: ${visual.characterDescription}. ${shot.subject}`,
      `Setting: ${shot.setting}`,
      `Camera move: ${shot.cameraMove}`,
      `Lighting: ${shot.lighting}`,
      `Style: palette ${visual.palette.join(", ")}; ${visual.moodboardPrompts[0] ?? ""}`,
      `Vertical 9:16 ratio, ${shot.durationSec} seconds, with audio.`,
    ].join("\n"),
    vo: shot.voLine ? `"${shot.voLine}"` : "(no dialogue)",
    referenceNotes: visual.styleRefImageUrls.length
      ? `Attach references: ${visual.styleRefImageUrls.join(", ")}`
      : "Attach the last frame of the previous shot if available, to keep the character consistent.",
    fileName: `${campaignId.slice(-6)}_${shot.shotId}_v1.mp4`,
    tips: "Generate in order starting from shot01. Copy the exact same character description into every shot. Do not change the ratio.",
  };
}
