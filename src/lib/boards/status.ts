// Agent status for Boards, derived deterministically from Step / Campaign / AgentTask rows (never an LLM). Pure: tested.

export type AgentState = "busy" | "waiting" | "idle";

export type WorkItem = { key: string; title: string; stage: string; since: Date; state: Exclude<AgentState, "idle">; href: string };

export type Snapshot = {
  /** Running Steps of running Runs (plus the videographer while Seedance shots generate). */
  running: { agentRole: string; campaignId: string; product: string; startedAt: Date }[];
  /** Campaigns parked at a gate, with when the wait started. */
  waiting: { campaignId: string; product: string; status: string; since: Date }[];
  /** Direct tasks (AgentTask) that are not finished. */
  tasks: { id: string; agentRole: string; status: string; title: string; createdAt: Date; roleSlug: string }[];
};

/** Which role is "waiting" while a campaign sits at a gate. */
export const GATE_OWNER: Record<string, { role: string; stage: string }> = {
  AWAITING_VIDEO_UPLOAD: { role: "videographer", stage: "Waiting for video upload" },
  AWAITING_BUDGET: { role: "producer", stage: "Waiting for budget decision" },
  AWAITING_APPROVAL: { role: "accountTeam", stage: "Waiting for client approval" },
};

export function roleWork(agentRole: string, s: Snapshot): { state: AgentState; items: WorkItem[] } {
  const items: WorkItem[] = [
    ...s.running
      .filter((r) => r.agentRole === agentRole)
      .map((r) => ({ key: `campaign:${r.campaignId}`, title: r.product, stage: "Working", since: r.startedAt, state: "busy" as const, href: `/campaigns/${r.campaignId}` })),
    ...s.tasks
      .filter((t) => t.agentRole === agentRole)
      .map((t) => ({
        key: `task:${t.id}`, title: t.title, stage: t.status === "RUNNING" ? "Direct task" : t.status === "QUEUED" ? "Task queued" : "Task waiting",
        since: t.createdAt, state: t.status === "RUNNING" ? ("busy" as const) : ("waiting" as const), href: `/boards/${t.roleSlug}?task=${t.id}`,
      })),
    ...s.waiting
      .filter((w) => GATE_OWNER[w.status]?.role === agentRole)
      .map((w) => ({ key: `campaign:${w.campaignId}`, title: w.product, stage: GATE_OWNER[w.status].stage, since: w.since, state: "waiting" as const, href: `/campaigns/${w.campaignId}` })),
  ];
  // One entry per campaign/task: busy beats waiting.
  const seen = new Map<string, WorkItem>();
  for (const i of items) if (!seen.has(i.key) || i.state === "busy") seen.set(i.key, i);
  const list = [...seen.values()].sort((a, b) => (a.state === b.state ? a.since.getTime() - b.since.getTime() : a.state === "busy" ? -1 : 1));
  const state: AgentState = list.some((i) => i.state === "busy") ? "busy" : list.length ? "waiting" : "idle";
  return { state, items: list };
}
