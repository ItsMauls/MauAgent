import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { bufferPost, jobStatus } from "@/lib/providers/buffer";

/** One pass is capped well inside Buffer's 100 requests / 15 minutes. */
const BATCH = 50;

/**
 * Text posts have no long-lived run watching them (a scheduled one can be days out), so a cheap cron reads their
 * status from Buffer instead. Campaign video jobs keep their own poll loop: the campaignId filter leaves them alone (task and standalone text posts have none).
 *
 * A post that has just gone out sends buffer/post.sent exactly once, through a conditional update, so the existing
 * metrics function is reused as is and can never double-fire.
 */
export const bufferPostsSync = inngest.createFunction(
  { id: "buffer-posts-sync", retries: 1 },
  [{ cron: "*/15 * * * *" }, { event: "buffer/posts.sync.requested" }],
  async ({ step }) => {
    const jobs = await step.run("load", () =>
      db.publishJob.findMany({
        where: { campaignId: null, postId: { not: null }, status: { in: ["draft", "scheduled", "publishing"] } },
        orderBy: { scheduledAt: "asc" },
        take: BATCH,
        select: { id: true, postId: true },
      }),
    );
    if (!jobs.length) return { checked: 0, sent: 0 };

    const sent = await step.run("sync", async () => {
      const ids: string[] = [];
      for (const j of jobs) {
        try {
          const p = await bufferPost(j.postId!);
          const status = jobStatus(p.status);
          const { count } = await db.publishJob.updateMany({
            where: { id: j.id, status: { not: "published" } },
            data: {
              status, lastPolledAt: new Date(), permalink: p.externalLink ?? undefined,
              error: status === "failed" ? (p.error?.message ?? "Buffer could not publish this post").slice(0, 500) : null,
              ...(p.dueAt ? { scheduledAt: new Date(p.dueAt) } : {}),
            },
          });
          // Only the pass that actually moved the row to published hands it to the metrics function.
          if (status === "published" && count === 1) ids.push(j.id);
        } catch (e) {
          // A failed status check says nothing about the post, so keep the row and try again next tick.
          await db.publishJob.update({ where: { id: j.id }, data: { lastPolledAt: new Date(), error: `Status check failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` } });
        }
      }
      return ids;
    });

    console.log(JSON.stringify({ at: "buffer", step: "posts.sync", posts: jobs.length, calls: jobs.length, published: sent.length }));
    for (const jobId of sent) await step.sendEvent(`metrics-${jobId}`, { name: "buffer/post.sent", data: { jobId } });
    return { checked: jobs.length, sent: sent.length };
  },
);
