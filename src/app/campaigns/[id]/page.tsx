import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { presignGet } from "@/lib/s3";
import { campaignSpent } from "@/lib/cost";
import { ApprovalDecision } from "../../approval/decision";
import { PublicationTab } from "./publication";
import { AssetsTab, ChangedKeys, Empty, ShotsTab } from "./shots";
import { CampaignFeedback } from "../../boards/feedback";
import { SourcePill, StatusPill } from "../../pills";
import { LiveRefresh } from "./live";

export const dynamic = "force-dynamic";

const STEP_STYLE: Record<string, string> = {
  done: "border-emerald-200 bg-ok-soft text-emerald-800",
  succeeded: "border-emerald-200 bg-ok-soft text-emerald-800",
  running: "border-blue-200 bg-brand-soft text-brand-dark",
  failed: "border-red-200 bg-bad-soft text-red-800",
};

/** Statuses where the pipeline is working, so the page polls. */
const LIVE = ["DRAFTING", "POST_PRODUCTION", "REVISING", "REGENERATING", "PUBLISHING"];

const TABS = [
  ["brief", "Brief"],
  ["artifacts", "Artifacts"],
  ["shots", "Shots & Prompt Package"],
  ["assets", "Assets"],
  ["decisions", "Decisions"],
  ["publication", "Publication"],
] as const;
type Tab = (typeof TABS)[number][0];

