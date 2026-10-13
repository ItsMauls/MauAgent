import Link from "next/link";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { fmtZoned } from "@/lib/publish";

export const dynamic = "force-dynamic";

type Snapshot = { items?: { type: string; name: string; value: number; unit: string }[]; metricsUpdatedAt?: string | null; reason?: string };
const WINDOWS = [["1h", "After 1 hour"], ["24h", "After 24 hours"], ["7d", "After 7 days"]] as const;
const fmt = (m: { value: number; unit: string }) => (m.unit === "percentage" ? `${m.value}%` : String(m.value));

/** Post metrics exactly as Buffer reported them (personal API key only). No impressions or plays. */
export default async function AnalyticsPage() {
  const [jobs, settings] = await Promise.all([
    db.publishJob.findMany({
      where: { metricSnapshots: { some: {} } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true, platform: true, permalink: true, campaignId: true, caption: true, socialAccount: { select: { handle: true } },
        campaign: { select: { clientBrief: true } },
        metricSnapshots: { orderBy: { capturedAt: "asc" }, select: { window: true, capturedAt: true, source: true, metrics: true } },
      },
    }),
    getSettings(),
  ]);
  return (
    <div className="space-y-6 pt-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        <p className="mt-2 text-ink-2">Post metrics from Buffer, pulled 1 hour, 24 hours and 7 days after a post is sent. Only metrics the network reports are shown; Buffer refreshes them about daily.</p>
      </div>
      {!jobs.length && <div className="card p-12 text-center text-ink-2">No metrics yet. They appear after a post published through Buffer has been sent for an hour.</div>}
      <ul className="space-y-4">
        {jobs.map((j) => (
          <li key={j.id} className="card space-y-3 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-bold">{(j.campaign?.clientBrief as { product?: string } | undefined)?.product ?? (j.caption ? j.caption.slice(0, 60) : j.id)}</span>
              <span className="pill border-line bg-white text-ink-2">{j.platform} @{j.socialAccount.handle}</span>
              {j.campaignId && <Link href={`/campaigns/${j.campaignId}?tab=publication`} className="text-sm font-semibold text-brand">Campaign</Link>}
              {j.permalink && <a href={j.permalink} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand">Open post</a>}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {WINDOWS.map(([w, label]) => {
                const snap = j.metricSnapshots.find((s) => s.window === w);
                const m = (snap?.metrics ?? null) as Snapshot | null;
                return (
                  <div key={w} className="rounded-2xl bg-canvas p-4 text-sm">
                    <p className="label">{label}</p>
                    {!snap ? (
                      <p className="text-ink-3">Not pulled yet</p>
                    ) : m?.items?.length ? (
                      <dl className="space-y-1">
                        {m.items.map((x) => <div key={x.type} className="flex justify-between gap-2"><dt className="text-ink-2">{x.name}</dt><dd className="font-semibold">{fmt(x)}</dd></div>)}
                      </dl>
                    ) : (
                      <p className="text-ink-2">{m?.reason ?? "No metrics reported."}</p>
                    )}
                    {snap && <p className="mt-2 text-xs text-ink-3">Source: {snap.source} · pulled {fmtZoned(snap.capturedAt, settings.timezone)}</p>}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
