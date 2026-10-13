import Link from "next/link";
import { db } from "@/lib/db";
import { COUNTRIES, countryName } from "@/lib/providers/apify-tiktok-trends";
import { SOURCE } from "@/lib/trends";
import { loadTrendSettings, setTrendCountry, syncTrends } from "./actions";
import { RegionSelect } from "./region-select";
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
  <Link href={href} className={`rounded-full px-4 py-1 text-sm font-medium ${active ? "bg-brand-soft text-brand" : "text-ink-2 hover:text-brand"}`}>
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

const raw = (s: { rawPayload: unknown }) => s.rawPayload as Record<string, unknown>;

/** Summary derived from the current list (no model call, so no cost). */
function breakdown(type: string, rows: { hook: string; rawPayload: unknown }[]) {
  if (!rows.length) return [];
  const out: [string, string, string][] = [];
  const rising = rows.filter((s) => raw(s)["Trend Direction"] === "up").slice(0, 3);
  if (rising.length) out.push(["trending_up", "Rising fastest", rising.map((s) => s.hook).join(", ")]);
  const top = rows[0];
  const topViews = num(type === "videos" ? raw(top).Views : raw(top)["Video Views"]);
  out.push(["emoji_events", "Number one", `${top.hook}${topViews ? ` with ${topViews} views` : ""}.`]);
  if (type === "videos") {
    const ratio = (s: { rawPayload: unknown }) => Number(raw(s).Views) / (Number(raw(s).Followers) || 1);
    const best = [...rows].sort((a, b) => ratio(b) - ratio(a))[0];
    out.push(["bolt", "Outlier", `${text(raw(best)["Author Handle"]) ?? best.hook} got ${num(raw(best).Views) ?? "many"} views from ${num(raw(best).Followers) ?? "few"} followers: the format beat the audience size.`]);
  } else {
    out.push(["tag", "Brief angle", `Pair one or two of the top hashtags with your product instead of stacking many; ${rows.length} are tracked this period.`]);
  }
  return out;
}

