import { z } from "zod";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { presignGet } from "@/lib/s3";
import { bufferPost, bufferPublish, jobStatus } from "@/lib/providers/buffer";
import { postText, publishOnce } from "@/lib/publish";
import { settleCampaign } from "@/lib/publishPlan";

const LEAD_MS = 5 * 60_000;
const POLL = ["1m", "2m", "5m", "15m"] as const; // then hourly
const MAX_POLLS = 48;
const GIVE_UP_MS = 24 * 3600_000; // after the due time

const err = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/**
 * One PublishJob → one Buffer post. A scheduled job sleeps until just before its time, so the video URL is fresh when
 * Buffer reads it. No Inngest retries: createPost is not idempotent, and publishOnce never posts a job twice.
 * After Buffer accepts the post (no webhooks exist) the job polls its status until it is sent, failed or out of time.
 */
export const publishJob = inngest.createFunction(
  { id: "publish-job", retries: 0 },
  { event: "publish/job" },
  async ({ event, step }) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(event.data);
    const job = await step.run("load", () =>
      db.publishJob.findUniqueOrThrow({ where: { id: jobId }, select: { campaignId: true, mode: true, scheduledAt: true } }),
    );
    const at = job.scheduledAt ? new Date(job.scheduledAt) : null;
    if (job.mode === "scheduled" && at && at.getTime() - LEAD_MS > Date.now()) await step.sleepUntil("wait-until-due", new Date(at.getTime() - LEAD_MS));

    const postId = await step.run("publish", async () => {
      // Atomic claim: a cancelled or already-handled job is skipped, and so is one whose time was edited to later
      // while this run slept (the run started by that edit will pick it up).
      const { count } = await db.publishJob.updateMany({ where: { id: jobId, status: { in: ["draft", "scheduled"] }, postId: null, NOT: { mode: "scheduled", scheduledAt: { gt: new Date(Date.now() + LEAD_MS + 60_000) } } }, data: { status: "publishing", error: null } });
      if (!count) return null;
      const j = await db.publishJob.findUniqueOrThrow({ where: { id: jobId }, include: { campaign: { select: { finalCutKey: true } }, socialAccount: { select: { platformUserId: true, active: true } } } });
      const r = j.socialAccount.active
        ? await publishOnce(
            { postId: j.postId, mode: j.mode, dueAt: j.scheduledAt, platform: j.platform, channelId: j.socialAccount.platformUserId, text: postText(j.caption, j.hashtags), thread: j.thread, finalCutKey: j.campaign?.finalCutKey ?? null },
            { presign: presignGet, create: (p) => bufferPublish(p) },
          )
        : ({ kind: "failed", error: "Account is disabled" } as const);
      if (r.kind === "failed") {
        await db.publishJob.update({ where: { id: jobId }, data: { status: "failed", error: r.error } });
        return null;
      }
      // Buffer holds the post from here; the first poll reports where it really is.
      await db.publishJob.update({ where: { id: jobId }, data: { postId: r.postId, status: j.mode === "draft" ? "draft" : "scheduled" } });
      return r.postId;
    });
    // A text post from a task has no campaign to settle.
    if (job.campaignId) await step.run("settle-accepted", () => settleCampaign(job.campaignId!));
    if (!postId || job.mode === "draft") return;

    let sent = false;
    let deadline = (at?.getTime() ?? Date.now()) + GIVE_UP_MS;
    for (let n = 0; n < MAX_POLLS; n++) {
      const post = await step.run(`poll-${n}`, async () => {
        try {
          const p = await bufferPost(postId);
          const status = jobStatus(p.status);
          await db.publishJob.update({
            where: { id: jobId },
            data: {
              status, lastPolledAt: new Date(), permalink: p.externalLink ?? undefined,
              error: status === "failed" ? (p.error?.message ?? "Buffer could not publish this post").slice(0, 500) : null,
              ...(p.dueAt ? { scheduledAt: new Date(p.dueAt) } : {}),
            },
          });
          return { status, dueAt: p.dueAt ?? null };
        } catch (e) {
          // Keep polling: a failed status check says nothing about the post.
          await db.publishJob.update({ where: { id: jobId }, data: { lastPolledAt: new Date(), error: `Status check failed: ${err(e)}` } });
          return { status: "scheduled" as const, dueAt: null };
        }
      });
      if (post.status === "published" || post.status === "failed") {
        sent = post.status === "published";
        break;
      }
      if (post.dueAt) deadline = new Date(post.dueAt).getTime() + GIVE_UP_MS;
      if (Date.now() > deadline) break;
      const due = post.dueAt ? new Date(post.dueAt).getTime() : 0;
      // Far-off post: sleep until it is due instead of polling for days.
      if (due - Date.now() > 20 * 60_000) await step.sleepUntil(`wait-due-${n}`, new Date(due + 60_000));
      else await step.sleep(`wait-${n}`, POLL[n] ?? "1h");
    }
    if (job.campaignId) await step.run("settle", () => settleCampaign(job.campaignId!));
    if (sent) await step.sendEvent("metrics", { name: "buffer/post.sent", data: { jobId } });
  },
);
