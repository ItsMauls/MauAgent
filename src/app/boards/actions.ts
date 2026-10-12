"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { getSettings } from "@/lib/settings";
import { ClientBrief } from "@/lib/agents/schemas";
import { roleBySlug } from "@/lib/boards/roles";
import { estimateTask, refIds, taskGate, TASKS } from "@/lib/boards/tasks";

function taskDef(slug: string) {
  const role = roleBySlug(z.string().parse(slug));
  const def = role && TASKS[role.agentRole];
  if (!role || !def) throw new Error("This role has no direct task");
  return { role, def };
}

/** Deterministic estimate + monthly-cap check shown before a task runs. Re-done in requestTask and in Inngest. */
export async function estimateTaskAction(slug: string, raw: unknown) {
  const { role, def } = taskDef(slug);
  const input = def.input.parse(raw);
  const refs = await db.artifact.findMany({ where: { id: { in: refIds(input) } }, select: { payload: true } });
  const estUsd = await estimateTask(role.agentRole, input, refs.reduce((n, r) => n + JSON.stringify(r.payload).length, 0));
  const s = await getSettings();
  const gate = await taskGate(estUsd, Number(s.monthlyBudgetUsd));
  return { estUsd, monthUsd: gate.monthUsd, monthCapUsd: Number(s.monthlyBudgetUsd), blocked: gate.blocked, reasons: gate.reasons };
}

export async function requestTask(slug: string, raw: unknown, confirmOverCap: boolean) {
  const { role, def } = taskDef(slug);
  const input = def.input.parse(raw);
  const est = await estimateTaskAction(slug, input);
  // The cap is enforced here, not only in the UI: over cap needs the explicit confirmation.
  if (est.blocked && !z.boolean().parse(confirmOverCap)) throw new Error(`${est.reasons.join(" ")} Confirm to run anyway.`);
  const t = await db.agentTask.create({
    data: { agentRole: role.agentRole, input: input as object, estUsd: est.estUsd, confirmedOverCap: est.blocked && confirmOverCap },
  });
  await inngest.send({ id: `${t.id}:${t.attempt}`, name: "agent/task.requested", data: { taskId: t.id } });
  revalidatePath("/boards", "layout");
}

/** New attempt of a failed task (same input). Event id taskId:attempt keeps each attempt idempotent. */
export async function retryTask(taskId: string) {
  const t = await db.agentTask.findUniqueOrThrow({ where: { id: z.string().parse(taskId) } });
  if (t.status !== "FAILED") throw new Error("Only a failed task can be retried");
  const next = await db.agentTask.update({ where: { id: t.id }, data: { status: "QUEUED", attempt: { increment: 1 }, error: null } });
  await inngest.send({ id: `${t.id}:${next.attempt}`, name: "agent/task.requested", data: { taskId: t.id } });
  revalidatePath("/boards", "layout");
}

/** Artifacts to copy into the new campaign: the task output and, recursively, the artifacts its input pointed at. */
async function seedChain(artifactId: string) {
  const out: { id: string; agentRole: string; payload: unknown; agentTaskId: string | null }[] = [];
  const queue = [artifactId];
  while (queue.length && out.length < 10) {
    const a = await db.artifact.findUnique({ where: { id: queue.shift()! }, select: { id: true, agentRole: true, payload: true, agentTaskId: true } });
    if (!a || out.some((x) => x.agentRole === a.agentRole)) continue;
    out.push(a);
    if (a.agentTaskId) {
      const t = await db.agentTask.findUnique({ where: { id: a.agentTaskId }, select: { input: true } });
      queue.push(...refIds(t?.input));
    }
  }
  return out;
}

/**
 * "Send to flow": a new campaign whose earlier stages are the task's artifacts (copied, cost 0, so nothing is
 * billed twice), started at the next stage. The normal brief → pipeline path is untouched.
 */
export async function sendTaskToFlow(taskId: string, form: FormData) {
  const t = await db.agentTask.findUniqueOrThrow({ where: { id: z.string().parse(taskId) } });
  const def = TASKS[t.agentRole];
  if (t.status !== "DONE" || !t.artifactId || !def?.next) throw new Error("This task's output cannot start a campaign");
  if (t.campaignId) redirect(`/campaigns/${t.campaignId}`);

  const brief = ClientBrief.parse({
    objective: form.get("objective"),
    product: form.get("product"),
    audience: form.get("audience"),
    platforms: form.getAll("platforms"),
    budgetCapUsd: Number(form.get("budgetCapUsd")),
    defaultSource: form.get("defaultSource"),
  });
  const chain = await seedChain(t.artifactId);
  const input = (t.input ?? {}) as { characterIds?: string[]; locationIds?: string[]; styleIds?: string[] };
  const kit = [...(input.characterIds ?? []), ...(input.locationIds ?? []), ...(input.styleIds ?? [])];

  const c = await db.$transaction(async (tx) => {
    const c = await tx.campaign.create({
      data: {
        clientBrief: brief, budgetCapUsd: brief.budgetCapUsd, defaultSource: brief.defaultSource,
        creativeAssets: { connect: kit.map((id) => ({ id })) },
      },
    });
    for (const a of chain)
      await tx.artifact.create({ data: { campaignId: c.id, agentRole: a.agentRole, version: 1, payload: a.payload as object, costUsd: 0, agentTaskId: a.agentTaskId } });
    await tx.agentTask.update({ where: { id: t.id }, data: { campaignId: c.id } });
    return c;
  });
  await inngest.send({ name: "campaign/brief.submitted", data: { campaignId: c.id, from: def.next } });
  redirect(`/campaigns/${c.id}`);
}