/** TikTok oEmbed returns a public cover per video; cached for a day, a failure just shows the placeholder. */
async function thumbnails(urls: string[]) {
  const got = await Promise.allSettled(
    urls.map(async (u) => {
      const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`, { next: { revalidate: 86_400 }, signal: AbortSignal.timeout(4000) });
      return [u, ((await res.json()) as { thumbnail_url?: string }).thumbnail_url] as const;
    }),
  );
  return new Map(got.flatMap((g) => (g.status === "fulfilled" && g.value[1] ? [[g.value[0], g.value[1]] as [string, string]] : [])));
}

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

  const sum = (k: string) => rows.reduce((t, s) => t + (Number((s.rawPayload as Record<string, unknown>)[k]) || 0), 0);
  const views = sum(type === "videos" ? "Views" : "Video Views");
  const stats = [
    { icon: "trending_up", label: type === "videos" ? "Videos tracked" : "Hashtags tracked", value: String(rows.length) },
    { icon: "visibility", label: "Total views", value: compact.format(views) },
    ...(type === "hashtags" ? [{ icon: "tag", label: "Total posts", value: compact.format(sum("Posts")) }] : [{ icon: "group", label: "Top creator followers", value: compact.format(Math.max(0, ...rows.map((s) => Number((s.rawPayload as Record<string, unknown>).Followers) || 0))) }]),
    { icon: "local_fire_department", label: "Rising now", value: String(rows.filter((s) => (s.rawPayload as Record<string, unknown>)["Trend Direction"] === "up").length) },
  ];
  const insights = breakdown(type, rows);
  const thumbs = type === "videos" ? await thumbnails(rows.map((s) => s.url)) : new Map<string, string>();
  const region = type === "videos" ? settings.videoCountry : settings.countryCode;

  return (
    <div className="max-w-6xl pt-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">TikTok Trends</h1>
          <p className="mt-2 max-w-xl text-ink-2">
            Trending hashtags and top videos in {countryName(region)} to seed your next campaign brief.{" "}
            {synced?.finishedAt ? `Updated ${synced.finishedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.` : "Not synced yet."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RegionSelect value={settings.countryCode} options={COUNTRIES} action={setTrendCountry} />
          <div className="flex gap-1 rounded-full border border-line bg-white p-1">
            <Tab href={href(type, "7")} active={period === "7"}>7 days</Tab>
            <Tab href={href(type, "30")} active={period === "30"}>30 days</Tab>
          </div>
          <SyncButton action={syncTrends} syncing={syncing} />
        </div>
      </div>

      {problem && <p className="mt-4 rounded-2xl border border-red-200 bg-bad-soft px-4 py-3 text-sm text-red-800">Last sync failed: {problem}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <span className="flex items-center gap-1 text-sm text-ink-2"><span className="material-symbols-outlined !text-[18px] text-brand">{s.icon}</span>{s.label}</span>
            <b className="mt-2 block text-3xl font-bold tracking-tight">{s.value}</b>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="card p-5">
          <div className="flex gap-2 border-b border-line">
            {([["hashtags", "Trending hashtags"], ["videos", "Top videos"]] as const).map(([t, label]) => (
              <Link key={t} href={href(t, period)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${type === t ? "border-brand text-brand" : "border-transparent text-ink-2 hover:text-brand"}`}>
                {label}
              </Link>
            ))}
          </div>

          <ul className="mt-4 space-y-3">
            {rows.map((s, i) => {
              const r = raw(s);
              const used = usedBy(s.url);
              const dir = DIRECTION[String(r["Trend Direction"] ?? "")];
              const handle = text(r["Author Handle"]);
              const n = rank(s) < 1e9 ? rank(s) : i + 1;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-4 rounded-2xl bg-canvas p-3">
                  {type === "videos" ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="relative h-24 w-[68px] shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-brand-soft to-line">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {thumbs.get(s.url) && <img src={thumbs.get(s.url)} alt="" className="h-full w-full object-cover" />}
                      <span className="absolute inset-0 flex items-center justify-center"><span className="material-symbols-outlined rounded-full bg-white/90 p-1 text-brand">play_arrow</span></span>
                      <span className="absolute left-1 top-1 rounded-md bg-black/60 px-1.5 text-xs font-bold text-white">#{n}</span>
                    </a>
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-lg font-bold text-brand">{n}</span>
                  )}
                  <div className="min-w-0 flex-1 basis-48">
                    <a href={s.url} target="_blank" rel="noreferrer" className="line-clamp-2 font-semibold hover:text-brand">{type === "hashtags" && !s.hook.startsWith("#") ? "#" : ""}{s.hook}</a>
                    {type === "videos" && handle && <p className="text-sm text-ink-3">{text(r.Author) ? `${text(r.Author)} · ` : ""}{handle}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <Stat icon="tag" value={num(r.Posts)} label="posts" />
                      <Stat icon="visibility" value={num(type === "videos" ? r.Views : r["Video Views"])} label="views" />
                      <Stat icon="group" value={num(r.Followers)} label="followers" />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {dir && <span className={`pill ${dir.cls}`}><span className="material-symbols-outlined !text-[14px]">{dir.icon}</span>{dir.label}</span>}
                    {used ? (
                      <Link href={`/campaigns/${used}`} className="pill border-emerald-200 bg-ok-soft text-emerald-800">Used in campaign</Link>
                    ) : (
                      <Link href="/brief" className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-white px-3 py-1 text-sm font-semibold text-brand hover:bg-brand-soft">
                        <span className="material-symbols-outlined !text-[16px]">auto_awesome</span>Use as brief
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {!rows.length && (
            <p className="p-8 text-center text-ink-2">
              {syncing ? "Syncing trends…" : "No trends cached yet. Press the sync button to fetch them; after that a daily sync keeps them fresh."}
            </p>
          )}
        </section>

        <aside className="space-y-4">
          <section className="card border-orange-100 bg-orange-50/60 p-5">
            <h2 className="flex items-center gap-2 font-bold"><span className="material-symbols-outlined text-brand">psychology</span>AI Breakdown</h2>
            {insights.length ? (
              <ul className="mt-3 space-y-3">
                {insights.map(([icon, title, body]) => (
                  <li key={title} className="rounded-2xl bg-white p-3 text-sm">
                    <b className="flex items-center gap-1 text-brand"><span className="material-symbols-outlined !text-[16px]">{icon}</span>{title}</b>
                    <p className="mt-1 text-ink-2">{body}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-ink-2">Sync trends to see a breakdown.</p>}
          </section>

          <section className="rounded-3xl bg-brand p-5 text-white shadow-[0_8px_24px_rgba(37,99,235,0.3)]">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold"><span className="material-symbols-outlined !text-[14px]">smart_toy</span>MULTI-AGENT AI</span>
            <h2 className="mt-3 text-xl font-bold">Use these trends for your campaign</h2>
            <p className="mt-2 text-sm text-white/80">The Account Manager already cites the strongest trends of the week in every brief. Start a brief and the agents pick them up.</p>
            <Link href="/brief" className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-white px-4 py-2 font-semibold text-brand">Create campaign from trends</Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
