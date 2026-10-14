import Link from "next/link";
import type { AgentFeedback } from "@prisma/client";
import { db } from "@/lib/db";
import { ROLES, roleByAgent } from "@/lib/boards/roles";
import { taskHref } from "@/lib/boards/flows";
import { addFeedback } from "./actions";

const SENTIMENT = {
  positive: { icon: "thumb_up", cls: "text-emerald-700", label: "Positive" },
  neutral: { icon: "remove", cls: "text-ink-2", label: "Neutral" },
  negative: { icon: "thumb_down", cls: "text-red-700", label: "Negative" },
} as const;
const SOURCE: Record<string, string> = { client_decision: "Client decision", qc: "QC", metrics: "Metrics", owner_note: "Owner note" };

/** Thumbs + short comment aimed at one agent. Without `agentRole` the owner picks the agent. */
export function FeedbackForm({ agentRole, campaignId, compact = false }: { agentRole?: string; campaignId?: string; compact?: boolean }) {
  return (
    <form action={addFeedback} className="space-y-2">
      {campaignId && <input type="hidden" name="campaignId" value={campaignId} />}
      {agentRole ? (
        <input type="hidden" name="agentRole" value={agentRole} />
      ) : (
        <label className="block">
          <span className="label">For agent</span>
          <select name="agentRole" required className="input">
            {ROLES.map((r) => <option key={r.slug} value={r.agentRole}>{r.label}</option>)}
          </select>
        </label>
      )}
      <fieldset className="flex gap-2">
        <legend className="sr-only">Sentiment</legend>
        {(["positive", "negative"] as const).map((s, i) => (
          <label key={s} className="pill cursor-pointer border-line bg-white px-3 py-1.5 text-ink-2 has-checked:border-brand has-checked:bg-brand-soft has-checked:text-brand has-focus-visible:ring-2 has-focus-visible:ring-brand/40">
            <input type="radio" name="sentiment" value={s} defaultChecked={i === 0} className="sr-only" />
            <span aria-hidden className="material-symbols-outlined !text-[16px]">{SENTIMENT[s].icon}</span>
            <span className={compact ? "sr-only" : ""}>{SENTIMENT[s].label}</span>
          </label>
        ))}
      </fieldset>
      <label className="block">
        <span className="sr-only">Comment</span>
        <input name="text" required maxLength={500} placeholder="Short comment…" className="input py-2 text-sm" />
      </label>
      <button className="btn-soft px-4 py-1.5 text-sm">Add feedback</button>
    </form>
  );
}

/** Raw feedback, always with its source and a link to it. */
export function FeedbackList({ rows, showAgent = false }: { rows: (Pick<AgentFeedback, "id" | "agentRole" | "campaignId" | "agentTaskId" | "source" | "sentiment" | "text" | "createdAt">)[]; showAgent?: boolean }) {
  if (!rows.length) return <p className="rounded-2xl bg-canvas p-4 text-sm text-ink-2">No feedback yet.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((f) => {
        const s = SENTIMENT[f.sentiment];
        const href = f.campaignId ? `/campaigns/${f.campaignId}?tab=decisions` : f.agentTaskId ? taskHref(f.agentRole, f.agentTaskId) : null;
        return (
          <li key={f.id} className="flex gap-3 rounded-2xl bg-canvas p-3 text-sm">
            <span className={`material-symbols-outlined !text-[18px] ${s.cls}`} aria-label={s.label}>{s.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block whitespace-pre-wrap">{f.text}</span>
              <span className="mt-1 flex flex-wrap gap-2 text-xs text-ink-2">
                {showAgent && <span className="font-semibold">{roleByAgent(f.agentRole)?.label ?? f.agentRole}</span>}
                <span>{SOURCE[f.source]}</span>
                <span>{f.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                {href && <Link href={href} className="font-semibold text-brand">Source</Link>}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Campaign detail (Decisions tab): this campaign's feedback per agent, and a form to add some. */
export async function CampaignFeedback({ campaignId }: { campaignId: string }) {
  const rows = await db.agentFeedback.findMany({ where: { campaignId }, orderBy: { createdAt: "desc" } });
  return (
    <section aria-labelledby="cfb-h" className="mt-8 grid gap-6 border-t border-line pt-6 md:grid-cols-2">
      <div className="space-y-3">
        <h3 id="cfb-h" className="font-semibold">Agent feedback</h3>
        <FeedbackList rows={rows} showAgent />
      </div>
      <div>
        <h3 className="mb-3 font-semibold">Add feedback</h3>
        <FeedbackForm campaignId={campaignId} />
      </div>
    </section>
  );
}
