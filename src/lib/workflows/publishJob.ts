import { z } from "zod";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { presignGet } from "@/lib/s3";
import { bufferPublish } from "@/lib/providers/buffer";

const LEAD_MS = 5 * 60_000;

/**
 * One PublishJob → one Buffer post. A scheduled job sleeps in Inngest until just before its time, so the video URL is
 * fresh when Buffer reads it, then hands Buffer the exact due time. No retries: createPost is not idempotent.
 */
export const publishJob = inngest.createFunction(
  { id: "publish-job", retries: 0 },
  { event: "publish/job" },
  async ({ event, step }) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(event.data);
    const job = await step.run("load", () =>
      db.publishJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { scheduledAt: true, campaign: { select: { finalCutKey: true } }, socialAccount: { select: { platformUserId: true, active: true } } },
      }),
    );
    const at = job.scheduledAt ? new Date(job.scheduledAt) : null;
    if (at && at.getTime() - LEAD_MS > Date.now()) await step.sleepUntil("wait-until-due", new Date(at.getTime() - LEAD_MS));

    await step.run("publish", async () => {
      // Atomic claim: a cancelled or already-handled job is skipped.
      const { count } = await db.publishJob.updateMany({ where: { id: jobId, status: { in: ["draft", "scheduled"] } }, data: { status: "publishing", error: null } });
      if (!count) return;
      try {
        const j = await db.publishJob.findUniqueOrThrow({ where: { id: jobId } });
        if (!job.campaign.finalCutKey) throw new Error("Campaign has no final cut");
        if (!job.socialAccount.active) throw new Error("Account is inactive");
        if (j.platform === "tiktok" && !j.caption) throw new Error("TikTok needs a caption");
        const text = [j.caption, j.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")].filter(Boolean).join("\n\n");
        const future = at && at.getTime() > Date.now() + 60_000;
        const postId = await bufferPublish({
          channelId: job.socialAccount.platformUserId, service: j.platform, text,
          videoUrl: await presignGet(job.campaign.finalCutKey, 6 * 3600), dueAt: future ? at : undefined,
        });
        // A future due time means Buffer holds the post: it stays scheduled.
        await db.publishJob.update({ where: { id: jobId }, data: { postId, status: future ? "scheduled" : "published" } });
      } catch (e) {
        await db.publishJob.update({ where: { id: jobId }, data: { status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } });
      }
    });
  },
);
