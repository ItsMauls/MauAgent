import Link from "next/link";
import type { CampaignStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatDuration, LANES, laneView, type LaneState } from "@/lib/status";
import { AutoRefresh } from "../../ui";
import { StatusPill } from "../../pills";

export const dynamic = "force-dynamic";

const PATH = "/campaigns/workflow";

const LANE_LABEL: Record<string, string> = {
  accountManager: "Account Manager",
  creativeDirector: "Creative Director",
  artDirector: "Art Director",
  producer: "Producer",
  videographer: "Videographer",
  postProduction: "Post-production",
  accountTeam: "Account Team (QC)",
};

// [label, node classes, icon, connector dot classes]
const STATE_STYLE: Record<LaneState, [string, string, string, string]> = {
  queued: ["Queued", "border-line bg-canvas text-ink-2", "schedule", "bg-white border-line text-ink-3"],
  running: ["Running", "border-blue-200 bg-brand-soft text-brand-dark", "progress_activity", "bg-brand border-brand text-white"],
  done: ["Done", "border-emerald-200 bg-ok-soft text-emerald-800", "check_circle", "bg-ok border-ok text-white"],
  failed: ["Failed", "border-red-300 bg-bad-soft text-red-800", "error", "bg-bad border-bad text-white"],
  reused: ["Reused", "border-line bg-white text-ink-3", "history", "bg-white border-line text-ink-3"],
};

const FILTERS = {
  active: { label: "In progress", where: { status: { notIn: ["PUBLISHED", "REJECTED", "EXPIRED", "FAILED"] as CampaignStatus[] } } },
  failed: { label: "Failed", where: { status: "FAILED" as CampaignStatus } },
  all: { label: "All", where: {} },
} satisfies Record<string, { label: string; where: Prisma.CampaignWhereInput }>;
type Filter = keyof typeof FILTERS;

type Search = { filter?: string; campaign?: string; step?: string };

