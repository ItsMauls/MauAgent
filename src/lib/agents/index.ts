import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  ApprovalPackage,
  ClientBrief,
  CreativeBrief,
  RevisionTarget,
  InternalBrief,
  ProductionPlan,
  VisualDirection,
  type PromptPackage,
} from "./schemas";

import { getPersona, isAgentRole, personaSystem, SYSTEM_ID } from "./persona";
import { recallMemory, type MemoryCtx } from "./memory";

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

async function callLlm<T extends z.ZodTypeAny>(role: string, schema: T, prompt: string, mem?: MemoryCtx) {
  const model = modelFor(role);
  // Persona is read per call, so a DB edit applies to the next run. The schema still fixes the output format.
  // Memory is recalled only inside a pipeline run (mem set), within the token budget from Settings.
  const system = isAgentRole(role)
    ? personaSystem(role, (await getPersona(role)).persona) + (mem ? await recallMemory(role, mem) : "")
    : SYSTEM_ID;
  const { object, usage } = await generateObject({ model: google(model), schema, system, prompt });
  return { payload: object as z.infer<T>, costUsd: await llmCost(model, usage.inputTokens, usage.outputTokens) };
}

export async function saveArtifact(campaignId: string, agentRole: string, payload: unknown, costUsd = 0, runId?: string) {
  const last = await db.artifact.findFirst({ where: { campaignId, agentRole }, orderBy: { version: "desc" } });
  return db.artifact.create({
    data: { campaignId, agentRole, version: (last?.version ?? 0) + 1, payload: payload as object, costUsd, runId },
  });
}

export const accountManager = (brief: ClientBrief, trendRefs: string[] = [], mem?: MemoryCtx) =>
  callLlm(
    "accountManager",
    InternalBrief,
    `Role: Account Manager. Turn the client brief into an internal brief.
Trend signals: ${trendRefs.length ? trendRefs.join("\n") : "(none yet)"}
Client brief: ${JSON.stringify(brief)}`,
    mem,
  );

/** Client revision notes are appended to the prompt of the agent the revision is routed to. */
const withNotes = (prompt: string, notes?: string) => (notes ? `${prompt}\nClient revision notes (must be addressed): ${notes}` : prompt);

export const creativeDirector = (internal: InternalBrief, notes?: string, mem?: MemoryCtx) =>
  callLlm(
    "creativeDirector",
    CreativeBrief,
    withNotes(
      `Role: Creative Director. Create exactly 3 short-video concept options, pick one and explain why.
Internal brief: ${JSON.stringify(internal)}`,
      notes,
    ),
    mem,
  );

export const artDirector = (creative: CreativeBrief, brief: ClientBrief, notes?: string, mem?: MemoryCtx) =>
  callLlm(
    "artDirector",
    VisualDirection,
    withNotes(
      `Role: Art Director. Turn the chosen concept into visual direction and a shot list (3-5 shots, total <= 40 seconds, each shot 4-12 seconds).
Concept: ${JSON.stringify(creative)}
Product: ${brief.product}. Audience: ${brief.audience}.`,
      notes,
    ),
    mem,
  );

// ponytail: text-only QC over the artifacts; switch to Gemini multimodal on the final cut when file upload is wired.
/** Account Team QC (F9): captions, hashtags, brand-safety checklist, self score. */
export const accountTeam = (brief: ClientBrief, creative: CreativeBrief, visual: VisualDirection, mem?: MemoryCtx) =>
  callLlm(
    "accountTeam",
    ApprovalPackage,
    `Role: Account Team. QC the deliverable against the brief and prepare the approval package:
one caption per platform (${brief.platforms.join(", ")}), hashtags, a brand-safety checklist (claims, sensitive topics, AI-content label, licensed music) and a 0-10 self score.
Brief: ${JSON.stringify(brief)}
Concept: ${JSON.stringify(creative)}
Shot list: ${JSON.stringify(visual.shotList)}`,
    mem,
  );

/** Revision routing (F10): a small LLM picks which stage the client's note targets. */
export const routeRevision = (notes: string) =>
  callLlm(
    "router",
    z.object({ target: RevisionTarget }),
    `Classify this client revision note. creativeDirector = concept/idea/message/hook; artDirector = visuals/shots/look/characters; postProduction = edit/pacing/subtitles/music/timing.
Note: ${notes}`,
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
