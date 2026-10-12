import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { presignGet } from "@/lib/s3";
import { campaignSpent } from "@/lib/cost";
import type { PromptPackage } from "@/lib/agents/schemas";
import { restoreShotAsset } from "../../actions";
import { CopyBlock, DecisionButtons, RestoreButton, UploadSlot } from "../../ui";
import { SourcePill, StatusPill } from "../../pills";

export const dynamic = "force-dynamic";

const STEP_STYLE: Record<string, string> = {
  done: "border-emerald-200 bg-ok-soft text-emerald-800",
  succeeded: "border-emerald-200 bg-ok-soft text-emerald-800",
  running: "border-blue-200 bg-brand-soft text-brand-dark",
  failed: "border-red-200 bg-bad-soft text-red-800",
};

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
      runs: { orderBy: { startedAt: "desc" }, take: 1, include: { steps: { orderBy: { startedAt: "asc" } } } },
      artifacts: { orderBy: [{ agentRole: "asc" }, { version: "desc" }] },
      shots: { orderBy: { shotId: "asc" }, include: { assets: { orderBy: { version: "desc" } } } },
      decisions: { orderBy: { createdAt: "desc" } },
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
          )) ?? <li className="text-sm text-ink-2">Not started yet. Make sure the Inngest dev server is running.</li>}
        </ol>
      </section>

      {preview && (
        <section className="card grid gap-8 p-8 md:grid-cols-[18rem_1fr]">
          <video src={preview} controls preload="metadata" aria-label="Final cut preview" className="aspect-[9/16] w-72 rounded-3xl bg-black" />
          <div>
            <h2 className="text-2xl font-bold">Final Cut Approval</h2>
            <p className="mt-1 text-sm text-ink-2">Review the 9:16 video before it is published. Captions, QC and version compare are on the Approval page.</p>
            {c.status === "AWAITING_APPROVAL" && (
              <div className="mt-6">
                <DecisionButtons campaignId={c.id} shots={c.shots.map((s) => ({ shotId: s.shotId, source: s.source }))} />
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
        {tab === "brief" && <BriefTab brief={c.clientBrief as Record<string, unknown>} />}
        {tab === "artifacts" && <ArtifactsTab campaignId={c.id} artifacts={c.artifacts} sp={sp} />}
        {tab === "shots" && <ShotsTab shots={c.shots} />}
        {tab === "assets" && <AssetsTab shots={c.shots} />}
        {tab === "decisions" && <DecisionsTab decisions={c.decisions} />}
        {tab === "publication" && (
          <Empty icon="share" text="Publishing to Instagram and TikTok is not built yet (PRD F11). Publish jobs, schedule, permalinks and Instagram quota will appear here." />
        )}
      </section>
    </div>
  );
}

const Empty = ({ icon, text }: { icon: string; text: string }) => (
  <div className="py-10 text-center text-ink-2">
    <span className="material-symbols-outlined !text-[32px] text-ink-3">{icon}</span>
    <p className="mx-auto mt-2 max-w-md text-sm">{text}</p>
  </div>
);

function BriefTab({ brief }: { brief: Record<string, unknown> }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
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
          <div key={r}>
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

/** Top-level keys whose value differs between two versions (cheap, readable diff). */
function ChangedKeys({ a, b }: { a: unknown; b: unknown }) {
  const o1 = (a ?? {}) as Record<string, unknown>, o2 = (b ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(o1), ...Object.keys(o2)])].filter((k) => JSON.stringify(o1[k]) !== JSON.stringify(o2[k]));
  return <p className="mt-3 text-sm text-ink-2">Changed fields: {keys.length ? keys.join(", ") : "none"}</p>;
}

type ShotRow = {
  id: string; shotId: string; source: string; status: string; maxAttempts: number; promptPackage: unknown;
  assets: { id: string; version: number; origin: string; durationSec: number | null; hasAudio: boolean | null; validation: unknown; createdAt: Date }[];
};

function ShotsTab({ shots }: { shots: ShotRow[] }) {
  if (!shots.length) return <Empty icon="movie" text="No shots yet. The Producer creates one slot per shot from the Art Director's shot list." />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">Generate in this order. Each card is ready to copy into the Gemini/Seedance app.</p>
      {shots.map((s, i) => {
        const pkg = s.promptPackage as PromptPackage | null;
        return (
          <article key={s.id} className="rounded-2xl bg-canvas p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">{i + 1}</span>
              <h3 className="font-semibold">{s.shotId}</h3>
              <SourcePill source={s.source} />
              <span className="pill border-line bg-white text-ink-2">{s.status}</span>
              {pkg && <span className="ml-auto text-xs text-ink-2">{pkg.durationSec}s</span>}
            </div>
            {pkg ? (
              <>
                <CopyBlock label="Final prompt" text={pkg.prompt} />
                <CopyBlock label="Dialogue / VO" text={pkg.vo} />
                <CopyBlock label="File name" text={pkg.fileName} />
                <CopyBlock label="Reference notes" text={pkg.referenceNotes} />
                <p className="mb-3 text-sm text-ink-2">{pkg.tips}</p>
                <CopyBlock
                  label="Whole card"
                  text={`${pkg.prompt}\n\nDialogue: ${pkg.vo}\n\nReferences: ${pkg.referenceNotes}\nFile name: ${pkg.fileName}\nOrder: ${i + 1} of ${shots.length}`}
                />
              </>
            ) : (
              <p className="text-sm text-ink-2">No prompt package for this shot.</p>
            )}
          </article>
        );
      })}
    </div>
  );
}

