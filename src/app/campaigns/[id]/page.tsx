import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { presignGet } from "@/lib/s3";
import type { PromptPackage } from "@/lib/agents/schemas";
import { CopyBlock, DecisionButtons, UploadSlot } from "../../ui";
import { SourcePill, StatusPill } from "../../pills";

export const dynamic = "force-dynamic";

const STEP_STYLE: Record<string, string> = {
  done: "border-emerald-200 bg-ok-soft text-emerald-800",
  succeeded: "border-emerald-200 bg-ok-soft text-emerald-800",
  running: "border-blue-200 bg-brand-soft text-brand-dark",
  failed: "border-red-200 bg-bad-soft text-red-800",
};

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await db.campaign.findUnique({
    where: { id },
    include: {
      runs: { orderBy: { startedAt: "desc" }, take: 1, include: { steps: { orderBy: { startedAt: "asc" } } } },
      artifacts: { orderBy: [{ agentRole: "asc" }, { version: "desc" }] },
      shots: { orderBy: { shotId: "asc" }, include: { assets: { orderBy: { version: "desc" } } } },
      costs: true,
    },
  });
  if (!c) notFound();
  const preview = c.finalCutKey ? await presignGet(c.finalCutKey) : null;
  const spent = c.costs.reduce((a, x) => a + Number(x.usd), 0) + c.artifacts.reduce((a, x) => a + Number(x.costUsd), 0);
  const cap = Number(c.budgetCapUsd);
  const pct = cap ? Math.min(100, (spent / cap) * 100) : 0;
  const steps = c.runs[0]?.steps;

  return (
    <div className="space-y-6 pt-2">
      <Link href="/" className="inline-flex items-center gap-1 text-sm font-semibold text-brand">
        <span className="material-symbols-outlined !text-[18px]">arrow_back</span>Back to Campaign List
      </Link>

      <header className="card flex flex-wrap items-start justify-between gap-6 p-8">
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            <StatusPill status={c.status} />
            <SourcePill source={c.defaultSource} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{(c.clientBrief as { product?: string }).product}</h1>
        </div>
        <div className="min-w-56 rounded-2xl bg-brand-soft p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-2">
            AI Generation Cost {pct >= 90 && <span className="pill border-amber-200 bg-amber-soft text-amber-800">Near cap</span>}
          </div>
          <p className="mt-1 text-2xl font-bold">US${spent.toFixed(4)}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-right text-xs text-ink-2">/ cap US${String(c.budgetCapUsd)}</p>
        </div>
      </header>

      <section className="card p-8">
        <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
          <span className="material-symbols-outlined text-brand">hub</span>Multi-Agent Pipeline Workflow
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {steps?.map((s) => (
            <li key={s.id} className={`rounded-2xl border p-4 text-sm ${STEP_STYLE[s.status] ?? "border-line bg-canvas text-ink-2"}`}>
              <p className="font-semibold">{s.agentRole}</p>
              <p className="mt-1 text-xs">{s.status} · attempt {s.attempt}</p>
              {s.error && <p className="mt-1 text-xs text-red-700">{s.error.slice(0, 200)}</p>}
            </li>
          )) ?? <li className="text-sm text-ink-2">Not started yet. Make sure the Inngest dev server is running.</li>}
        </ol>
      </section>

      {preview && (
        <section className="card grid gap-8 p-8 md:grid-cols-[18rem_1fr]">
          <video src={preview} controls className="aspect-[9/16] w-72 rounded-3xl bg-black" />
          <div>
            <h2 className="text-2xl font-bold">Final Cut Approval</h2>
            <p className="mt-1 text-sm text-ink-2">Review the 9:16 video before it is published.</p>
            {c.status === "AWAITING_APPROVAL" && <div className="mt-6"><DecisionButtons campaignId={c.id} /></div>}
          </div>
        </section>
      )}

      <section className="card p-8">
        <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
          <span className="material-symbols-outlined text-brand">movie</span>Video Shot List ({c.shots.length})
        </h2>
        <div className="space-y-4">
          {c.shots.map((s) => {
            const pkg = s.promptPackage as PromptPackage | null;
            const lastErr = (s.assets[0]?.validation as { errors?: string[] } | null)?.errors;
            return (
              <article key={s.id} className="rounded-2xl bg-canvas p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{s.shotId}</h3>
                  <SourcePill source={s.source} />
                  <span className="pill border-line bg-white text-ink-2">{s.status}</span>
                  <span className="ml-auto text-xs text-ink-2">Versions: {s.assets.length}</span>
                </div>
                {pkg && s.status !== "ready" && (
                  <>
                    <CopyBlock label="Prompt" text={pkg.prompt} />
                    <CopyBlock label="Dialogue / VO" text={pkg.vo} />
                    <CopyBlock label="File name" text={pkg.fileName} />
                    <p className="text-sm text-ink-2">{pkg.referenceNotes}</p>
                    <p className="mb-3 text-sm text-ink-2">{pkg.tips}</p>
                  </>
                )}
                {lastErr?.length ? (
                  <p className="mb-3 rounded-xl bg-bad-soft p-3 text-sm text-red-800">Latest version rejected: {lastErr.join(" ")}</p>
                ) : null}
                {s.status !== "ready" && (s.source === "manual_upload" || s.status === "failed") && <UploadSlot shotDbId={s.id} />}
              </article>
            );
          })}
        </div>
      </section>

      <section className="card p-8">
        <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
          <span className="material-symbols-outlined text-agent">psychology</span>AI Agent Artifacts
        </h2>
        {c.artifacts.map((a) => (
          <details key={a.id} className="mb-2 rounded-2xl bg-canvas p-4">
            <summary className="cursor-pointer text-sm font-semibold">
              {a.agentRole} <span className="font-normal text-ink-2">v{a.version} · US${Number(a.costUsd).toFixed(4)}</span>
            </summary>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-white p-3 text-xs">{JSON.stringify(a.payload, null, 2)}</pre>
          </details>
        ))}
      </section>
    </div>
  );
}