export default async function WorkflowPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const filter: Filter = sp.filter && sp.filter in FILTERS ? (sp.filter as Filter) : "active";
  const [campaigns, failedCount] = await Promise.all([
    db.campaign.findMany({
      where: FILTERS[filter].where,
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        runs: { orderBy: { startedAt: "desc" }, take: 1, include: { steps: true } },
        artifacts: { select: { agentRole: true } },
        shots: { select: { status: true } },
        publishJobs: { orderBy: { createdAt: "desc" }, select: { id: true, platform: true, status: true, error: true, socialAccount: { select: { handle: true } } } },
      },
    }),
    db.campaign.count({ where: { status: "FAILED" } }),
  ]);

  return (
    <div className="space-y-6 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workflow</h1>
          <p className="mt-2 text-ink-2">Each campaign&apos;s agent chain from the latest run, step by step.</p>
        </div>
        <AutoRefresh seconds={10} />
      </div>

      {failedCount > 0 && filter !== "failed" && (
        <Link href={`${PATH}?filter=failed`} role="alert" className="flex items-center gap-3 rounded-2xl border border-red-300 bg-bad-soft p-4 text-sm font-semibold text-red-800">
          <span className="material-symbols-outlined">error</span>
          {failedCount} campaign{failedCount === 1 ? " has" : "s have"} failed permanently. Review →
        </Link>
      )}

      <nav aria-label="Filter campaigns" className="flex flex-wrap gap-2">
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <Link
            key={f}
            href={`${PATH}?filter=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${f === filter ? "bg-brand text-white" : "bg-white text-ink-2 hover:bg-brand-soft"}`}
          >
            {FILTERS[f].label}
          </Link>
        ))}
      </nav>

      {sp.campaign && sp.step && <StepLog campaignId={sp.campaign} step={sp.step} filter={filter} />}

      {!campaigns.length && <div className="card p-12 text-center text-ink-2">No campaigns in this view.</div>}

      {campaigns.map((c, i) => {
        const run = c.runs[0];
        const failed = c.status === "FAILED";
        const product = (c.clientBrief as { product?: string }).product ?? "—";
        const views = LANES.map((lane) => ({
          lane,
          v: laneView(lane, run?.steps ?? [], {
            hasArtifact: c.artifacts.some((a) => a.agentRole === lane),
            shots: lane === "videographer" ? c.shots : [],
            runFailed: run?.status === "failed",
          }),
        }));
        const doneCount = views.filter(({ v }) => v.state === "done" || v.state === "reused").length;
        return (
          // Root node = campaign; children = agents linked in pipeline order (each points to the next).
          <details key={c.id} open={i < 3 || failed || c.id === sp.campaign} className={`card group overflow-hidden ${failed ? "border-2 border-red-300" : ""}`}>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-6 py-4">
              <span className="material-symbols-outlined text-ink-3 transition group-open:rotate-90" aria-hidden>chevron_right</span>
              <span className="material-symbols-outlined text-brand" aria-hidden>account_tree</span>
              <span className="text-lg font-bold">{product}</span>
              <StatusPill status={c.status} />
              <span className="text-xs font-semibold text-ink-2">{doneCount}/{LANES.length} agents done</span>
              <span className="ml-auto text-xs text-ink-2">
                {run ? <>Run {run.status} · started {run.startedAt.toLocaleString("en-US")}{run.inngestRunId && <> · Inngest <code>{run.inngestRunId}</code></>}</> : "No run yet"}
              </span>
            </summary>
            <div className="border-t border-line px-6 pb-6 pt-4">
              <Link href={`/campaigns/${c.id}`} className="text-sm font-semibold text-brand hover:underline">Open campaign →</Link>
              {c.publishJobs.length > 0 && (
                <ul aria-label="Publishing" className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                  {c.publishJobs.map((j) => (
                    <li key={j.id} title={j.error ?? undefined} className={`pill ${j.status === "failed" ? "border-red-300 bg-bad-soft text-red-800" : j.status === "published" ? "border-emerald-200 bg-ok-soft text-emerald-800" : "border-line bg-white text-ink-2"}`}>
                      {j.platform} @{j.socialAccount.handle}: {j.status}
                    </li>
                  ))}
                </ul>
              )}
              <ol aria-label={`${product} agent chain`} className="mt-4 ml-4">
                {views.map(({ lane, v }, li) => {
                  const [label, cls, icon, dot] = STATE_STYLE[v.state];
                  const last = li === views.length - 1;
                  return (
                    <li key={lane} className="relative flex gap-4 pb-4 last:pb-0">
                      {/* Link to the next node */}
                      {!last && <span aria-hidden className={`absolute left-[15px] top-8 h-[calc(100%-2rem)] w-0.5 ${v.state === "done" || v.state === "reused" ? "bg-ok" : "bg-line"}`} />}
                      <span aria-hidden className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${dot}`}>{li + 1}</span>
                      <div className={`flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border px-4 py-3 text-xs ${cls}`}>
                        <p className="text-sm font-semibold">{LANE_LABEL[lane]}</p>
                        <p className="flex items-center gap-1 font-semibold">
                          <span className="material-symbols-outlined !text-[16px]" aria-hidden>{icon}</span>{label}
                        </p>
                        {v.attempts > 0 && <p>{formatDuration(v.durationMs)} · {v.attempts} attempt{v.attempts === 1 ? "" : "s"}{v.attempts > 1 && ` (${v.attempts - 1} retr${v.attempts === 2 ? "y" : "ies"})`}</p>}
                        <div className="ml-auto flex flex-wrap gap-x-3 font-semibold">
                          {(v.state === "done" || v.state === "reused") && lane !== "videographer" && (
                            <Link href={`/campaigns/${c.id}?tab=artifacts#artifact-${lane}`} className="text-brand underline-offset-2 hover:underline">Artifact</Link>
                          )}
                          {lane === "videographer" && c.shots.length > 0 && (
                            <Link href={`/campaigns/${c.id}?tab=assets`} className="text-brand underline-offset-2 hover:underline">Shots</Link>
                          )}
                          {v.attempts > 0 && (
                            <Link href={`${PATH}?filter=${filter}&campaign=${c.id}&step=${lane}`} className={`underline-offset-2 hover:underline ${v.error ? "text-red-800" : "text-ink-2"}`}>
                              Log
                            </Link>
                          )}
                        </div>
                        {v.error && <p className="line-clamp-3 w-full break-words text-red-700" title={v.error}>{v.error}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** Step log for one campaign + step across all runs (PRD §6: logs per campaignId and step). */
async function StepLog({ campaignId, step, filter }: { campaignId: string; step: string; filter: Filter }) {
  const rows = await db.step.findMany({
    where: { agentRole: step, run: { campaignId } },
    orderBy: { startedAt: "desc" },
    include: { run: { select: { id: true, inngestRunId: true, status: true } } },
  });
  return (
    <section aria-label="Step log" className="card p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Log: {LANE_LABEL[step] ?? step} · <code className="text-xs">{campaignId}</code></h2>
        <Link href={`${PATH}?filter=${filter}`} className="text-sm font-semibold text-brand">Close</Link>
      </div>
      {!rows.length && <p className="text-sm text-ink-2">No step records.</p>}
      <ol className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl bg-canvas p-3 text-xs">
            <p className="font-semibold">
              {r.status} · attempt {r.attempt} · {r.startedAt.toLocaleString("en-US")} ·{" "}
              {formatDuration(r.endedAt ? r.endedAt.getTime() - r.startedAt.getTime() : null)} · run {r.run.status}
              {r.run.inngestRunId && <> · Inngest <code>{r.run.inngestRunId}</code></>}
            </p>
            {r.error && <pre className="mt-2 whitespace-pre-wrap break-words text-red-800">{r.error}</pre>}
          </li>
        ))}
      </ol>
    </section>
  );
}
