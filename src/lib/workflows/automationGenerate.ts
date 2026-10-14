// Automation campaigns: just-in-time generation. A daily cron (and "Generate now") tops up each generating campaign's
// window: it claims the slots due within horizonDays (the pilot claims its flagged slots) and fans out one
// automation/chunk event per chunk. Each chunk writes its slots one Inngest step per slot, so a failure resumes at the
// slot that failed and a retried step never re-bills (every LLM call has a stable idemKey).
import { z } from "zod";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { claimWindow, finishPilotIfDone, processSlot, releaseSlots } from "@/lib/automation/worker";
import { GENERATING } from "@/lib/automation/status";

export const automationTopup = inngest.createFunction(
  { id: "automation-topup", retries: 2, concurrency: { key: "event.data.campaignId", limit: 1 } },
  [{ cron: "TZ=Asia/Jakarta 0 2 * * *" }, { event: "automation/topup.requested" }],
  async ({ event, step }) => {
    const one = z.object({ campaignId: z.string() }).safeParse(event.data).data?.campaignId;
    const ids = one ? [one] : await step.run("campaigns", async () => (await db.automationCampaign.findMany({ where: { status: { in: GENERATING } }, select: { id: true } })).map((c) => c.id));
    for (const id of ids) {
      const claimed = await step.run(`claim-${id}`, async () => ({ at: Date.now(), chunks: await claimWindow(id) }));
      if (claimed.chunks.length)
        await step.sendEvent(`chunks-${id}`, claimed.chunks.map((slots) => ({ name: "automation/chunk", id: `chunk:${id}:${slots[0]}:${claimed.at}`, data: { campaignId: id, slots } })));
      else await step.run(`pilot-check-${id}`, () => finishPilotIfDone(id));
    }
    return { campaigns: ids.length };
  },
);

/** manual = the owner asked for these slots (regenerate): allowed while the pilot waits for scale-up. */
const Chunk = z.object({ campaignId: z.string(), slots: z.array(z.number().int()), manual: z.boolean().optional() });

export const automationChunk = inngest.createFunction(
  {
    id: "automation-chunk",
    retries: 2,
    concurrency: [{ limit: 4 }, { key: "event.data.campaignId", limit: 2 }],
    // A run that failed for good leaves no slot stuck in generating.
    onFailure: async ({ event }) => {
      const d = Chunk.safeParse(event.data.event.data).data;
      if (d) await releaseSlots(d.campaignId, d.slots);
    },
  },
  { event: "automation/chunk" },
  async ({ event, step }) => {
    const { campaignId, slots, manual } = Chunk.parse(event.data);
    const results: Record<number, unknown> = {};
    for (const [i, slot] of slots.entries()) {
      const r = await step.run(`slot-${slot}`, () => processSlot(campaignId, slot, manual));
      results[slot] = r;
      // Paused, cancelled or out of budget: hand the rest of the chunk back and stop.
      if (r.stopped) {
        await step.run("release-rest", () => releaseSlots(campaignId, slots.slice(i + 1)));
        break;
      }
    }
    await step.run("pilot-check", () => finishPilotIfDone(campaignId));
    return results;
  },
);
