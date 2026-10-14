import { z } from "zod";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { estimateTask, TASKS, taskFlow, taskGate, type TaskCtx } from "@/lib/boards/tasks";
import { CHAINS } from "@/lib/boards/flows";

/** Persist the output once: the task row's artifactId is the guard, inside one transaction. */
export async function saveTaskResult(taskId: string, role: string, payload: unknown, costUsd: number) {
  await db.$transaction(async (tx) => {
    const t = await tx.agentTask.findUniqueOrThrow({ where: { id: taskId } });
    if (t.artifactId) return;
    const a = await tx.artifact.create({ data: { agentRole: role, version: t.attempt, payload: payload as object, costUsd, agentTaskId: taskId } });
    await tx.agentTask.update({ where: { id: taskId }, data: { artifactId: a.id, status: "DONE", costUsd, error: null } });
  });
}

export function taskCtx(taskId: string, settings: TaskCtx["settings"], attempt = 1): TaskCtx {
  return {
    taskId,
    settings,
    llm: { idemKey: `task:${taskId}:${attempt}`, step: `task:${taskId}` },
    artifact: async (id, role, schema) => schema.parse((await db.artifact.findFirstOrThrow({ where: { id, agentRole: role } })).payload),
    kit: (ids) => (ids.length ? db.creativeAsset.findMany({ where: { id: { in: ids } }, select: { kind: true, name: true, description: true, imageUrls: true } }) : Promise.resolve([])),
  };
}

/** One agent, nothing else: no campaign, no other stage. Idempotency: event id taskId:attempt + memoized steps. */
export const agentTask = inngest.createFunction(
  { id: "agent-task", retries: 3 },
  { event: "agent/task.requested" },
  async ({ event, step }) => {
    const { taskId } = z.object({ taskId: z.string() }).parse(event.data);
    // Step results come back JSON-serialized; everything this flow passes between steps is plain JSON already.
    const steps = { run: <T,>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T> };
    // A task scrapped while queued is gone (or no longer QUEUED): stop before any worker or paid call starts.
    const queued = await step.run("still-queued", () => db.agentTask.count({ where: { id: taskId, status: "QUEUED" } }));
    if (!queued) return { skipped: true };
    await taskFlow(steps, {
      start: async () => {
        const t = await db.agentTask.update({ where: { id: taskId }, data: { status: "RUNNING", error: null } });
        return { role: t.agentRole, input: t.input, confirmedOverCap: t.confirmedOverCap, estUsd: Number(t.estUsd) };
      },
      gate: async (estUsd) => {
        const g = await taskGate(estUsd, Number((await getSettings()).monthlyBudgetUsd));
        return g.blocked ? g.reasons.join(" ") : null;
      },
      execute: async (role, input) => {
        const def = TASKS[role];
        if (!def) throw new Error(`No direct task for ${role}`);
        const [s, t] = await Promise.all([getSettings(), db.agentTask.findUniqueOrThrow({ where: { id: taskId }, select: { attempt: true } })]);
        const settings = { campaignBudgetUsd: Number(s.campaignBudgetUsd), defaultVideoSource: s.defaultVideoSource };
        return def.run(def.input.parse(input), taskCtx(taskId, settings, t.attempt));
      },
      save: async (out) => {
        const t = await db.agentTask.findUniqueOrThrow({ where: { id: taskId }, select: { agentRole: true } });
        await saveTaskResult(taskId, t.agentRole, out.payload, out.costUsd);
      },
      fail: async (msg) => {
        await db.agentTask.updateMany({ where: { id: taskId, status: { not: "DONE" } }, data: { status: "FAILED", error: msg.slice(0, 500) } });
      },
    });
    await step.run("chain", () => chainNext(taskId));
  },
);

/** A finished task with a chain (thenRole) hands its output to the chain's roles as new tasks. Guarded per role, so a replay never makes a second one. */
export async function chainNext(taskId: string) {
  const t = await db.agentTask.findUniqueOrThrow({ where: { id: taskId }, select: { agentRole: true, status: true, artifactId: true, thenRole: true, confirmedOverCap: true } });
  const chain = t.thenRole ? CHAINS[t.thenRole] : undefined;
  if (t.status !== "DONE" || !t.artifactId || !chain) return [];
  const s = await getSettings();
  const started: string[] = [];
  for (const { agentRole, input } of chain(t.artifactId, { defaultVideoSource: s.defaultVideoSource })) {
    // The first field is the one that points at this output (internalBriefId, visualDirectionId).
    const field = Object.keys(input)[0];
    if (await db.agentTask.count({ where: { agentRole, input: { path: [field], equals: t.artifactId } } })) continue;
    const next = await db.agentTask.create({
      // The owner's over-cap confirmation covered the whole chain (the estimate included it).
      data: { agentRole, input: input as object, requestedByRole: t.agentRole, estUsd: await estimateTask(agentRole, input), confirmedOverCap: t.confirmedOverCap },
    });
    await inngest.send({ id: `${next.id}:${next.attempt}`, name: "agent/task.requested", data: { taskId: next.id } });
    started.push(next.id);
  }
  return started;
}
