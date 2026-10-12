import Link from "next/link";
import { db } from "@/lib/db";
import { countryName } from "@/lib/providers/apify-tiktok-trends";
import { SOURCE } from "@/lib/trends";
import { loadTrendSettings, syncTrends } from "./actions";
import { SyncButton } from "./sync-button";

export const dynamic = "force-dynamic";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const num = (v: unknown) => (typeof v === "number" && v > 0 ? compact.format(v) : null);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

const DIRECTION: Record<string, { icon: string; cls: string; label: string }> = {
  up: { icon: "trending_up", cls: "border-emerald-200 bg-ok-soft text-emerald-800", label: "Rising" },
  down: { icon: "trending_down", cls: "border-red-200 bg-bad-soft text-red-800", label: "Cooling" },
  flat: { icon: "trending_flat", cls: "border-line bg-canvas text-ink-2", label: "Steady" },
};

const Tab = ({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) => (
  <Link href={href} className={`pill px-4 py-1.5 text-sm ${active ? "border-blue-100 bg-brand-soft text-brand" : "border-line bg-white text-ink-2 hover:text-brand"}`}>
    {children}
  </Link>
);

const Stat = ({ icon, value, label }: { icon: string; value: string | null; label: string }) =>
  value ? (
    <span className="inline-flex items-center gap-1 text-sm text-ink-2" title={label}>
      <span className="material-symbols-outlined !text-[16px] text-ink-3">{icon}</span>
      <b className="font-semibold text-ink">{value}</b> {label}
    </span>
  ) : null;

export default async function TrendsPage({ searchParams }: { searchParams: Promise<{ type?: string; period?: string }> }) {
  const q = await searchParams;
  const type = q.type === "videos" ? "videos" : "hashtags";
  const period = q.period === "30" ? "30" : "7";
  const href = (t: string, p: string) => `/trends?type=${t}&period=${p}`;

  const settings = await loadTrendSettings();
  const prefix = `${type === "videos" ? "video" : "hashtag"}:${period}:`;
  const latest = await db.trendSignal.findFirst({ where: { source: SOURCE, externalId: { startsWith: prefix } }, orderBy: { capturedDay: "desc" }, select: { capturedDay: true } });
  const [signals, lastRun, synced, amBriefs] = await Promise.all([
    latest ? db.trendSignal.findMany({ where: { source: SOURCE, externalId: { startsWith: prefix }, capturedDay: latest.capturedDay } }) : [],
    db.trendRun.findFirst({ where: { source: SOURCE }, orderBy: { startedAt: "desc" } }),
    db.trendRun.findFirst({ where: { source: SOURCE, status: "succeeded" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
    // "Used": a campaign's internal brief cites the trend URL in trendRefs.
    db.artifact.findMany({ where: { agentRole: "accountManager", campaignId: { not: null }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, select: { campaignId: true, payload: true } }),
  ]);
  const usedBy = (url: string) => amBriefs.find((a) => JSON.stringify((a.payload as { trendRefs?: unknown }).trendRefs ?? []).includes(url))?.campaignId;
  const rank = (s: (typeof signals)[number]) => Number((s.rawPayload as Record<string, unknown>)[type === "videos" ? "Video Rank" : "Rank"]) || 1e9;
  const rows = signals.sort((a, b) => rank(a) - rank(b));
  const syncing = lastRun?.status === "starting" || lastRun?.status === "running";
  const problem = lastRun && ["failed", "blocked"].includes(lastRun.status) ? lastRun.error : null;

  return (
    <div className="max-w-4xl pt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Trends</h1>
          <p className="mt-2 text-ink-2">
            What is trending on TikTok in {countryName(settings.countryCode)}.{" "}
            {synced?.finishedAt ? `Updated ${synced.finishedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.` : "Not synced yet."}
          </p>
        </div>
        <SyncButton action={syncTrends} syncing={syncing} />
      </div>

      {problem && <p className="mt-4 rounded-2xl border border-red-200 bg-bad-soft px-4 py-3 text-sm text-red-800">Last sync failed: {problem}</p>}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Tab href={href("hashtags", period)} active={type === "hashtags"}>Hashtags</Tab>
          <Tab href={href("videos", period)} active={type === "videos"}>Top videos</Tab>
        </div>
        <div className="flex gap-2">
          <Tab href={href(type, "7")} active={period === "7"}>7 days</Tab>
          <Tab href={href(type, "30")} active={period === "30"}>30 days</Tab>
        </div>
      </div>

      <ul className="mt-4 space-y-3">
        {rows.map((s, i) => {
          const r = s.rawPayload as Record<string, unknown>;
          const used = usedBy(s.url);
          const dir = DIRECTION[String(r["Trend Direction"] ?? "")];
          const handle = text(r["Author Handle"]);
          return (
            <li key={s.id} className="card flex items-start gap-4 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-lg font-bold text-brand">{rank(s) < 1e9 ? rank(s) : i + 1}</span>
              <div className="min-w-0 flex-1">
                <a href={s.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-lg font-semibold hover:text-brand">{s.hook}</a>
                {type === "videos" && handle && <p className="text-sm text-ink-3">{text(r.Author) ? `${text(r.Author)} · ` : ""}{handle}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Stat icon="tag" value={num(r.Posts)} label="posts" />
                  <Stat icon="visibility" value={num(type === "videos" ? r.Views : r["Video Views"])} label="views" />
                  <Stat icon="group" value={num(r.Followers)} label="followers" />
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {dir && <span className={`pill ${dir.cls}`}><span className="material-symbols-outlined !text-[14px]">{dir.icon}</span>{dir.label}</span>}
                {used && <Link href={`/campaigns/${used}`} className="pill border-emerald-200 bg-ok-soft text-emerald-800">Used in campaign</Link>}
              </div>
            </li>
          );
        })}
      </ul>
      {!rows.length && (
        <p className="card mt-4 p-8 text-center text-ink-2">
          {syncing ? "Syncing trends…" : "No trends cached yet. Press Sync now to fetch them; after that a daily sync keeps them fresh."}
        </p>
      )}
    </div>
  );
}
