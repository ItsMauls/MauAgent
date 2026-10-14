// The campaign's flow with the role responsible for each step: the command goes to the Account Manager, who expands it
// into a detailed brief, then to the writers, the judges and the owner. Presentational: the page computes the states.
import Link from "next/link";
import type { ReactNode } from "react";

export type FlowState = "done" | "active" | "waiting" | "later" | "failed";
export type FlowStep = {
  role: string;
  /** Boards role page, when the role has one. */
  slug?: string;
  icon: string;
  does: string;
  state: FlowState;
  /** One line of what it produced or is doing now. */
  note?: string;
  detail?: ReactNode;
};

const STATE: Record<FlowState, { label: string; cls: string }> = {
  done: { label: "Done", cls: "border-emerald-200 bg-ok-soft text-emerald-800" },
  active: { label: "Working", cls: "border-blue-200 bg-brand-soft text-brand-dark" },
  waiting: { label: "Waiting", cls: "border-line bg-canvas text-ink-2" },
  later: { label: "Later phase", cls: "border-line bg-canvas text-ink-3" },
  failed: { label: "Failed", cls: "border-red-200 bg-bad-soft text-red-800" },
};

const BORDER: Record<FlowState, string> = {
  done: "border-emerald-400",
  active: "border-blue-500",
  waiting: "border-line",
  later: "border-dashed border-line",
  failed: "border-red-400",
};

/** `compact` hides each step's description (for narrow side cards). */
export function CampaignFlow({ steps, compact, horizontal }: { steps: FlowStep[]; compact?: boolean; horizontal?: boolean }) {
  if (horizontal) {
    return (
      <ol className="flex items-start py-3">
          {steps.map((s, i) => (
            <li key={s.role + i} className="flex min-w-0 flex-1 items-start">
              {i > 0 && <span className="material-symbols-outlined mt-3 shrink-0 !text-[16px] text-ink-3">chevron_right</span>}
              <div className="min-w-0 flex-1 px-0.5 text-center" title={s.does}>
                <span className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full border-2 ${BORDER[s.state]} ${s.state === "active" ? "flicker" : ""}`}>
                  <span className="material-symbols-outlined !text-[18px] text-ink-2">{s.icon}</span>
                </span>
                <div className="mt-1.5 text-[11px] leading-tight">
                  {s.slug ? <Link href={`/boards/${s.slug}`} className="font-semibold hover:text-brand">{s.role}</Link> : <b>{s.role}</b>}
                  <span className="sr-only"> ({STATE[s.state].label})</span>
                </div>
                {s.note && <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-ink-2">{s.note}</p>}
              </div>
            </li>
          ))}
        </ol>
    );
  }
  return (
    <ol className={compact ? "relative space-y-1.5 before:absolute before:bottom-4 before:left-[13px] before:top-4 before:w-0.5 before:bg-line" : "relative space-y-3 before:absolute before:bottom-6 before:left-[19px] before:top-6 before:w-0.5 before:bg-line"}>
      {steps.map((s, i) => (
        <li key={s.role + i} className={compact ? "relative flex gap-2.5" : "relative flex gap-4"}>
          <span className={`z-10 flex shrink-0 items-center justify-center rounded-full border ${compact ? "h-7 w-7" : "h-10 w-10"} ${STATE[s.state].cls} ${s.state === "active" ? "flicker" : ""}`}>
            <span className={compact ? "material-symbols-outlined !text-[16px]" : "material-symbols-outlined"}>{s.icon}</span>
          </span>
          <div className={compact ? "min-w-0 flex-1 rounded-xl border border-line px-2.5 py-1.5 text-xs" : "min-w-0 flex-1 rounded-2xl border border-line p-3"}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {!compact && <span className="text-xs font-bold text-ink-3">{i + 1}</span>}
              {s.slug ? <Link href={`/boards/${s.slug}`} className="font-semibold hover:text-brand">{s.role}</Link> : <b>{s.role}</b>}
              <span className={`pill ${STATE[s.state].cls} ${compact ? "!px-2 !py-0 text-[10px]" : ""}`}>{STATE[s.state].label}</span>
            </div>
            {!compact && <p className="mt-0.5 text-sm text-ink-2">{s.does}</p>}
            {s.note && <p className={compact ? "line-clamp-2 text-ink-2" : "mt-0.5 text-sm"}>{s.note}</p>}
            {s.detail}
          </div>
        </li>
      ))}
    </ol>
  );
}
