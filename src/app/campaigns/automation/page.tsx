import Link from "next/link";
import type { AutomationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { Goal } from "@/lib/automation/config";
import { AutoSubmitSelect } from "../../ui";
import { GridView, KanbanView, TableView, type Row } from "./views";

export const dynamic = "force-dynamic";

const VIEWS = [["grid", "Grid", "grid_view"], ["kanban", "Kanban", "view_kanban"], ["table", "Table", "table_rows"]] as const;
type View = (typeof VIEWS)[number][0];

const ACTIVE: AutomationStatus[] = ["piloting", "awaiting_scale", "running"];
const TABS = {
  all: { label: "All", match: () => true },
  review: { label: "Needs review", match: (r: Row) => r.review > 0 },
  draft: { label: "Draft", match: (r: Row) => r.status === "draft" },
  active: { label: "Active", match: (r: Row) => ACTIVE.includes(r.status) },
  paused: { label: "Paused", match: (r: Row) => r.status === "paused" },
  done: { label: "Done", match: (r: Row) => r.status === "completed" || r.status === "cancelled" },
} satisfies Record<string, { label: string; match: (r: Row) => boolean }>;
type Tab = keyof typeof TABS;

const SORTS = {
  newest: { label: "Newest first", by: (a: Row, b: Row) => b.createdAt.getTime() - a.createdAt.getTime() },
  oldest: { label: "Oldest first", by: (a: Row, b: Row) => a.createdAt.getTime() - b.createdAt.getTime() },
  spend: { label: "Most spend", by: (a: Row, b: Row) => b.spent - a.spent },
  progress: { label: "Most written", by: (a: Row, b: Row) => b.written / Math.max(1, b.slots) - a.written / Math.max(1, a.slots) },
  name: { label: "Name A-Z", by: (a: Row, b: Row) => a.name.localeCompare(b.name) },
} satisfies Record<string, { label: string; by: (a: Row, b: Row) => number }>;
type Sort = keyof typeof SORTS;

type Search = { q?: string; view?: string; tab?: string; kind?: string; sort?: string };

export default async function AutomationListPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = sp.q?.trim().toLowerCase() ?? "";
  const view: View = VIEWS.some(([v]) => v === sp.view) ? (sp.view as View) : "grid";
  const tab: Tab = sp.tab && sp.tab in TABS ? (sp.tab as Tab) : "all";
  const kind = sp.kind === "personal" || sp.kind === "brand" ? sp.kind : "";
  const sort: Sort = sp.sort && sp.sort in SORTS ? (sp.sort as Sort) : "newest";

  const campaigns = await db.automationCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const ids = campaigns.map((c) => c.id);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const goals = campaigns.map((c) => Goal.parse(c.goal));
  const [byStatus, spend, month, accounts] = await Promise.all([
    db.campaignPost.groupBy({ by: ["automationCampaignId", "status"], where: { automationCampaignId: { in: ids } }, _count: true }),
    db.costEntry.groupBy({ by: ["automationCampaignId"], where: { automationCampaignId: { in: ids } }, _sum: { usd: true } }),
    db.costEntry.aggregate({ _sum: { usd: true }, where: { automationCampaignId: { not: null }, createdAt: { gte: monthStart } } }),
    db.socialAccount.findMany({ where: { id: { in: [...new Set(goals.flatMap((g) => g.accountIds))] } }, select: { id: true, platform: true } }),
  ]);
  const platformOf = new Map(accounts.map((a) => [a.id, a.platform]));

  const all: Row[] = campaigns.map((c, i) => {
    const g = goals[i];
    // Every text has one row per account, so rows / accounts = texts.
    const n = Math.max(1, g.accountIds.length);
    const mine = byStatus.filter((r) => r.automationCampaignId === c.id);
    const texts = (statuses: string[] | null) => Math.round(mine.reduce((t, r) => t + (!statuses || statuses.includes(r.status) ? r._count : 0), 0) / n);
    return {
      id: c.id, name: c.name, status: c.status, pauseReason: c.pauseReason, kind: g.kind, brandName: g.brandName,
      platforms: [...new Set(g.accountIds.flatMap((a) => platformOf.get(a) ?? []))],
      startDate: g.startDate, endDate: g.endDate,
      slots: texts(null), written: texts(["needs_review", "approved", "scheduled", "published", "failed", "rejected", "skipped"]),
      approved: texts(["approved", "scheduled", "published"]), review: texts(["needs_review"]),
      spent: Number(spend.find((s) => s.automationCampaignId === c.id)?._sum.usd ?? 0), cap: Number(c.budgetCapUsd), createdAt: c.createdAt,
    };
  });

  // Stats read the whole set; the filters below only change what is listed.
  const stats = [
    { label: "Total Campaigns", value: String(all.length), icon: "campaign", tint: "bg-brand-soft text-brand" },
    { label: "Awaiting Your Review", value: String(all.reduce((t, r) => t + r.review, 0)), sub: "posts", icon: "priority_high", tint: "bg-amber-soft text-amber-700" },
    { label: "In Progress", value: String(all.filter((r) => ACTIVE.includes(r.status)).length), icon: "autorenew", tint: "bg-agent-soft text-agent" },
    { label: "Spend This Month", value: `US$${Number(month._sum.usd ?? 0).toFixed(2)}`, icon: "payments", tint: "bg-brand-soft text-brand" },
  ];

  const rows = all
    .filter((r) => TABS[tab].match(r) && (!kind || r.kind === kind) && (!q || `${r.name} ${r.brandName ?? ""}`.toLowerCase().includes(q)))
    .sort(SORTS[sort].by);

  const href = (o: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q?.trim(), view, tab, kind, sort, ...o })) {
      if (v && !(k === "view" && v === "grid") && !(k === "tab" && v === "all") && !(k === "sort" && v === "newest")) p.set(k, v);
    }
    const s = p.toString();
    return s ? `/campaigns/automation?${s}` : "/campaigns/automation";
  };
  const filtered = !!(q || kind || tab !== "all");

  return (
    <div className="space-y-6 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-ink-2">Automation campaigns: text posts at scale (X and Threads for now), checked by the Post QC agent.</p>
        </div>
        <Link href="/campaigns/automation/new" className="btn-primary"><span className="material-symbols-outlined">add</span>Create campaign</Link>
      </div>

      <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-6">
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2">{s.label}</span>
              <span className={`flex h-9 w-9 items-center justify-center rounded-full ${s.tint}`}><span className="material-symbols-outlined">{s.icon}</span></span>
            </div>
            <p className="mt-4 text-3xl font-bold tracking-tight">{s.value} {s.sub && <span className="text-sm font-medium text-ink-3">{s.sub}</span>}</p>
          </div>
        ))}
      </section>

      <section className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <nav aria-label="Filter by stage" className="flex flex-wrap gap-1 rounded-full bg-canvas p-1">
          {(Object.keys(TABS) as Tab[]).map((t) => (
            <Link key={t} href={href({ tab: t })} aria-current={t === tab ? "page" : undefined}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${t === tab ? "bg-white text-brand shadow-sm" : "text-ink-2 hover:text-ink"}`}>
              {TABS[t].label} ({all.filter(TABS[t].match).length})
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <form action="/campaigns/automation" className="flex flex-wrap items-center gap-2">
            {view !== "grid" && <input type="hidden" name="view" value={view} />}
            {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
            <label className="relative">
              <span className="sr-only">Search campaigns</span>
              <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">search</span>
              <input name="q" defaultValue={sp.q ?? ""} placeholder="Search campaigns" className="input w-52 rounded-full pl-10" />
            </label>
            <AutoSubmitSelect name="kind" defaultValue={kind} aria-label="Account type" className="input w-auto rounded-full">
              <option value="">All accounts</option><option value="personal">Personal</option><option value="brand">Brand</option>
            </AutoSubmitSelect>
            <AutoSubmitSelect name="sort" defaultValue={sort} aria-label="Sort" className="input w-auto rounded-full">
              {(Object.keys(SORTS) as Sort[]).map((s) => <option key={s} value={s}>{SORTS[s].label}</option>)}
            </AutoSubmitSelect>
            <noscript><button className="btn-soft">Apply</button></noscript>
          </form>
          <nav aria-label="View" className="flex gap-1 rounded-full bg-canvas p-1">
            {VIEWS.map(([v, label, icon]) => (
              <Link key={v} href={href({ view: v })} aria-current={v === view ? "page" : undefined} aria-label={`${label} view`} title={`${label} view`}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition ${v === view ? "bg-white text-brand shadow-sm" : "text-ink-2 hover:text-ink"}`}>
                <span className="material-symbols-outlined">{icon}</span><span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </section>

      {filtered && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          Showing {rows.length} of {all.length}
          <Link href={href({ q: "", tab: "all", kind: "" })} className="pill border-brand/30 bg-brand-soft text-brand">Clear filters<span className="material-symbols-outlined !text-[14px]">close</span></Link>
        </p>
      )}

      {rows.length ? (
        view === "kanban" ? <KanbanView rows={rows} /> : view === "table" ? <TableView rows={rows} /> : <GridView rows={rows} />
      ) : (
        <section className="card px-6 py-12 text-center text-ink-2">
          {all.length ? "No campaigns match these filters." : <>No campaigns yet. <Link href="/campaigns/automation/new" className="font-semibold text-brand">Create your first campaign →</Link></>}
        </section>
      )}
    </div>
  );
}
