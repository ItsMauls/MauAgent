import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { presignGet } from "@/lib/s3";
import { budgetGate, campaignSpent, monthSpent } from "@/lib/cost";
import type { ApprovalPackage, ProductionPlan } from "@/lib/agents/schemas";
import { restoreFinalCut, getSettings } from "../actions";
import { BudgetGatePanel, DecisionButtons, RestoreButton } from "../ui";
import { QUEUE_STATUSES, StatusPill } from "../pills";

export const dynamic = "force-dynamic";

export default async function ApprovalPage() {
  const [campaigns, settings, month] = await Promise.all([
    db.campaign.findMany({
      where: { status: { in: [...QUEUE_STATUSES] } },
      orderBy: { createdAt: "asc" },
      include: {
        shots: { orderBy: { shotId: "asc" } },
        artifacts: { where: { agentRole: { in: ["producer", "postProduction"] } }, orderBy: { version: "desc" } },
      },
    }),
    getSettings(),
    monthSpent(),
  ]);

  return (
    <div className="space-y-6 pt-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Approval</h1>
        <p className="mt-2 text-ink-2">Campaigns waiting for your decision, a budget confirmation, or video uploads.</p>
      </div>

      {!campaigns.length && (
        <div className="card p-12 text-center text-ink-2">
          Nothing is waiting for you. <Link href="/campaigns" className="font-semibold text-brand">Back to campaigns →</Link>
        </div>
      )}

      {QUEUE_STATUSES.map((status) => {
        const group = campaigns.filter((c) => c.status === status);
        if (!group.length) return null;
        return (
          <section key={status} className="space-y-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <StatusPill status={status} /> <span className="text-sm text-ink-2">{group.length}</span>
            </h2>
            {group.map((c) => (
              <Card key={c.id} c={c} monthSpentUsd={month} monthCapUsd={Number(settings.monthlyBudgetUsd)} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

type QueueCampaign = Prisma.CampaignGetPayload<{ include: { shots: true; artifacts: true } }>;

async function Card({ c, monthSpentUsd, monthCapUsd }: { c: QueueCampaign; monthSpentUsd: number; monthCapUsd: number }) {
  const product = (c.clientBrief as { product?: string }).product ?? "—";
  const spent = await campaignSpent(c.id);
  const cap = Number(c.budgetCapUsd);
  const head = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Link href={`/campaigns/${c.id}`} className="text-xl font-bold hover:text-brand">{product}</Link>
      <span className="text-sm text-ink-2">Cost so far <b className="text-ink">US${spent.toFixed(2)}</b> / cap US${cap.toFixed(2)}</span>
    </div>
  );

  if (c.status === "AWAITING_BUDGET") {
    const plan = c.artifacts.find((a) => a.agentRole === "producer")?.payload as ProductionPlan | undefined;
    const g = { estUsd: plan?.estCostUsd ?? 0, spentUsd: spent, capUsd: cap, monthSpentUsd, monthCapUsd };
    return (
      <article key={c.id} className="card space-y-4 p-6">
        {head}
        <BudgetGatePanel campaignId={c.id} gate={{ ...g, reasons: budgetGate(g).reasons }} />
      </article>
    );
  }

  if (c.status === "AWAITING_VIDEO_UPLOAD") {
    const open = c.shots.filter((s) => s.status !== "ready");
    return (
      <article key={c.id} className="card space-y-2 p-6">
        {head}
        <p className="text-sm text-ink-2">
          {open.length} of {c.shots.length} shot slots still need a valid MP4: {open.map((s) => s.shotId).join(", ")}.
        </p>
        <Link href={`/campaigns/${c.id}?tab=assets`} className="btn-soft">
          <span className="material-symbols-outlined">cloud_upload</span>Open upload slots
        </Link>
      </article>
    );
  }

  const pkg = c.approvalPackage as ApprovalPackage | null;
  const cuts = c.artifacts.filter((a) => a.agentRole === "postProduction");
  const [current, previous] = await Promise.all(
    cuts.slice(0, 2).map(async (a) => ({ version: a.version, url: await presignGet((a.payload as { finalCut: string }).finalCut) })),
  );
  const preview = c.finalCutKey ? await presignGet(c.finalCutKey) : current?.url;
  return (
    <article key={c.id} className="card space-y-5 p-6">
      {head}
      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        <div className="space-y-3">
          {preview ? (
            <video src={preview} controls preload="metadata" aria-label="Final cut preview" className="aspect-[9/16] w-64 rounded-3xl bg-black" />
          ) : (
            <p className="text-sm text-ink-2">No final cut yet.</p>
          )}
        </div>
        <div className="space-y-4 text-sm">
          {pkg ? (
            <>
              <div className="flex flex-wrap gap-2">
                <span className="pill border-blue-200 bg-brand-soft text-brand-dark">Self score {pkg.selfScore}/10</span>
                <span className="pill border-line bg-white text-ink-2">QC cost so far US${(pkg.costSoFar ?? 0).toFixed(2)}</span>
              </div>
              {pkg.captionPerPlatform.map((p) => (
                <div key={p.platform}>
                  <p className="label">{p.platform} caption</p>
                  <p className="whitespace-pre-wrap">{p.caption}</p>
                </div>
              ))}
              <p className="text-brand">{pkg.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}</p>
              <div>
                <p className="label">Brand-safety checklist</p>
                <ul className="space-y-1">
                  {pkg.brandSafetyChecklist.map((b) => (
                    <li key={b.item} className="flex gap-2">
                      <span className={`material-symbols-outlined !text-[18px] ${b.ok ? "text-ok" : "text-bad"}`} aria-label={b.ok ? "OK" : "Issue"}>
                        {b.ok ? "check_circle" : "error"}
                      </span>
                      <span><b>{b.item}</b>{b.note ? ` — ${b.note}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <p className="text-ink-2">No approval package (QC) for this version.</p>
          )}
          <DecisionButtons campaignId={c.id} shots={c.shots.map((s) => ({ shotId: s.shotId, source: s.source }))} />
        </div>
      </div>

      {previous && (
        <details className="rounded-2xl bg-canvas p-4">
          <summary className="cursor-pointer text-sm font-semibold">Compare with previous version (v{previous.version})</summary>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:max-w-xl">
            {[current, previous].map((v) => (
              <figure key={v.version} className="space-y-2">
                <video src={v.url} controls preload="metadata" aria-label={`Final cut v${v.version}`} className="aspect-[9/16] w-full rounded-2xl bg-black" />
                <figcaption className="flex items-center justify-between text-xs text-ink-2">
                  v{v.version}
                  {v === previous && <RestoreButton label="Restore (free)" action={restoreFinalCut.bind(null, c.id, v.version)} />}
                </figcaption>
              </figure>
            ))}
          </div>
          <Link href={`/campaigns/${c.id}?tab=artifacts`} className="mt-3 inline-block text-sm font-semibold text-brand">All versions and artifact diffs →</Link>
        </details>
      )}
    </article>
  );
}
