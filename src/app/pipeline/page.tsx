import Link from "next/link";
import type { CampaignStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatDuration, LANES, laneView, type LaneState } from "@/lib/status";
import { AutoRefresh } from "../ui";
import { StatusPill } from "../pills";

export const dynamic = "force-dynamic";

const LANE_LABEL: Record<string, string> = {
  accountManager: "Account Manager",
  creativeDirector: "Creative Director",
  artDirector: "Art Director",
  producer: "Producer",
  videographer: "Videographer",
  postProduction: "Post-production",
  accountTeam: "Account Team (QC)",
};

const STATE_STYLE: Record<LaneState, [string, string, string]> = {
  queued: ["Queued", "border-line bg-canvas text-ink-2", "schedule"],
  running: ["Running", "border-blue-200 bg-brand-soft text-brand-dark", "progress_activity"],
  done: ["Done", "border-emerald-200 bg-ok-soft text-emerald-800", "check_circle"],
  failed: ["Failed", "border-red-300 bg-bad-soft text-red-800", "error"],
  reused: ["Reused", "border-line bg-white text-ink-3", "history"],
};

const FILTERS = {
  active: { label: "In progress", where: { status: { notIn: ["PUBLISHED", "REJECTED", "EXPIRED", "FAILED"] as CampaignStatus[] } } },
  failed: { label: "Failed", where: { status: "FAILED" as CampaignStatus } },
  all: { label: "All", where: {} },
} satisfies Record<string, { label: string; where: Prisma.CampaignWhereInput }>;
type Filter = keyof typeof FILTERS;

type Search = { filter?: string; campaign?: string; step?: string };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Search> }) {
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
      },
    }),
    db.campaign.count({ where: { status: "FAILED" } }),
  ]);

  return (
    <div className="space-y-6 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pipeline</h1>
          <p className="mt-2 text-ink-2">Status of every agent per campaign, from the latest run.</p>
        </div>
        <AutoRefresh seconds={10} />
      </div>

      {failedCount > 0 && filter !== "failed" && (
        <Link href="/pipeline?filter=failed" role="alert" className="flex items-center gap-3 rounded-2xl border border-red-300 bg-bad-soft p-4 text-sm font-semibold text-red-800">
          <span className="material-symbols-outlined">error</span>
          {failedCount} campaign{failedCount === 1 ? " has" : "s have"} failed permanently. Review →
        </Link>
      )}

      <nav aria-label="Filter campaigns" className="flex flex-wrap gap-2">
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <Link
            key={f}
            href={`/pipeline?filter=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${f === filter ? "bg-brand text-white" : "bg-white text-ink-2 hover:bg-brand-soft"}`}
          >
            {FILTERS[f].label}
          </Link>
        ))}
      </nav>

      {sp.campaign && sp.step && <StepLog campaignId={sp.campaign} step={sp.step} />}

      {!campaigns.length && <div className="card p-12 text-center text-ink-2">No campaigns in this view.</div>}

      {campaigns.map((c) => {
        const run = c.runs[0];
        const failed = c.status === "FAILED";
        const product = (c.clientBrief as { product?: string }).product ?? "—";
        return (
          <section key={c.id} aria-label={product} className={`card overflow-hidden ${failed ? "border-2 border-red-300" : ""}`}>
            <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4">
              <Link href={`/campaigns/${c.id}`} className="text-lg font-bold hover:text-brand">{product}</Link>
              <StatusPill status={c.status} />
              <span className="ml-auto text-xs text-ink-2">
                {run ? <>Run {run.status} · started {run.startedAt.toLocaleString("en-US")}{run.inngestRunId && <> · Inngest run <code>{run.inngestRunId}</code></>}</> : "No run yet"}
              </span>
            </header>
            <div className="overflow-x-auto">
              <ol className="grid min-w-[980px] grid-cols-7 gap-3 p-4">
                {LANES.map((lane) => {
                  const v = laneView(lane, run?.steps ?? [], {
                    hasArtifact: c.artifacts.some((a) => a.agentRole === lane),
                    shots: lane === "videographer" ? c.shots : [],
                    runFailed: run?.status === "failed",
                  });
                  const [label, cls, icon] = STATE_STYLE[v.state];
                  return (
                    <li key={lane} className={`flex flex-col gap-1 rounded-2xl border p-3 text-xs ${cls}`}>
                      <p className="text-sm font-semibold">{LANE_LABEL[lane]}</p>
                      <p className="flex items-center gap-1 font-semibold">
                        <span className="material-symbols-outlined !text-[16px]" aria-hidden>{icon}</span>{label}
                      </p>
                      {v.attempts > 0 && <p>{formatDuration(v.durationMs)} · {v.attempts} attempt{v.attempts === 1 ? "" : "s"}{v.attempts > 1 && ` (${v.attempts - 1} retr${v.attempts === 2 ? "y" : "ies"})`}</p>}
                      {v.error && <p className="line-clamp-3 break-words text-red-700" title={v.error}>{v.error}</p>}
                      <div className="mt-auto flex flex-wrap gap-x-3 pt-1 font-semibold">
                        {(v.state === "done" || v.state === "reused") && lane !== "videographer" && (
                          <Link href={`/campaigns/${c.id}?tab=artifacts#artifact-${lane}`} className="text-brand underline-offset-2 hover:underline">Artifact</Link>
                        )}
                        {lane === "videographer" && c.shots.length > 0 && (
                          <Link href={`/campaigns/${c.id}?tab=assets`} className="text-brand underline-offset-2 hover:underline">Shots</Link>
                        )}
                        {v.attempts > 0 && (
                          <Link href={`/pipeline?filter=${filter}&campaign=${c.id}&step=${lane}`} className={`underline-offset-2 hover:underline ${v.error ? "text-red-800" : "text-ink-2"}`}>
                            Log
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Step log for one campaign + step across all runs (PRD §6: logs per campaignId and step). */
async function StepLog({ campaignId, step }: { campaignId: string; step: string }) {
  const rows = await db.step.findMany({
    where: { agentRole: step, run: { campaignId } },
    orderBy: { startedAt: "desc" },
    include: { run: { select: { id: true, inngestRunId: true, status: true } } },
  });
  return (
    <section aria-label="Step log" className="card p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Log: {LANE_LABEL[step] ?? step} · <code className="text-xs">{campaignId}</code></h2>
        <Link href="/pipeline" className="text-sm font-semibold text-brand">Close</Link>
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
