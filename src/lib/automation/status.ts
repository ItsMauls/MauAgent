// Automation campaign lifecycle and the approval guard. Pure; tested in qc.test.ts. The DB side applies a transition
// with an atomic conditional update (WHERE status IN allowedFrom(to)), the same pattern as src/lib/status.ts.
import type { AutomationStatus } from "@prisma/client";

export const AUTOMATION_TRANSITIONS: Record<AutomationStatus, AutomationStatus[]> = {
  draft: ["piloting", "cancelled"],
  piloting: ["awaiting_scale", "paused", "cancelled"],
  awaiting_scale: ["running", "piloting", "cancelled"],
  running: ["paused", "completed", "cancelled"],
  // Resume goes back to the pilot when it had not finished, else to running.
  paused: ["piloting", "running", "cancelled"],
  completed: [],
  cancelled: [],
};

export const canMove = (from: AutomationStatus, to: AutomationStatus) => from === to || AUTOMATION_TRANSITIONS[from].includes(to);
export const allowedFromAuto = (to: AutomationStatus) => (Object.keys(AUTOMATION_TRANSITIONS) as AutomationStatus[]).filter((f) => canMove(f, to));
/** Statuses in which the worker may generate posts. */
export const GENERATING: AutomationStatus[] = ["piloting", "running"];

/**
 * A post may go to Buffer only with a stored approval: status approved, who approved it (the owner or QC under the
 * campaign's policy) and the policy snapshot at that moment. Returns the reason it may not, or null.
 */
export function approvalProblem(p: { status: string; approvalSource: string | null; approvalPolicySnapshot: unknown; text: string | null }) {
  if (p.status !== "approved") return `Post is ${p.status.replace(/_/g, " ")}, not approved`;
  if (!p.approvalSource) return "Post has no approval record";
  if (!p.approvalPolicySnapshot) return "Post has no approval policy snapshot";
  if (!p.text?.trim()) return "Post has no text";
  return null;
}

export function assertApproved(p: Parameters<typeof approvalProblem>[0]) {
  const problem = approvalProblem(p);
  if (problem) throw new Error(problem);
}
