import Link from "next/link";
import { db } from "@/lib/db";
import { getSettings } from "./actions";
import { SourcePill, StatusPill } from "./pills";

export const dynamic = "force-dynamic";

const IN_PROGRESS = ["DRAFTING", "AWAITING_VIDEO_UPLOAD", "POST_PRODUCTION", "REVISING", "REGENERATING", "PUBLISHING"];

export default async function Home() {
  const [campaigns, settings, costAgg] = await Promise.all([
    db.campaign.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    getSettings(),
    db.costEntry.aggregate({ _sum: { usd: true }, where: { createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }),
  ]);
  const monthSpent = Number(costAgg._sum.usd ?? 0);
  const monthCap = Number(settings.monthlyBudgetUsd);
  const stats = [
    { label: "Total Campaigns", value: String(campaigns.length), icon: "movie", tint: "bg-brand-soft text-brand" },
    { label: "Awaiting Approval", value: String(campaigns.filter((c) => c.status === "AWAITING_APPROVAL").length), icon: "priority_high", tint: "bg-amber-soft text-amber-700" },
    { label: "In Production", value: String(campaigns.filter((c) => IN_PROGRESS.includes(c.status)).length), icon: "smart_toy", tint: "bg-agent-soft text-agent" },
    { label: "Cost This Month", value: `US$${monthSpent.toFixed(2)}`, sub: monthCap ? `/ US$${monthCap.toFixed(2)}` : "", icon: "payments", tint: "bg-brand-soft text-brand", bar: monthCap ? Math.min(100, (monthSpent / monthCap) * 100) : 0 },
  ];

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
                    No campaigns yet. <Link href="/brief" className="font-semibold text-brand">Create your first brief →</Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
