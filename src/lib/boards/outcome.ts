// Outcome of a campaign, overall or for one agent's part in it. Deterministic; definitions in DECISIONS.md. Tested.
import { revisedRole } from "@/lib/agents/memory";

export type Outcome = "success" | "needs_revision" | "rejected" | "failed" | "expired" | "in_progress";

export const OUTCOME: Record<Outcome, [string, string]> = {
  success: ["Succeeded", "border-emerald-200 bg-ok-soft text-emerald-800"],
  needs_revision: ["Needed revision", "border-amber-200 bg-amber-soft text-amber-800"],
  rejected: ["Rejected", "border-red-200 bg-bad-soft text-red-800"],
  failed: ["Failed", "border-red-200 bg-bad-soft text-red-800"],
  expired: ["Expired", "border-slate-200 bg-slate-50 text-slate-700"],
  in_progress: ["In progress", "border-blue-200 bg-brand-soft text-brand-dark"],
};

type Decision = { type: string; targetAgent: string | null; notes: string | null };

/**
 * Rejected / failed / expired come from the campaign status. A delivered campaign (APPROVED, or PUBLISHED once
 * publishing exists) is a success, or needs_revision when the client sent a revision/regenerate — aimed at `role`
 * when one is given, any when not. Everything else is still in progress.
 */
export function outcomeLabel(status: string, decisions: Decision[], role?: string): Outcome {
  if (status === "REJECTED") return "rejected";
  if (status === "FAILED") return "failed";
  if (status === "EXPIRED") return "expired";
  if (status !== "APPROVED" && status !== "PUBLISHED") return "in_progress";
  const revised = decisions.map(revisedRole).filter(Boolean);
  return (role ? revised.includes(role) : revised.length > 0) ? "needs_revision" : "success";
}
