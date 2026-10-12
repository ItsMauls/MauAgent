import type { CampaignStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { DEFAULT_PERSONAS, isAgentRole } from "@/lib/agents/persona";
import { Persona } from "@/lib/agents/schemas";
import { ROLES, roleByAgent } from "./roles";
import { GATE_OWNER, roleWork, taskTitle, type Snapshot } from "./status";

const product = (brief: unknown, id: string) => (brief as { product?: string }).product ?? id;

/** One read of everything the status derivation needs (3 small queries). Shared by the sidebar and Boards. */
export async function boardSnapshot(): Promise<Snapshot> {
  const [steps, gated, generating, tasks] = await Promise.all([
    db.step.findMany({
      where: { status: "running", run: { status: "running" } },
      select: { agentRole: true, startedAt: true, run: { select: { campaignId: true, campaign: { select: { clientBrief: true } } } } },
    }),
    db.campaign.findMany({
      where: { status: { in: Object.keys(GATE_OWNER) as CampaignStatus[] } },
      select: {
        id: true, status: true, clientBrief: true, createdAt: true,
        runs: { orderBy: { startedAt: "desc" }, take: 1, select: { steps: { where: { endedAt: { not: null } }, orderBy: { endedAt: "desc" }, take: 1, select: { endedAt: true } } } },
      },
    }),
    // The videographer has no Step rows: it is busy while Seedance shots of a running run are still pending.
    db.campaign.findMany({
      where: { status: { in: ["DRAFTING", "REGENERATING"] }, runs: { some: { status: "running" } }, shots: { some: { source: "seedance_api", status: "pending" } } },
      select: { id: true, clientBrief: true, runs: { where: { status: "running" }, take: 1, select: { startedAt: true } } },
    }),
    db.agentTask.findMany({ where: { status: { in: ["QUEUED", "RUNNING", "WAITING"] } }, select: { id: true, agentRole: true, status: true, input: true, createdAt: true } }),
  ]);
  return {
    running: [
      ...steps.map((s) => ({ agentRole: s.agentRole, campaignId: s.run.campaignId, product: product(s.run.campaign.clientBrief, s.run.campaignId), startedAt: s.startedAt })),
      ...generating.map((c) => ({ agentRole: "videographer", campaignId: c.id, product: product(c.clientBrief, c.id), startedAt: c.runs[0]?.startedAt ?? new Date() })),
    ],
    waiting: gated.map((c) => ({ campaignId: c.id, product: product(c.clientBrief, c.id), status: c.status, since: c.runs[0]?.steps[0]?.endedAt ?? c.createdAt })),
    tasks: tasks.map((t) => ({ ...t, title: taskTitle(t.input), roleSlug: roleByAgent(t.agentRole)?.slug ?? "" })),
  };
}

/** Display name per role: active persona nickname (one query), else the role label. */
export async function agentNames() {
  const rows = await db.agentProfile.findMany({ orderBy: { version: "desc" }, distinct: ["role"], select: { role: true, persona: true } });
  const fromDb = new Map(rows.map((r) => [r.role, Persona.safeParse(r.persona)]));
  return Object.fromEntries(ROLES.map((r) => {
    const p = fromDb.get(r.agentRole);
    const nick = p?.success ? p.data.nickname : isAgentRole(r.agentRole) ? DEFAULT_PERSONAS[r.agentRole].nickname : r.label;
    return [r.agentRole, nick];
  })) as Record<string, string>;
}

export function roleBadges(s: Snapshot) {
  return Object.fromEntries(ROLES.map((r) => {
    const w = roleWork(r.agentRole, s);
    return [r.slug, { state: w.state, active: w.items.length }];
  }));
}
