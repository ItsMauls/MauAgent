// Features that several agents handle together. Every direct task now starts from one of these features (the role
// dialog has no Quick task): Production pack and Final delivery run roles side by side on one picked input, and a
// chain (AgentTask.thenRole) hands a finished output to the next roles automatically.
import type { TaskCtx } from "./tasks";

type Settings = Pick<TaskCtx["settings"], "defaultVideoSource">;

export const FLOWS = {
  "production-pack": {
    /** What the owner picks: an Art Director output (visual direction). */
    pick: "artDirector",
    field: "visualDirectionId",
    steps: [
      { slug: "storyboard-artist", agentRole: "storyboardArtist" },
      { slug: "producer", agentRole: "producer", extra: (s: Settings) => ({ source: s.defaultVideoSource }) },
      { slug: "content-creator", agentRole: "videographer" },
    ],
  },
  "final-delivery": {
    pick: "campaign",
    field: "campaignId",
    steps: [
      { slug: "post-production", agentRole: "postProduction" },
      { slug: "qc", agentRole: "accountTeam" },
    ],
  },
} as const;
export type FlowSlug = keyof typeof FLOWS;

/** The input each role of a flow gets from the one pick. */
export const flowInputs = (slug: FlowSlug, pickId: string, s: Settings) => {
  const f = FLOWS[slug];
  return f.steps.map((st) => ({ slug: st.slug, agentRole: st.agentRole, input: { [f.field]: pickId, ...("extra" in st ? st.extra(s) : {}) } }));
};

/**
 * Chains, keyed by the value stored in AgentTask.thenRole: the tasks a finished output starts.
 * Concept: Account Manager → Creative Director. Production pack: Art Director → the three production roles.
 */
export const CHAINS: Record<string, (artifactId: string, s: Settings) => { agentRole: string; input: Record<string, unknown> }[]> = {
  creativeDirector: (id) => [{ agentRole: "creativeDirector", input: { internalBriefId: id } }],
  "production-pack": (id, s) => flowInputs("production-pack", id, s).map(({ agentRole, input }) => ({ agentRole, input })),
};

/** The feature a role's direct tasks live in, for links to one task (focus board, agenda, posts, feedback). */
export const FEATURE_OF: Record<string, string> = {
  socmedSpecialist: "text-posts",
  accountManager: "concept", creativeDirector: "concept",
  artDirector: "production-pack", storyboardArtist: "production-pack", producer: "production-pack", videographer: "production-pack",
  postProduction: "final-delivery", accountTeam: "final-delivery",
  talentManager: "talent",
};
export const taskHref = (agentRole: string, taskId?: string | null) =>
  `/boards/feature/${FEATURE_OF[agentRole] ?? "artifacts"}${taskId ? `?task=${taskId}` : ""}`;
