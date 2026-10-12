import type { Prisma } from "@prisma/client";

// Boards archive: which sections a (type, agent) filter shows, plus small pure helpers. Search is Postgres ILIKE only.

export const ARCHIVE_TYPES = {
  campaigns: "Campaign history",
  reports: "Reports",
  videos: "Video",
  talent: "Talent",
  assets: "Assets",
  prompts: "Prompt packages",
  notes: "Discussion notes",
  feedback: "Feedback",
} as const;
export type ArchiveType = keyof typeof ARCHIVE_TYPES;
export const PAGE_SIZE = 3;

/**
 * Agent roles that produce each kind of item. "any" = every role can appear, and the section's query filters by role
 * itself (campaigns the role worked on, notes aimed at it, cost spent by it).
 */
const OWNERS: Record<ArchiveType, readonly string[] | "any"> = {
  campaigns: "any",
  reports: "any",
  notes: "any",
  feedback: "any",
  videos: ["videographer", "postProduction"],
  talent: ["talentManager"],
  assets: ["videographer"], // the library lives in the Content Creator workspace
  prompts: ["videographer"],
};

export const isArchiveType = (t: string | undefined): t is ArchiveType => !!t && t in ARCHIVE_TYPES;

/** Agent AND type: a section is shown when it matches the type filter and the agent can own it. */
export function archiveSections(type?: string, agent?: string): ArchiveType[] {
  return (Object.keys(ARCHIVE_TYPES) as ArchiveType[]).filter(
    (t) => (!isArchiveType(type) || t === type) && (!agent || OWNERS[t] === "any" || OWNERS[t].includes(agent)),
  );
}

/** ILIKE pattern with the user's % and _ taken literally. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const pageOf = (v: string | undefined) => Math.max(0, Math.floor(Number(v) || 0));

/** Change vs the previous period. null when there is nothing to compare. */
export function delta(cur: number, prev: number) {
  if (!prev) return cur ? { dir: "up" as const, pct: null } : null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return { dir: pct > 0 ? ("up" as const) : pct < 0 ? ("down" as const) : ("flat" as const), pct };
}

/** Campaigns an agent worked on: it has an artifact there (the videographer: the campaign has shots). */
export const workedOn = (agent: string): Prisma.CampaignWhereInput =>
  agent === "videographer" ? { shots: { some: {} } } : { artifacts: { some: { agentRole: agent } } };
