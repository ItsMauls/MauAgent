import Link from "next/link";
import { notFound } from "next/navigation";
import type { CampaignPostStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { GenerationConfig, Goal, QcConfig, ReviewPolicy } from "@/lib/automation/config";
import { estimatePostUsd } from "@/lib/automation/store";
import { agreement, automationSpent, avgSlotUsd } from "@/lib/automation/worker";
import { getSettings } from "@/lib/settings";
import { LiveRefresh } from "../../[id]/live";
import { CampaignStatusPill, platformName, PostStatusPill } from "../parts";
import { Controls, PostActions } from "./controls";

export const dynamic = "force-dynamic";

const TABS = [
  ["overview", "Overview"],
  ["plan", "Plan"],
  ["review", "Review"],
  ["calendar", "Calendar"],
  ["tracking", "Tracking"],
  ["settings", "Settings"],
] as const;
type Tab = (typeof TABS)[number][0];
const LATER: Partial<Record<Tab, string>> = {
  review: "The review inbox with keyboard shortcuts arrives in phase 3. Until then, approve or reject posts on the Plan tab.",
  calendar: "The calendar arrives in phase 4.",
  tracking: "Tracking arrives in phase 5.",
};
const PAGE = 50;

type Search = { tab?: string; page?: string; status?: string };
type QcReport = {
  verdict?: string | null;
  decision?: { action: string; reasons: string[] };
  issues?: string[];
  suggestedFix?: string;
  rules?: { id: string; pass: boolean; severity: string; detail: string }[];
};

export default async function AutomationCampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const tab: Tab = TABS.some(([t]) => t === sp.tab) ? (sp.tab as Tab) : "overview";
  const c = await db.automationCampaign.findUnique({ where: { id } });
  if (!c) notFound();
  const goal = Goal.parse(c.goal);
  const busy = await db.campaignPost.count({ where: { automationCampaignId: id, status: { in: ["generating", "qc"] } } });

  return (
    <div className="space-y-6 pt-2">
      <Link href="/campaigns/automation" className="inline-flex items-center gap-1 text-sm font-semibold text-brand">
        <span className="material-symbols-outlined !text-[18px]">arrow_back</span> Automation campaigns
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{c.name}</h1>
        <CampaignStatusPill status={c.status} />
        {c.pauseReason && <span className="pill border-amber-200 bg-amber-soft text-amber-800">Paused: {c.pauseReason.replace("_", " ")}</span>}
        {busy > 0 && <span className="pill border-blue-200 bg-brand-soft text-brand-dark">Writing {busy} post{busy === 1 ? "" : "s"}…</span>}
      </div>
      <p className="text-ink-2">{goal.targetPosts} posts · {goal.startDate} → {goal.endDate} · {goal.pillars.join(", ")}</p>
      <Controls id={c.id} status={c.status} pauseReason={c.pauseReason} capUsd={Number(c.budgetCapUsd)} />
      <LiveRefresh active={busy > 0} />

      <nav aria-label="Campaign sections" className="flex flex-wrap gap-2">
        {TABS.map(([t, label]) => (
          <Link key={t} href={`/campaigns/automation/${c.id}?tab=${t}`} aria-current={t === tab ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${t === tab ? "bg-brand text-white" : "bg-white text-ink-2 hover:bg-brand-soft"}`}>
            {label}
          </Link>
        ))}
      </nav>

      <section className="card p-8">
        {tab === "overview" && <Overview id={c.id} goal={goal} capUsd={Number(c.budgetCapUsd)} warnAtPct={c.warnAtPct} qc={QcConfig.parse(c.qcConfig)} />}
        {tab === "plan" && <PlanTab id={c.id} page={Math.max(1, Number(sp.page) || 1)} status={sp.status} />}
        {tab === "settings" && <SettingsTab c={c} />}
        {LATER[tab] && <p className="text-ink-2">{LATER[tab]}</p>}
      </section>
    </div>
  );
}

const ORDER: CampaignPostStatus[] = ["planned", "generating", "qc", "needs_review", "approved", "scheduled", "published", "failed", "rejected", "skipped", "cancelled"];
const usd = (n: number) => `US$${n.toFixed(n < 1 ? 4 : 2)}`;

async function Overview({ id, goal, capUsd, warnAtPct, qc }: { id: string; goal: Goal; capUsd: number; warnAtPct: number; qc: QcConfig }) {
  const first = goal.accountIds[0];
  const [byStatus, spent, measured, estimate, agree, auto, perDay, pilot] = await Promise.all([
    // Per slot: every row of a slot shares its status until publishing, so count slots through one account.
    db.campaignPost.groupBy({ by: ["status"], where: { automationCampaignId: id, socialAccountId: first }, _count: true }),
    automationSpent(id),
    avgSlotUsd(id, first),
    estimatePostUsd(),
    agreement(id, first),
    db.campaignPost.count({ where: { automationCampaignId: id, socialAccountId: first, approvalSource: "qc_auto" } }),
    db.$queryRaw<{ day: string; usd: number }[]>`SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, SUM(usd)::float AS usd FROM "CostEntry" WHERE "automationCampaignId" = ${id} GROUP BY 1 ORDER BY 1 DESC LIMIT 14`,
    db.campaignPost.findMany({ where: { automationCampaignId: id, socialAccountId: first, pilot: true }, orderBy: { slot: "asc" } }),
  ]);
  const pct = capUsd ? (spent / capUsd) * 100 : 0;
  const count = (s: CampaignPostStatus) => byStatus.find((r) => r.status === s)?._count ?? 0;
  const remaining = count("planned") + count("generating") + count("qc");
  const perPost = measured ?? estimate;
  const generated = byStatus.reduce((n, r) => n + (["planned", "generating", "qc", "cancelled"].includes(r.status) ? 0 : r._count), 0);
  const pilotDone = pilot.filter((p) => !["planned", "generating", "qc"].includes(p.status));
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Spend" value={usd(spent)} sub={`of ${usd(capUsd)}`} bar={pct} warn={pct >= warnAtPct} />
        <Stat label="Cost per post" value={perPost == null ? "—" : usd(perPost)} sub={measured != null ? "measured (writing + QC)" : "estimate"} />
        <Stat label="Still to generate" value={String(remaining)} sub={perPost == null ? "" : `≈ ${usd(remaining * perPost)}${measured == null ? " (estimate)" : ""}`} />
        <Stat label="QC agreement" value={agree.rate == null ? "—" : `${Math.round(agree.rate * 100)}%`} sub={`${agree.agreed}/${agree.total} owner decisions`} />
      </div>
      {pct >= warnAtPct && <p role="status" className="rounded-xl bg-amber-soft p-3 text-sm font-medium text-amber-800">Spend is at {Math.round(pct)}% of the cap{pct >= 100 ? ": generation is stopped." : "."}</p>}
      {perPost != null && spent + remaining * perPost > capUsd && (
        <p className="rounded-xl bg-amber-soft p-3 text-sm text-amber-800">
          At {usd(perPost)} per post the remaining {remaining} posts need about {usd(spent + remaining * perPost)} in total, above the {usd(capUsd)} cap: generation will pause at the cap.
        </p>
      )}

      <div>
        <h2 className="label">Posts by status (per text)</h2>
        <div className="flex flex-wrap gap-3">
          {ORDER.filter(count).map((s) => <span key={s} className="flex items-center gap-1.5"><PostStatusPill status={s} /><b className="text-sm">{count(s)}</b></span>)}
        </div>
        <p className="mt-2 text-sm text-ink-2">Auto-approved by QC: {auto} of {generated} generated{generated ? ` (${Math.round((auto / generated) * 100)}%)` : ""} · threshold {Math.round(qc.minConfidence * 100)}%</p>
      </div>

      {pilot.length > 0 && (
        <div>
          <h2 className="label">Pilot ({pilotDone.length}/{pilot.length} written)</h2>
          <p className="mb-3 text-sm text-ink-2">Every pilot post waits for you, whatever QC says. Compare QC&apos;s verdict with your own decision to calibrate the threshold before scaling up.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead><tr className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2"><th className="py-2 pr-3">#</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">QC</th><th className="py-2 pr-3">Confidence</th><th className="py-2 pr-3">Cost</th><th className="py-2 pr-3">You</th><th className="py-2">Text</th></tr></thead>
              <tbody className="divide-y divide-line align-top">
                {pilot.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-3 text-ink-3">{p.slot + 1}</td>
                    <td className="py-2 pr-3">{p.contentType.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-3">{(p.qcReport as QcReport | null)?.verdict ?? "—"}</td>
                    <td className="py-2 pr-3">{p.confidence == null ? "—" : `${Math.round(p.confidence * 100)}%`}</td>
                    <td className="py-2 pr-3">{Number(p.costUsd) ? usd(Number(p.costUsd)) : "—"}</td>
                    <td className="py-2 pr-3">{p.humanDecision ?? <PostStatusPill status={p.status} />}{p.qcAgreed != null && <span className="ml-1 text-xs text-ink-3">{p.qcAgreed ? "agrees" : "differs"}</span>}</td>
                    <td className="max-w-sm py-2 whitespace-pre-wrap text-ink-2">{p.text ?? p.failureReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {perDay.length > 0 && (
        <div>
          <h2 className="label">Spend per day (last 14 days)</h2>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">{perDay.map((d) => <li key={d.day} className="flex justify-between rounded-lg bg-canvas px-3 py-1"><span>{d.day}</span><b>{usd(Number(d.usd))}</b></li>)}</ul>
          <p className="mt-1 text-xs text-ink-3">A text is written once and cross-posted, so its cost is shared by every account it goes to.</p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, bar, warn }: { label: string; value: string; sub?: string; bar?: number; warn?: boolean }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="label">{label}</p>
      <p className="text-2xl font-bold">{value} {sub && <span className="text-sm font-medium text-ink-3">{sub}</span>}</p>
      {bar !== undefined && <div className="mt-2 h-2 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${warn ? "bg-amber-500" : "bg-brand"}`} style={{ width: `${Math.min(100, bar)}%` }} /></div>}
    </div>
  );
}

async function PlanTab({ id, page, status }: { id: string; page: number; status?: string }) {
  const filter = ORDER.includes(status as CampaignPostStatus) ? (status as CampaignPostStatus) : undefined;
  const [slotRows, { timezone }] = await Promise.all([
    db.campaignPost.findMany({ where: { automationCampaignId: id, ...(filter && { status: filter }) }, distinct: ["slot"], orderBy: { slot: "asc" }, select: { slot: true } }),
    getSettings(),
  ]);
  const pages = Math.max(1, Math.ceil(slotRows.length / PAGE));
  const p = Math.min(page, pages);
  const slots = slotRows.slice((p - 1) * PAGE, p * PAGE).map((r) => r.slot);
  const rows = await db.campaignPost.findMany({
    where: { automationCampaignId: id, slot: { in: slots } },
    orderBy: [{ slot: "asc" }, { scheduledAt: "asc" }],
    include: { socialAccount: { select: { handle: true } } },
  });
  const bySlot = Map.groupBy(rows, (r) => r.slot);
  const link = (o: { page?: number; status?: string }) => `/campaigns/automation/${id}?tab=plan&page=${o.page ?? 1}${(o.status ?? filter) ? `&status=${o.status ?? filter}` : ""}`;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">{slotRows.length} texts{filter ? ` with status ${filter.replace(/_/g, " ")}` : ""}, each posted to every account at its own time ({timezone}). Every slot is fixed before generation: type, angles, pillar and CTA.</p>
      <nav aria-label="Filter by status" className="flex flex-wrap gap-1 text-sm">
        <Link href={`/campaigns/automation/${id}?tab=plan`} className={`rounded-full px-3 py-1 ${!filter ? "bg-brand text-white" : "bg-canvas text-ink-2"}`}>All</Link>
        {(["planned", "needs_review", "approved", "rejected"] as const).map((s) => (
          <Link key={s} href={link({ status: s })} className={`rounded-full px-3 py-1 ${filter === s ? "bg-brand text-white" : "bg-canvas text-ink-2"}`}>{s.replace(/_/g, " ")}</Link>
        ))}
      </nav>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2">
              <th className="py-2 pr-3">#</th><th className="py-2 pr-3">When</th><th className="py-2 pr-3">Type · pillar</th>
              <th className="py-2 pr-3">CTA</th><th className="py-2 pr-3">Status · QC</th><th className="py-2">Text</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line align-top">
            {[...bySlot.entries()].map(([slot, rs]) => {
              const h = rs[0];
              const r = h.qcReport as QcReport | null;
              return (
                <tr key={slot}>
                  <td className="py-2 pr-3 text-ink-3">{slot + 1}{h.pilot && <span className="ml-1 pill border-blue-200 bg-brand-soft px-1.5 py-0 text-[10px] text-brand">pilot</span>}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{rs.map((x) => <div key={x.id}>{x.localTime} <span className="text-ink-3">{platformName(x.platform)} @{x.socialAccount.handle}</span></div>)}</td>
                  <td className="py-2 pr-3">{h.contentType.replace(/_/g, " ")}<div className="text-ink-3">{h.pillar}</div>{h.angles.length > 0 && <div className="text-xs text-ink-3">{h.angles.join("; ")}</div>}</td>
                  <td className="py-2 pr-3">{h.cta ? h.cta.replace(/_/g, " ") : "—"}</td>
                  <td className="py-2 pr-3">
                    <PostStatusPill status={h.status} />
                    {h.confidence != null && <div className="mt-1 text-xs text-ink-2">QC {r?.verdict ?? "—"} · {Math.round(h.confidence * 100)}%{h.approvalSource ? ` · ${h.approvalSource === "qc_auto" ? "auto-approved" : "approved by you"}` : ""}</div>}
                    {Number(h.costUsd) > 0 && <div className="text-xs text-ink-3">{usd(Number(h.costUsd))}</div>}
                  </td>
                  <td className="max-w-md py-2 text-ink-2">
                    <p className="whitespace-pre-wrap">{h.text ?? (h.failureReason ? <span className="text-red-700">{h.failureReason}</span> : "—")}</p>
                    {h.thread.length > 0 && <p className="mt-1 text-xs text-ink-3">+ {h.thread.length} thread parts</p>}
                    {h.sourceNote && <p className="mt-1 text-xs text-ink-3">Source (not verified): {h.sourceNote}</p>}
                    {r?.decision && r.decision.reasons.length > 0 && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-ink-2">Why {h.status === "needs_review" ? "it needs review" : "QC decided this"}</summary>
                        <ul className="mt-1 list-disc pl-4">{[...r.decision.reasons, ...(r.issues ?? [])].map((x, i) => <li key={i}>{x}</li>)}</ul>
                        {r.suggestedFix && <p className="mt-1">Suggested fix: {r.suggestedFix}</p>}
                      </details>
                    )}
                    <PostActions id={id} slot={slot} status={h.status} hasText={!!h.text} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <nav aria-label="Pagination" className="flex items-center gap-2 text-sm">
        {p > 1 ? <Link className="btn-soft py-1.5" href={link({ page: p - 1 })}>Previous</Link> : null}
        <span className="px-2 font-semibold">{p} / {pages}</span>
        {p < pages ? <Link className="btn-soft py-1.5" href={link({ page: p + 1 })}>Next</Link> : null}
      </nav>
    </div>
  );
}

function SettingsTab({ c }: { c: { planConfig: unknown; reviewPolicy: unknown; qcConfig: unknown; generationConfig: unknown; seed: number; budgetCapUsd: unknown; warnAtPct: number } }) {
  const review = ReviewPolicy.parse(c.reviewPolicy);
  const qc = QcConfig.parse(c.qcConfig);
  const gen = GenerationConfig.parse(c.generationConfig);
  const items: [string, string][] = [
    ["Review policy", review.mode === "qc_auto" ? "QC auto-approve" : "Review everything"],
    ["Always reviewed", review.forceReviewTypes.join(", ") || "none"],
    ["QC threshold", `${Math.round(qc.minConfidence * 100)}% · up to ${qc.maxRetries} regenerations · borderline ±${Math.round(qc.borderline * 100)}% gets a second QC sample`],
    ["Generation", `${gen.variantsPerPost} variants · ${gen.horizonDays} days ahead · chunks of ${gen.chunkSize} · pilot ${gen.pilotSize}`],
    ["Budget", `US$${Number(c.budgetCapUsd).toFixed(2)} · warn at ${c.warnAtPct}%`],
    ["Schedule", JSON.stringify(c.planConfig)],
    ["Plan seed", String(c.seed)],
  ];
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {items.map(([k, v]) => <div key={k}><dt className="label">{k}</dt><dd className="text-sm break-words">{v}</dd></div>)}
    </dl>
  );
}
