import Link from "next/link";
import { notFound } from "next/navigation";
import type { CampaignPostStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { GenerationConfig, Goal, QcConfig, ReviewPolicy } from "@/lib/automation/config";
import { estimatePostUsd } from "@/lib/automation/store";
import { getSettings } from "@/lib/settings";
import { CampaignStatusPill, platformName, PostStatusPill } from "../parts";

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
const LATER: Partial<Record<Tab, string>> = { review: "The review inbox arrives in phase 3.", calendar: "The calendar arrives in phase 4.", tracking: "Tracking arrives in phase 5." };
const PAGE = 50;

type Search = { tab?: string; page?: string };

export default async function AutomationCampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const tab: Tab = TABS.some(([t]) => t === sp.tab) ? (sp.tab as Tab) : "overview";
  const c = await db.automationCampaign.findUnique({ where: { id } });
  if (!c) notFound();
  const goal = Goal.parse(c.goal);

  return (
    <div className="space-y-6 pt-2">
      <Link href="/campaigns/automation" className="inline-flex items-center gap-1 text-sm font-semibold text-brand">
        <span className="material-symbols-outlined !text-[18px]">arrow_back</span> Automation campaigns
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{c.name}</h1>
        <CampaignStatusPill status={c.status} />
        {c.pauseReason && <span className="pill border-amber-200 bg-amber-soft text-amber-800">Paused: {c.pauseReason.replace("_", " ")}</span>}
      </div>
      <p className="text-ink-2">{goal.targetPosts} posts · {goal.startDate} → {goal.endDate} · {goal.pillars.join(", ")}</p>

      <nav aria-label="Campaign sections" className="flex flex-wrap gap-2">
        {TABS.map(([t, label]) => (
          <Link key={t} href={`/campaigns/automation/${c.id}?tab=${t}`} aria-current={t === tab ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${t === tab ? "bg-brand text-white" : "bg-white text-ink-2 hover:bg-brand-soft"}`}>
            {label}
          </Link>
        ))}
      </nav>

      <section className="card p-8">
        {tab === "overview" && <Overview id={c.id} goal={goal} capUsd={Number(c.budgetCapUsd)} warnAtPct={c.warnAtPct} />}
        {tab === "plan" && <PlanTab id={c.id} page={Math.max(1, Number(sp.page) || 1)} />}
        {tab === "settings" && <SettingsTab c={c} />}
        {LATER[tab] && <p className="text-ink-2">{LATER[tab]}</p>}
      </section>
    </div>
  );
}

const ORDER: CampaignPostStatus[] = ["planned", "generating", "qc", "needs_review", "approved", "scheduled", "published", "failed", "rejected", "skipped", "cancelled"];

async function Overview({ id, goal, capUsd, warnAtPct }: { id: string; goal: Goal; capUsd: number; warnAtPct: number }) {
  const [byStatus, spend, perPost] = await Promise.all([
    // Per slot: every row of a slot shares its status until publishing, so count slots through one account.
    db.campaignPost.groupBy({ by: ["status"], where: { automationCampaignId: id, socialAccountId: goal.accountIds[0] }, _count: true }),
    db.costEntry.aggregate({ where: { automationCampaignId: id }, _sum: { usd: true } }),
    estimatePostUsd(),
  ]);
  const spent = Number(spend._sum.usd ?? 0);
  const pct = capUsd ? (spent / capUsd) * 100 : 0;
  const count = (s: CampaignPostStatus) => byStatus.find((r) => r.status === s)?._count ?? 0;
  const remaining = count("planned");
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Spend" value={`US$${spent.toFixed(2)}`} sub={`of US$${capUsd.toFixed(2)}`} bar={pct} warn={pct >= warnAtPct} />
        <Stat label="Still to generate" value={String(remaining)} sub={perPost == null ? "estimate unknown" : `≈ US$${(remaining * perPost).toFixed(2)} (estimate)`} />
        <Stat label="Accounts" value={String(goal.accountIds.length)} sub="each text goes to every account" />
      </div>
      {pct >= warnAtPct && <p role="status" className="rounded-xl bg-amber-soft p-3 text-sm font-medium text-amber-800">Spend is at {Math.round(pct)}% of the cap{pct >= 100 ? ": generation is stopped." : "."}</p>}
      <div>
        <h2 className="label">Posts by status (per text)</h2>
        <div className="flex flex-wrap gap-2">
          {ORDER.filter(count).map((s) => <span key={s} className="flex items-center gap-1.5"><PostStatusPill status={s} /><b className="text-sm">{count(s)}</b></span>)}
        </div>
      </div>
      <p className="text-sm text-ink-3">Generation (pilot, QC, scale-up) arrives in phase 2. Nothing is generated or spent yet.</p>
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

async function PlanTab({ id, page }: { id: string; page: number }) {
  const [last, { timezone }] = await Promise.all([db.campaignPost.aggregate({ where: { automationCampaignId: id }, _max: { slot: true } }), getSettings()]);
  const slots = (last._max.slot ?? -1) + 1;
  const pages = Math.max(1, Math.ceil(slots / PAGE));
  const p = Math.min(page, pages);
  const rows = await db.campaignPost.findMany({
    where: { automationCampaignId: id, slot: { gte: (p - 1) * PAGE, lt: p * PAGE } },
    orderBy: [{ slot: "asc" }, { scheduledAt: "asc" }],
    include: { socialAccount: { select: { handle: true } } },
  });
  const bySlot = Map.groupBy(rows, (r) => r.slot);
  const link = (n: number) => `/campaigns/automation/${id}?tab=plan&page=${n}`;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">{slots} texts, each posted to every account at its own time ({timezone}). Every slot is fixed before generation: type, angles, pillar and CTA.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2">
              <th className="py-2 pr-3">#</th><th className="py-2 pr-3">When</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Pillar</th>
              <th className="py-2 pr-3">Angles</th><th className="py-2 pr-3">CTA</th><th className="py-2 pr-3">Status</th><th className="py-2">Text</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line align-top">
            {[...bySlot.entries()].map(([slot, rs]) => (
              <tr key={slot}>
                <td className="py-2 pr-3 text-ink-3">{slot + 1}{rs[0].pilot && <span className="ml-1 pill border-blue-200 bg-brand-soft px-1.5 py-0 text-[10px] text-brand">pilot</span>}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{rs.map((r) => <div key={r.id}>{r.localTime} <span className="text-ink-3">{platformName(r.platform)} @{r.socialAccount.handle}</span></div>)}</td>
                <td className="py-2 pr-3">{rs[0].contentType.replace(/_/g, " ")}</td>
                <td className="py-2 pr-3">{rs[0].pillar}</td>
                <td className="py-2 pr-3 text-ink-2">{rs[0].angles.join("; ") || "—"}</td>
                <td className="py-2 pr-3">{rs[0].cta ? rs[0].cta.replace(/_/g, " ") : "—"}</td>
                <td className="py-2 pr-3"><PostStatusPill status={rs[0].status} /></td>
                <td className="max-w-xs py-2 whitespace-pre-wrap text-ink-2">{rs[0].text ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav aria-label="Pagination" className="flex items-center gap-2 text-sm">
        {p > 1 ? <Link className="btn-soft py-1.5" href={link(p - 1)}>Previous</Link> : null}
        <span className="px-2 font-semibold">{p} / {pages}</span>
        {p < pages ? <Link className="btn-soft py-1.5" href={link(p + 1)}>Next</Link> : null}
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
    ["QC threshold", `${Math.round(qc.minConfidence * 100)}% · up to ${qc.maxRetries} regenerations`],
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