type Search = { tab?: string; role?: string; a?: string; b?: string };

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const tab: Tab = TABS.some(([t]) => t === sp.tab) ? (sp.tab as Tab) : "brief";
  const c = await db.campaign.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      runs: { orderBy: { startedAt: "desc" }, take: 1, include: { steps: { orderBy: { startedAt: "asc" } } } },
      artifacts: { orderBy: [{ agentRole: "asc" }, { version: "desc" }] },
      shots: { orderBy: { shotId: "asc" }, include: { assets: { orderBy: { version: "desc" } } } },
      decisions: { orderBy: { createdAt: "desc" } },
      creativeAssets: { select: { id: true, kind: true, name: true } },
    },
  });
  if (!c) notFound();
  const preview = c.finalCutKey ? await presignGet(c.finalCutKey) : null;
  const spent = await campaignSpent(c.id);
  const cap = Number(c.budgetCapUsd);
  const pct = cap ? Math.min(100, (spent / cap) * 100) : 0;
  const steps = c.runs[0]?.steps;

  return (
    <div className="space-y-6 pt-2">
      <Link href="/campaigns" className="inline-flex items-center gap-1 text-sm font-semibold text-brand">
        <span className="material-symbols-outlined !text-[18px]">arrow_back</span>Back to Campaign List
      </Link>

      <header className="card flex flex-wrap items-start justify-between gap-6 p-8">
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            <StatusPill status={c.status} />
            <SourcePill source={c.defaultSource} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{(c.clientBrief as { product?: string }).product}</h1>
          {c.status === "AWAITING_BUDGET" && (
            <Link href="/approval" className="mt-3 inline-block text-sm font-semibold text-amber-800">Budget gate is waiting for your decision →</Link>
          )}
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
          ))}
          {!steps?.length && (
            <li className="text-sm text-ink-2">
              {steps
                ? "Run started, waiting for the first agent…"
                : c.status === "FAILED"
                  ? "The run could not be started. Start the Inngest dev server (npm run dev:all) and submit the brief again."
                  : `Queued, waiting for Inngest (${Math.round((Date.now() - c.createdAt.getTime()) / 1000)}s). If this stays here, run npm run dev:all.`}
            </li>
          )}
        </ol>
      </section>

      <section className="card p-8">
        <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
          <span className="material-symbols-outlined text-brand">forum</span>Agent Sessions
          {LIVE.includes(c.status) && <span className="pill border-blue-200 bg-brand-soft text-brand-dark">live</span>}
        </h2>
        {c.messages.length === 0 ? (
          <p className="text-sm text-ink-2">No messages yet. Agents post here as they start, finish and hand work to each other.</p>
        ) : (
          <ol className="space-y-2">
            {c.messages.map((m) => (
              <li key={m.id} className={`rounded-2xl p-3 text-sm ${m.kind === "error" ? "bg-bad-soft text-red-800" : "bg-canvas"}`}>
                <p className="text-xs font-semibold text-ink-2">
                  {m.agentRole}{m.toRole ? ` → ${m.toRole}` : ""} · {m.kind} · {m.createdAt.toLocaleTimeString("en-US")}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{m.content}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
      <LiveRefresh active={LIVE.includes(c.status)} />

      {preview && (
        <section className="card grid gap-8 p-8 md:grid-cols-[18rem_1fr]">
          <video src={preview} controls preload="metadata" aria-label="Final cut preview" className="aspect-[9/16] w-72 rounded-3xl bg-black" />
          <div>
            <h2 className="text-2xl font-bold">Final Cut Approval</h2>
            <p className="mt-1 text-sm text-ink-2">Review the 9:16 video before it is published. Captions, QC and version compare are on the Approval page.</p>
            {c.status === "AWAITING_APPROVAL" && (
              <div className="mt-6">
                <ApprovalDecision c={c} />
              </div>
            )}
          </div>
        </section>
      )}

      <nav aria-label="Campaign sections" className="flex flex-wrap gap-2">
        {TABS.map(([t, label]) => (
          <Link
            key={t}
            href={`/campaigns/${c.id}?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${t === tab ? "bg-brand text-white" : "bg-white text-ink-2 hover:bg-brand-soft"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <section className="card p-8">
        {tab === "brief" && <BriefTab brief={c.clientBrief as Record<string, unknown>} kit={c.creativeAssets} />}
        {tab === "artifacts" && <ArtifactsTab campaignId={c.id} artifacts={c.artifacts} sp={sp} />}
        {tab === "shots" && <ShotsTab shots={c.shots} />}
        {tab === "assets" && <AssetsTab shots={c.shots} />}
        {tab === "decisions" && <><DecisionsTab decisions={c.decisions} /><CampaignFeedback campaignId={c.id} /></>}
        {tab === "publication" && <PublicationTab campaignId={c.id} status={c.status} />}
      </section>
    </div>
  );
}

function BriefTab({ brief, kit }: { brief: Record<string, unknown>; kit: { id: string; kind: string; name: string }[] }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <dt className="label">Creative kit</dt>
        <dd className="text-sm">
          {kit.map((a) => `${a.name} (${a.kind})`).join(", ") || "—"}{" "}
          <Link href="/boards/feature/library" className="font-semibold text-brand">Edit links →</Link>
        </dd>
      </div>
      {Object.entries(brief).map(([k, v]) => (
        <div key={k}>
          <dt className="label">{k}</dt>
          <dd className="whitespace-pre-wrap text-sm">{Array.isArray(v) ? v.join(", ") || "—" : v === null || v === "" ? "—" : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

type ArtifactRow = { id: string; agentRole: string; version: number; payload: unknown; costUsd: unknown; createdAt: Date };

function ArtifactsTab({ campaignId, artifacts, sp }: { campaignId: string; artifacts: ArtifactRow[]; sp: Search }) {
  if (!artifacts.length) return <Empty icon="psychology" text="No artifacts yet. Agents save their output here as they finish." />;
  const roles = [...new Set(artifacts.map((a) => a.agentRole))];
  const role = sp.role && roles.includes(sp.role) ? sp.role : null;
  const versions = role ? artifacts.filter((a) => a.agentRole === role) : [];
  const pick = (v?: string) => versions.find((a) => a.version === Number(v));
  const [left, right] = [pick(sp.a) ?? versions[1], pick(sp.b) ?? versions[0]];
  const base = `/campaigns/${campaignId}?tab=artifacts`;

  return (
    <div className="space-y-6">
      {roles.map((r) => {
        const list = artifacts.filter((a) => a.agentRole === r);
        return (
          <div key={r} id={`artifact-${r}`} className="scroll-mt-20">
            <div className="mb-2 flex items-center gap-3">
              <h3 className="font-semibold">{r}</h3>
              <span className="text-xs text-ink-2">{list.length} version{list.length === 1 ? "" : "s"}</span>
              {list.length > 1 && (
                <Link href={`${base}&role=${r}`} className="ml-auto text-sm font-semibold text-brand">Compare versions</Link>
              )}
            </div>
            {list.map((a) => (
              <details key={a.id} className="mb-2 rounded-2xl bg-canvas p-4">
                <summary className="cursor-pointer text-sm font-semibold">
                  v{a.version} <span className="font-normal text-ink-2">· US${Number(a.costUsd).toFixed(4)} · {a.createdAt.toLocaleString("en-US")}</span>
                </summary>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-white p-3 text-xs">{JSON.stringify(a.payload, null, 2)}</pre>
              </details>
            ))}
          </div>
        );
      })}

      {role && left && right && (
        <div className="rounded-2xl border border-line p-4">
          <h3 className="mb-3 font-semibold">Compare {role}: v{left.version} ↔ v{right.version}</h3>
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            {versions.map((v) => (
              <Link key={v.id} href={`${base}&role=${role}&a=${v.version}&b=${right.version}`} className="pill border-line bg-white text-ink-2 hover:text-brand">
                left = v{v.version}
              </Link>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[left, right].map((a) => (
              <pre key={a.id} className="max-h-[32rem] overflow-auto rounded-xl bg-canvas p-3 text-xs">
                {JSON.stringify(a.payload, null, 2)}
              </pre>
            ))}
          </div>
          <ChangedKeys a={left.payload} b={right.payload} />
        </div>
      )}
    </div>
  );
}

function DecisionsTab({ decisions }: { decisions: { id: string; type: string; notes: string | null; targetAgent: string | null; shotIds: string[]; createdAt: Date }[] }) {
  if (!decisions.length) return <Empty icon="gavel" text="No decisions yet." />;
  return (
    <ol className="space-y-3">
      {decisions.map((d) => (
        <li key={d.id} className="rounded-2xl bg-canvas p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill border-line bg-white font-bold capitalize text-ink">{d.type}</span>
            {d.targetAgent && <span className="text-ink-2">→ {d.targetAgent}</span>}
            {d.shotIds.length > 0 && <span className="text-ink-2">shots: {d.shotIds.join(", ")}</span>}
            <time className="ml-auto text-xs text-ink-2">{d.createdAt.toLocaleString("en-US")}</time>
          </div>
          {d.notes && <p className="mt-2 whitespace-pre-wrap">{d.notes}</p>}
        </li>
      ))}
    </ol>
  );
}
