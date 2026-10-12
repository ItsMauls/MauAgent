// Campaign state machine (PRD §3.1 + AWAITING_BUDGET) and Pipeline lane mapping. Pure: unit-tested in status.test.ts.
import type { CampaignStatus } from "@prisma/client";

/** Allowed next statuses. Staying in the same status is always allowed (step retries re-set it). */
export const TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFTING: ["AWAITING_BUDGET", "AWAITING_VIDEO_UPLOAD", "POST_PRODUCTION"],
  AWAITING_BUDGET: ["DRAFTING", "REJECTED", "EXPIRED"],
  AWAITING_VIDEO_UPLOAD: ["POST_PRODUCTION", "EXPIRED"],
  POST_PRODUCTION: ["AWAITING_APPROVAL"],
  AWAITING_APPROVAL: ["APPROVED", "REVISING", "REGENERATING", "REJECTED", "EXPIRED"],
  // A revision/regeneration reruns from a stage, so it re-enters the production flow before AWAITING_APPROVAL.
  REVISING: ["AWAITING_BUDGET", "AWAITING_VIDEO_UPLOAD", "POST_PRODUCTION"],
  REGENERATING: ["AWAITING_VIDEO_UPLOAD", "POST_PRODUCTION"],
  APPROVED: ["PUBLISHING"],
  PUBLISHING: ["PUBLISHED"],
  PUBLISHED: [],
  REJECTED: [],
  EXPIRED: [],
  FAILED: [],
};

const TERMINAL: CampaignStatus[] = ["PUBLISHED", "REJECTED", "EXPIRED", "FAILED"];

export function canTransition(from: CampaignStatus, to: CampaignStatus) {
  if (from === to) return true;
  // Permanent failure after retries can happen from any non-terminal status.
  if (to === "FAILED") return !TERMINAL.includes(from);
  return TRANSITIONS[from].includes(to);
}

/** Every status that may move to `to` (used for an atomic conditional update). */
export const allowedFrom = (to: CampaignStatus) =>
  (Object.keys(TRANSITIONS) as CampaignStatus[]).filter((from) => canTransition(from, to));

/** Agent lanes on the Pipeline board, in pipeline order. */
export const LANES = ["accountManager", "creativeDirector", "artDirector", "producer", "videographer", "postProduction", "accountTeam"] as const;
export type Lane = (typeof LANES)[number];
export type LaneState = "queued" | "running" | "done" | "failed" | "reused";

type StepRow = { agentRole: string; status: string; attempt: number; startedAt: Date; endedAt: Date | null; error: string | null };

export type LaneView = { state: LaneState; attempts: number; durationMs: number | null; error: string | null };

/**
 * State of one lane for the latest run. `hasArtifact` marks stages a rerun skipped (their earlier output is reused).
 * The videographer has no Step rows (many small Inngest steps), so its state comes from the shot slots.
 */
export function laneView(
  lane: Lane,
  steps: StepRow[],
  o: { hasArtifact: boolean; shots: { status: string }[]; runFailed: boolean },
): LaneView {
  if (lane === "videographer") {
    const { shots } = o;
    const state: LaneState = !shots.length
      ? "queued"
      : shots.every((s) => s.status === "ready")
        ? "done"
        : shots.some((s) => s.status === "failed" || s.status === "invalid")
          ? "failed"
          : "running";
    return { state, attempts: 0, durationMs: null, error: null };
  }
  const rows = steps.filter((s) => s.agentRole === lane).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const last = rows.at(-1);
  if (!last) return { state: o.hasArtifact ? "reused" : "queued", attempts: 0, durationMs: null, error: null };
  // A "running" row in a run that already failed was killed mid-step: show it as failed.
  const state: LaneState = last.status === "done" ? "done" : last.status === "failed" || o.runFailed ? "failed" : "running";
  return {
    state,
    attempts: rows.length,
    durationMs: last.endedAt ? last.endedAt.getTime() - last.startedAt.getTime() : null,
    error: rows.findLast((r) => r.error)?.error ?? null,
  };
}

export function formatDuration(ms: number | null) {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
