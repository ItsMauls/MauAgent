import { db } from "@/lib/db";
import { latestPrice } from "@/lib/cost";
import { DEFAULTS, TikTokTrendsSettings, defaultCountries, type CountryCtx } from "@/lib/providers/apify-tiktok-trends";

export const SOURCE = "apify_tiktok";

/** One sync = these actor runs. TikTok offers 7- and 30-day windows only, so "Today" is not a separate pull. */
export const SYNC_JOBS = [["hashtags", "7"], ["hashtags", "30"], ["videos", "7"], ["videos", "30"]] as const;
export type SyncJob = (typeof SYNC_JOBS)[number];

export const jobSettings = (s: TikTokTrendsSettings, [trendType, period]: SyncJob): TikTokTrendsSettings => ({ ...s, trendType, hashtagPeriod: period, videoPeriod: period });

/** Account Manager input: the 5 strongest signals of the last 7 days across every trend source, by outlierScore. */
export async function topTrendRefs(limit = 5, days = 7) {
  const rows = await db.trendSignal.findMany({
    where: { capturedAt: { gte: new Date(Date.now() - days * 86_400_000) } },
    orderBy: { outlierScore: "desc" },
    take: limit * 3,
    select: { url: true, source: true, platform: true, format: true, hook: true, outlierScore: true },
  });
  // The same trend can appear on several days: keep its best row only.
  const seen = new Set<string>();
  return rows
    .filter((r) => !seen.has(r.url) && seen.add(r.url))
    .slice(0, limit)
    .map((r) => `- [${r.platform}/${r.source}] ${r.format} "${r.hook.slice(0, 120)}" (outlier ${r.outlierScore.toFixed(2)}) ${r.url}`);
}

// ---------- settings (global row: brandKitId null) ----------

export const getTrendSettings = () => db.trendSourceSettings.findFirst({ where: { source: SOURCE, brandKitId: null } });

/** First visit creates the row with the owner's country (resolved once, then stored). The cron never resolves. */
export async function ensureTrendSettings(country: Omit<CountryCtx, "saved">) {
  return (await getTrendSettings()) ?? db.trendSourceSettings.create({ data: { source: SOURCE, ...DEFAULTS, ...defaultCountries(country) } });
}

export type TrendSettingsRow = NonNullable<Awaited<ReturnType<typeof getTrendSettings>>>;

/** Stored row → validated actor settings (throws on a row edited into an invalid state). */
export const actorSettings = (r: TrendSettingsRow) => TikTokTrendsSettings.parse(r);

/** Upper bound for one run from PriceBook: actor start + maxItems results. */
export async function estimateRunUsd(maxItems: number) {
  const rows = await db.priceBook.findMany({ where: { provider: "apify", model: "tiktok-trends" } });
  return latestPrice(rows, "apify", "tiktok-trends", "actor_start") + maxItems * latestPrice(rows, "apify", "tiktok-trends", "item");
}

export const monthRuns = (now = new Date()) =>
  db.trendRun.count({ where: { source: SOURCE, apifyRunId: { not: null }, startedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } } });

/** Pure gate: monthly run cap and per-run estimate. Null = allowed. */
export function runGate(o: { runsThisMonth: number; monthlyRunCap: number; estUsd: number; maxCostPerRunUsd: number }) {
  if (o.runsThisMonth >= o.monthlyRunCap) return `Monthly trend sync limit reached (${o.runsThisMonth}/${o.monthlyRunCap} runs).`;
  if (o.estUsd > o.maxCostPerRunUsd)
    return `Run estimate US$${o.estUsd.toFixed(4)} exceeds the per-run cap US$${o.maxCostPerRunUsd.toFixed(4)}. Lower the item count or raise the cap.`;
  return null;
}

// ---------- schedule ----------

/** One cron field: *, n, a-b, with /step, comma lists. */
function fieldMatches(field: string, v: number, min: number, max: number) {
  return field.split(",").some((part) => {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? Number(stepStr) : 1;
    const [lo, hi] = range === "*" ? [min, max] : range.includes("-") ? range.split("-").map(Number) : [Number(range), stepStr ? max : Number(range)];
    return Number.isInteger(lo) && Number.isInteger(hi) && step > 0 && v >= lo && v <= hi && (v - lo) % step === 0;
  });
}

/** Wall-clock parts in the owner's time zone. */
export function zonedParts(d: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", minute: "numeric", hour: "numeric", day: "numeric", month: "numeric", weekday: "short" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { minute: Number(p.minute), hour: Number(p.hour), day: Number(p.day), month: Number(p.month), weekday: wd };
}

/**
 * Does `expr` (5 fields, owner's time zone) fire within [now, now + windowMin)? The trend-scout cron ticks every
 * 15 minutes, so each tick checks its own 15-minute window: no schedule is missed or run twice.
 */
export function cronDue(expr: string, now: Date, timeZone: string, windowMin = 15) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return false;
  const [mi, ho, da, mo, wd] = f;
  for (let i = 0; i < windowMin; i++) {
    const p = zonedParts(new Date(now.getTime() + i * 60_000), timeZone);
    if (
      fieldMatches(mi, p.minute, 0, 59) && fieldMatches(ho, p.hour, 0, 23) && fieldMatches(da, p.day, 1, 31) &&
      fieldMatches(mo, p.month, 1, 12) && (fieldMatches(wd, p.weekday, 0, 6) || (p.weekday === 0 && fieldMatches(wd, 7, 0, 7)))
    )
      return true;
  }
  return false;
}
