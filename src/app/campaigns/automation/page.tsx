import Link from "next/link";
import { db } from "@/lib/db";
import { CampaignStatusPill } from "./parts";

export const dynamic = "force-dynamic";

export default async function AutomationListPage() {
  const campaigns = await db.automationCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const ids = campaigns.map((c) => c.id);
  const [slots, done, spend] = await Promise.all([
    db.campaignPost.groupBy({ by: ["automationCampaignId"], where: { automationCampaignId: { in: ids } }, _max: { slot: true } }),
    db.campaignPost.groupBy({ by: ["automationCampaignId"], where: { automationCampaignId: { in: ids }, status: { in: ["approved", "scheduled", "published"] } }, _count: true }),
    db.costEntry.groupBy({ by: ["automationCampaignId"], where: { automationCampaignId: { in: ids } }, _sum: { usd: true } }),
  ]);
  const of = <T extends { automationCampaignId: string | null }>(rows: T[], id: string) => rows.find((r) => r.automationCampaignId === id);

  return (
    <div className="space-y-6 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Automation campaigns</h1>
          <p className="mt-1 text-ink-2">Text posts for X and Threads at scale, checked by the Post QC agent.</p>
        </div>
        <Link href="/campaigns/automation/new" className="btn-primary"><span className="material-symbols-outlined">add</span>New campaign</Link>
      </div>
      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2">
                <th className="px-6 py-4">Campaign</th><th className="px-4 py-4">Status</th><th className="px-4 py-4">Range</th>
                <th className="px-4 py-4">Posts (approved / target)</th><th className="px-4 py-4">Spend / cap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {campaigns.map((c) => {
                const g = c.goal as { startDate: string; endDate: string; targetPosts: number; accountIds: string[] };
                const rows = of(done, c.id)?._count ?? 0;
                return (
                  <tr key={c.id} className="transition hover:bg-canvas/60">
                    <td className="px-6 py-4"><Link href={`/campaigns/automation/${c.id}`} className="font-semibold hover:text-brand">{c.name}</Link></td>
                    <td className="px-4 py-4"><CampaignStatusPill status={c.status} /></td>
                    <td className="px-4 py-4 text-ink-2">{g.startDate} → {g.endDate}</td>
                    <td className="px-4 py-4">{Math.round(rows / Math.max(1, g.accountIds.length))} / {(of(slots, c.id)?._max.slot ?? -1) + 1}</td>
                    <td className="px-4 py-4">US${Number(of(spend, c.id)?._sum.usd ?? 0).toFixed(2)} / US${Number(c.budgetCapUsd).toFixed(2)}</td>
                  </tr>
                );
              })}
              {!campaigns.length && (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-ink-2">No automation campaigns yet. <Link href="/campaigns/automation/new" className="font-semibold text-brand">Create one →</Link></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
