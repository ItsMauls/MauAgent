"use client";
import type { AutomationStatus } from "@prisma/client";
import { useState } from "react";
import { ErrorText, useAction } from "../../../ui";
import { cancelAutomation, decidePost, generateNow, pauseAutomation, regenerateSlot, resumeAutomation, scaleUp, setBudgetCap, startPilot } from "../actions";

/** Lifecycle buttons for the campaign's current status. */
export function Controls({ id, status, pauseReason, capUsd }: { id: string; status: AutomationStatus; pauseReason: string | null; capUsd: number }) {
  const { pending, error, run } = useAction();
  const [cap, setCap] = useState(capUsd);
  const btn = (label: string, fn: () => Promise<unknown>, cls = "btn-soft", confirmText?: string) => (
    <button type="button" className={cls} disabled={pending} onClick={() => (!confirmText || confirm(confirmText)) && run(fn)}>{label}</button>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {status === "draft" && btn("Start pilot", () => startPilot(id), "btn-primary")}
        {status === "awaiting_scale" && btn("Scale up", () => scaleUp(id), "btn-primary", "Generate the rest of the plan? Posts due within the generation window are written now, the rest day by day.")}
        {(status === "running" || status === "piloting") && btn("Generate now", () => generateNow(id))}
        {(status === "running" || status === "piloting") && btn("Pause", () => pauseAutomation(id))}
        {status === "paused" && btn("Resume", () => resumeAutomation(id), "btn-primary")}
        {!["completed", "cancelled"].includes(status) && btn("Cancel campaign", () => cancelAutomation(id), "btn-soft text-red-700", "Cancel this campaign? Posts not generated yet are cancelled. This cannot be undone.")}
      </div>
      {status === "paused" && (pauseReason === "budget" || pauseReason === "quota") && (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <p className="w-full text-amber-800">
            {pauseReason === "budget" ? "Paused at the campaign cap. Raise it to resume." : "Paused by a monthly cap (Settings or Settings → AI). Raise it there, then resume."}
          </p>
          {pauseReason === "budget" && (
            <>
              <label><span className="label">Campaign cap (US$)</span><input type="number" min={0.01} step={0.01} className="input w-32" value={cap} onChange={(e) => setCap(Number(e.target.value))} /></label>
              {btn("Save cap", () => setBudgetCap(id, cap))}
            </>
          )}
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}

/** Approve / reject / regenerate one post (slot) that QC sent to review. */
export function PostActions({ id, slot, status, hasText }: { id: string; slot: number; status: string; hasText: boolean }) {
  const { pending, error, run } = useAction();
  const small = "rounded-full border px-2.5 py-1 text-xs font-semibold disabled:opacity-50";
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1.5">
        {status === "needs_review" && hasText && (
          <button type="button" disabled={pending} className={`${small} border-emerald-200 bg-ok-soft text-emerald-800`} onClick={() => run(() => decidePost(id, { slot, decision: "approved" }))}>Approve</button>
        )}
        {status === "needs_review" && (
          <button type="button" disabled={pending} className={`${small} border-red-200 bg-bad-soft text-red-800`} onClick={() => run(() => decidePost(id, { slot, decision: "rejected", note: prompt("Why? (optional, goes to the agents as feedback)") ?? "" }))}>Reject</button>
        )}
        {(status === "needs_review" || status === "rejected") && (
          <button type="button" disabled={pending} className={`${small} border-line bg-white text-ink-2`} onClick={() => run(() => regenerateSlot(id, slot))}>Regenerate</button>
        )}
      </div>
      <ErrorText error={error} />
    </div>
  );
}
