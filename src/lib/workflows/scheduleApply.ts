import { z } from "zod";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { bufferSchedule } from "@/lib/providers/buffer";
import { convertOnce } from "@/lib/publish";

/**
 * Step 2 of the owner's two-step flow: the drafts Buffer already holds for one task become scheduled posts.
 * Each post is its own step.run, so Inngest memoizes the ones that finished and a retry only touches the rest.
 * The job's `mode` is the state machine (draft = not converted), so nothing is ever converted twice.
 */
export const scheduleApply = inngest.createFunction(
  { id: "schedule-apply", retries: 1 },
  { event: "schedule/apply" },
  async ({ event, step }) => {
    const { taskId } = z.object({ taskId: z.string() }).parse(event.data);
    const jobs = await step.run("load", () =>
      db.publishJob.findMany({
        where: { agentTaskId: taskId, mode: "draft", postId: { not: null } },
        orderBy: { scheduledAt: "asc" },
        select: { id: true },
      }),
    );

    let scheduled = 0;
    for (const { id } of jobs) {
      const r = await step.run(`apply-${id}`, async () => {
        const j = await db.publishJob.findUniqueOrThrow({
          where: { id },
          select: { postId: true, mode: true, scheduledAt: true, platform: true, caption: true, thread: true },
        });
        const out = await convertOnce(
          { postId: j.postId, mode: j.mode, dueAt: j.scheduledAt, platform: j.platform, text: j.caption ?? "", thread: j.thread },
          { schedule: (p) => bufferSchedule(p) },
        );
        if (out.kind === "scheduled") await db.publishJob.update({ where: { id }, data: { mode: "scheduled", status: "scheduled", error: null } });
        if (out.kind === "failed") await db.publishJob.update({ where: { id }, data: { error: out.error } });
        return out.kind;
      });
      if (r === "scheduled") scheduled++;
    }
    // Buffer calls are free, so they never reach CostEntry; the quota use is a structured log instead.
    console.log(JSON.stringify({ at: "buffer", step: "schedule.apply", taskId, posts: jobs.length, calls: jobs.length, scheduled }));
  },
);