function AssetsTab({ shots }: { shots: ShotRow[] }) {
  if (!shots.length) return <Empty icon="cloud_upload" text="No upload slots yet." />;
  return (
    <div className="space-y-4">
      {shots.map((s) => {
        const uploads = s.assets.filter((a) => a.origin === "upload").length;
        return (
          <article key={s.id} className="rounded-2xl bg-canvas p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{s.shotId}</h3>
              <SourcePill source={s.source} />
              <span className="pill border-line bg-white text-ink-2">{s.status}</span>
              <span className="ml-auto text-xs text-ink-2">Uploads {uploads}/{s.maxAttempts}</span>
            </div>
            {s.status !== "ready" && (s.source === "manual_upload" || s.status === "failed") && <UploadSlot shotDbId={s.id} />}
            {s.assets.length > 0 && (
              <table className="mt-3 w-full text-left text-sm">
                <caption className="sr-only">Version history for {s.shotId}</caption>
                <thead className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2">
                  <tr><th className="py-2">Version</th><th>Origin</th><th>Duration</th><th>Audio</th><th>Validation</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {s.assets.map((a, i) => {
                    const v = a.validation as { ok?: boolean; errors?: string[]; restoredFrom?: number } | null;
                    return (
                      <tr key={a.id} className="align-top">
                        <td className="py-2">v{a.version}{i === 0 && " (latest)"}</td>
                        <td>{a.origin}{v?.restoredFrom ? ` · restored from v${v.restoredFrom}` : ""}</td>
                        <td>{a.durationSec?.toFixed(1) ?? "—"}s</td>
                        <td>{a.hasAudio == null ? "—" : a.hasAudio ? "yes" : "no"}</td>
                        <td className={v?.ok ? "text-emerald-700" : "text-red-700"}>{v?.ok ? "Passed" : v?.errors?.join(" ") || "Failed"}</td>
                        <td className="text-right">
                          {i > 0 && v?.ok && <RestoreButton label="Restore" action={restoreShotAsset.bind(null, a.id)} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </article>
        );
      })}
      <p className="text-xs text-ink-2">A restored clip is used the next time the final cut is rendered (e.g. after a post-production revision).</p>
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
