import Link from "next/link";
import type { CampaignStatus, Prisma, VideoSource } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings } from "./actions";
import { SourcePill, StatusPill } from "./pills";
import { AutoSubmitSelect } from "./ui";

export const dynamic = "force-dynamic";

const IN_PROGRESS: CampaignStatus[] = ["DRAFTING", "AWAITING_VIDEO_UPLOAD", "POST_PRODUCTION", "REVISING", "REGENERATING", "PUBLISHING"];
const TABS = {
  all: { label: "All", statuses: null },
  approval: { label: "Awaiting approval", statuses: ["AWAITING_APPROVAL"] },
  production: { label: "In production", statuses: IN_PROGRESS },
  success: { label: "Success", statuses: ["APPROVED", "PUBLISHED"] },
  failed: { label: "Failed", statuses: ["FAILED"] },
} satisfies Record<string, { label: string; statuses: CampaignStatus[] | null }>;
type Tab = keyof typeof TABS;
const SOURCES: Record<VideoSource, string> = { seedance_api: "Seedance API", manual_upload: "Manual upload" };
const PAGE_SIZES = [10, 25, 50];

type Search = { q?: string; status?: string; source?: string; page?: string; size?: string };

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const tab: Tab = sp.status && sp.status in TABS ? (sp.status as Tab) : "all";
  const source = sp.source && sp.source in SOURCES ? (sp.source as VideoSource) : undefined;
  const size = PAGE_SIZES.includes(Number(sp.size)) ? Number(sp.size) : PAGE_SIZES[0];

  // Product lives in the clientBrief JSON; Prisma JSON filters are case-sensitive, so match ids with ILIKE.
  const matchIds = q
    ? (await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Campaign" WHERE "clientBrief"->>'product' ILIKE ${`%${q}%`} OR id = ${q}`).map((r) => r.id)
    : undefined;
  const base: Prisma.CampaignWhereInput = { ...(matchIds && { id: { in: matchIds } }), ...(source && { defaultSource: source }) };
  const statuses = TABS[tab].statuses;
  const where: Prisma.CampaignWhereInput = { ...base, ...(statuses && { status: { in: statuses } }) };

  const [byStatus, total, settings, costAgg] = await Promise.all([
    db.campaign.groupBy({ by: ["status"], where: base, _count: true }),
    db.campaign.count({ where }),
    getSettings(),
    db.costEntry.aggregate({ _sum: { usd: true }, where: { createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const campaigns = await db.campaign.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * size, take: size });

  const countOf = (s: CampaignStatus[] | null) => byStatus.reduce((n, r) => n + (!s || s.includes(r.status) ? r._count : 0), 0);
  const monthSpent = Number(costAgg._sum.usd ?? 0);
  const monthCap = Number(settings.monthlyBudgetUsd);
  const stats = [
    { label: "Total Campaigns", value: String(countOf(null)), icon: "movie", tint: "bg-brand-soft text-brand" },
    { label: "Awaiting Approval", value: String(countOf(TABS.approval.statuses)), icon: "priority_high", tint: "bg-amber-soft text-amber-700" },
    { label: "In Production", value: String(countOf(IN_PROGRESS)), icon: "smart_toy", tint: "bg-agent-soft text-agent" },
    { label: "Cost This Month", value: `US$${monthSpent.toFixed(2)}`, sub: monthCap ? `/ US$${monthCap.toFixed(2)}` : "", icon: "payments", tint: "bg-brand-soft text-brand", bar: monthCap ? Math.min(100, (monthSpent / monthCap) * 100) : 0 },
  ];

  const href = (o: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, status: tab, source, size: String(size), page: "1", ...o })) {
      if (v && !(k === "status" && v === "all") && !(k === "page" && v === "1") && !(k === "size" && v === String(PAGE_SIZES[0]))) p.set(k, v);
    }
    return `/?${p}`;
  };
  const from = total ? (page - 1) * size + 1 : 0;

  return (
    <>
      <div className="pt-4">
        <h1 className="text-4xl font-bold tracking-tight">
          Welcome! <span className="inline-block">👋</span>
        </h1>
        <p className="mt-2 text-lg text-ink-2">
          <mark className="rounded-lg bg-amber-soft px-2.5 py-0.5 font-semibold text-ink">Manage &amp; track creative AI video production</mark> for your brand partners.
        </p>
      </div>

      <section className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-6">
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2">{s.label}</span>
              <span className={`flex h-9 w-9 items-center justify-center rounded-full ${s.tint}`}>
                <span className="material-symbols-outlined">{s.icon}</span>
              </span>
            </div>
            <p className="mt-4 text-3xl font-bold tracking-tight">
              {s.value} {s.sub && <span className="text-sm font-medium text-ink-3">{s.sub}</span>}
            </p>
            {s.bar !== undefined && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-brand" style={{ width: `${s.bar}%` }} />
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="card mt-6 flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {q && (
            <Link href={href({ q: "" })} aria-label={`Clear search “${q}”`} className="pill self-start border-brand/30 bg-brand-soft text-brand">
              Results for “{q}”<span className="material-symbols-outlined !text-[14px]">close</span>
            </Link>
          )}
          <nav aria-label="Filter by status" className="flex flex-wrap gap-1 self-start rounded-full bg-canvas p-1">
            {(Object.keys(TABS) as Tab[]).map((t) => (
              <Link
                key={t}
                href={href({ status: t })}
                aria-current={t === tab ? "page" : undefined}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${t === tab ? "bg-white text-brand shadow-sm" : "text-ink-2 hover:text-ink"}`}
              >
                {TABS[t].label} ({countOf(TABS[t].statuses)})
              </Link>
            ))}
          </nav>
        </div>
        <form action="/">
          {q && <input type="hidden" name="q" value={q} />}
          {tab !== "all" && <input type="hidden" name="status" value={tab} />}
          <AutoSubmitSelect name="source" defaultValue={source ?? ""} aria-label="Video source" className="input w-auto rounded-full">
            <option value="">All sources</option>
            {Object.entries(SOURCES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </AutoSubmitSelect>
          <noscript><button className="btn-soft ml-2">Apply</button></noscript>
        </form>
      </section>

      <section className="card mt-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2">
                <th className="px-6 py-4">Campaign</th>
                <th className="px-4 py-4">Status</th>
                <th className="px-4 py-4">Video source</th>
                <th className="px-4 py-4">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {campaigns.map((c) => {
                const product = (c.clientBrief as { product?: string }).product ?? "—";
                return (
                  <tr key={c.id} className="transition hover:bg-canvas/60">
                    <td className="px-6 py-4">
                      <Link href={`/campaigns/${c.id}`} className="flex items-center gap-3 font-semibold hover:text-brand">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">
                          {product.slice(0, 2).toUpperCase()}
                        </span>
                        {product}
                      </Link>
                    </td>
                    <td className="px-4 py-4"><StatusPill status={c.status} /></td>
                    <td className="px-4 py-4"><SourcePill source={c.defaultSource} /></td>
                    <td className="px-4 py-4 text-ink-2">{c.createdAt.toLocaleString("en-US")}</td>
                  </tr>
                );
              })}
              {!campaigns.length && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-ink-2">
                    {countOf(null) || q || source ? "No campaigns match these filters." : <>No campaigns yet. <Link href="/brief" className="font-semibold text-brand">Create your first brief →</Link></>}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4 text-sm text-ink-2">
          <form action="/" className="flex items-center gap-2">
            {q && <input type="hidden" name="q" value={q} />}
            {tab !== "all" && <input type="hidden" name="status" value={tab} />}
            {source && <input type="hidden" name="source" value={source} />}
            <span>
              Showing {from}–{from ? from + campaigns.length - 1 : 0} of {total}
            </span>
            <span aria-hidden>·</span>
            <AutoSubmitSelect name="size" defaultValue={String(size)} aria-label="Rows per page" className="rounded-full border border-line bg-white px-2 py-1">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
            </AutoSubmitSelect>
          </form>
          <nav aria-label="Pagination" className="flex items-center gap-2">
            <PageLink href={href({ page: String(page - 1) })} disabled={page <= 1}>Previous</PageLink>
            <span className="px-2 font-semibold text-ink" aria-current="page">{page} / {pages}</span>
            <PageLink href={href({ page: String(page + 1) })} disabled={page >= pages}>Next</PageLink>
          </nav>
        </footer>
      </section>
    </>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  const cls = "rounded-full border border-line bg-white px-4 py-1.5 font-semibold";
  return disabled ? <span aria-disabled className={`${cls} opacity-50`}>{children}</span> : <Link href={href} className={`${cls} text-ink hover:bg-brand-soft`}>{children}</Link>;
}
