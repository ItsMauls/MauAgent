"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { randomUUID } from "node:crypto";
import { generateStructured } from "@/lib/ai/generate";
import { ASSIST_MAX_CHARS, assistPrompt, AssistFill, toPatch } from "@/lib/automation/assistant";
import { PERSONA_MAX } from "@/lib/automation/config";
import { contentSetup } from "@/lib/content/config";
import { automationAccounts, createAutomationCampaign } from "@/lib/automation/store";
import { automationEnv } from "@/lib/ai/env";
import { dayKey } from "@/lib/boards/agenda";
import { getSettings } from "@/lib/settings";
import { PLATFORM_LABEL } from "@/lib/automation/config";
import { decideSlot, requeueSlot, setAutomationStatus } from "@/lib/automation/worker";

const page = (id: string) => revalidatePath(`/campaigns/automation/${id}`);
const topup = (id: string) => inngest.send({ name: "automation/topup.requested", data: { campaignId: id } });

/** Creates the campaign and its whole plan (status draft). Infeasible goals and over-limit targets throw. */
export async function createAutomation(raw: unknown) {
  const c = await createAutomationCampaign(raw);
  revalidatePath("/campaigns/automation");
  return { id: c.id };
}

/** draft → piloting: the first pilotSize posts are written and QC'd, and every one of them waits for the owner. */
export async function startPilot(id: string) {
  await setAutomationStatus(id, "piloting");
  await topup(id);
  page(id);
}

/** awaiting_scale → running: the rest of the plan is generated just in time (horizonDays ahead, topped up daily). */
export async function scaleUp(id: string) {
  await setAutomationStatus(id, "running");
  await topup(id);
  page(id);
}

/** Tops up the generation window now instead of waiting for the daily run. */
export async function generateNow(id: string) {
  const c = await db.automationCampaign.findUniqueOrThrow({ where: { id }, select: { status: true } });
  if (c.status !== "running" && c.status !== "piloting") throw new Error("Generation runs only while piloting or running");
  await topup(id);
  page(id);
}

export async function pauseAutomation(id: string) {
  await setAutomationStatus(id, "paused", { pauseReason: "manual" });
  page(id);
}

/** Back to the pilot when pilot posts are still open, else to running. A budget pause needs a higher cap first. */
export async function resumeAutomation(id: string) {
  const openPilot = await db.campaignPost.count({ where: { automationCampaignId: id, pilot: true, status: { in: ["planned", "generating", "qc"] } } });
  await setAutomationStatus(id, openPilot ? "piloting" : "running", { pauseReason: null });
  await topup(id);
  page(id);
}

/** Stops for good: posts not generated yet are cancelled. Generated posts stay for the record. */
export async function cancelAutomation(id: string) {
  await setAutomationStatus(id, "cancelled", { pauseReason: null });
  await db.campaignPost.updateMany({ where: { automationCampaignId: id, status: { in: ["planned", "generating", "qc"] } }, data: { status: "cancelled" } });
  page(id);
}

export async function setBudgetCap(id: string, usd: number) {
  const capUsd = z.number().min(0.01).max(100000).parse(usd);
  await db.automationCampaign.update({ where: { id }, data: { budgetCapUsd: capUsd } });
  page(id);
}

const Decision = z.object({ slot: z.number().int().min(0), decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(500).optional() });

/** The owner's approve / reject on a post QC sent to review (stored with the policy snapshot, fed to agent feedback). */
export async function decidePost(id: string, raw: z.input<typeof Decision>) {
  const d = Decision.parse(raw);
  await decideSlot(id, d.slot, d.decision, d.note);
  page(id);
}

/** Writes a reviewed or rejected post again (one more round, fresh LLM calls; the campaign cap is checked first). */
export async function regenerateSlot(id: string, slot: number) {
  const round = await requeueSlot(id, z.number().int().min(0).parse(slot));
  if (round !== null) await inngest.send({ name: "automation/chunk", id: `regen:${id}:${slot}:${round}`, data: { campaignId: id, slots: [slot], manual: true } });
  page(id);
}

const AssistInput = z.object({ text: z.string().trim().min(1, "Describe the campaign first").max(ASSIST_MAX_CHARS), persona: z.string().max(PERSONA_MAX * 4).optional() });

/**
 * The AI Agent Assistant: one Account Manager call that reads the owner's plain-words description (and the persona
 * file, if any) and returns the form fields it could fill. Costed like every call and subject to the AI caps; it makes
 * nothing and publishes nothing, the owner still reviews the form.
 */
export async function assistFill(raw: z.input<typeof AssistInput>) {
  const { text, persona } = AssistInput.parse(raw);
  const [accounts, { timezone }] = await Promise.all([automationAccounts(), getSettings()]);
  const ctx = {
    today: dayKey(new Date(), timezone), maxPosts: automationEnv().AUTOMATION_MAX_POSTS,
    types: Object.entries(contentSetup().config.types).flatMap(([t, c]) => (c && c.weight > 0 ? [t] : [])),
    accounts: accounts.map((a) => ({ id: a.id, label: `${PLATFORM_LABEL[a.platform] ?? a.platform} @${a.handle}` })),
  };
  const out = await generateStructured(
    "accountManager", assistPrompt(text, persona?.trim() ? persona.trim() : null, ctx), AssistFill,
    { idemKey: `assist:${randomUUID()}`, step: "campaign-assistant" },
  );
  return { ...toPatch(out.payload, ctx), costUsd: out.costUsd };
}
