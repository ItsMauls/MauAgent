import { z } from "zod";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { bufferPost } from "@/lib/providers/buffer";
import { WINDOWS, snapshotFrom } from "@/lib/providers/buffer/metrics";

/**
 * Pulls Post.metrics at T+1h, T+24h and T+7d after a post is sent. Buffer only returns metrics for a personal API key
 * (insightsRead scope): moving to OAuth would end this. A failed pull stores an empty snapshot with the reason.
 */
export const bufferMetrics = inngest.createFunction(
  { id: "buffer-metrics", retries: 1 },
  { event: "buffer/post.sent" },
  async ({ event, step }) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(event.data);
    for (const [label, wait] of WINDOWS) {
      await step.sleep(`wait-${label}`, wait);
      await step.run(`pull-${label}`, async () => {
        const job = await db.publishJob.findUniqueOrThrow({ where: { id: jobId }, select: { postId: true } });
        const metrics = job.postId
          ? await bufferPost(job.postId).then(snapshotFrom, (e) => ({ source: "buffer" as const, items: [], metricsUpdatedAt: null, reason: `Could not read metrics: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` }))
          : { source: "buffer" as const, items: [], metricsUpdatedAt: null, reason: "Post has no Buffer id" };
        await db.metricSnapshot.upsert({
          where: { publishJobId_window: { publishJobId: jobId, window: label } },
          create: { publishJobId: jobId, window: label, metrics },
          update: { metrics, capturedAt: new Date() },
        });
      });
    }
  },
);
