// Topic suggestions for the text brief: today's trending searches in Indonesia from the Google Trends RSS feed (free,
// no key). Sensitive ones (config/banned.yaml sensitiveTopics) are dropped. A failed fetch shows no suggestions.
import { contentSetup } from "./config";
import { bannedHits } from "./validate";

export type TrendTopic = { term: string; traffic: string; headline: string | null };

const FEED = "https://trends.google.com/trending/rss?geo=ID";
const TTL_MS = 3 * 3_600_000;

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() || null;
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const volume = (traffic: string) => Number(traffic.replace(/\D/g, "")) || 0;

/** The feed's items, sensitive ones out, highest search volume first. */
export function parseTrends(xml: string, sensitive: string[], limit = 8): TrendTopic[] {
  return xml
    .split("<item>")
    .slice(1)
    .map((item) => {
      const headline = tag(item, "ht:news_item_title");
      return { term: unescape(tag(item, "title") ?? ""), traffic: tag(item, "ht:approx_traffic") ?? "", headline: headline && unescape(headline) };
    })
    .filter((t) => t.term && !bannedHits(`${t.term} ${t.headline ?? ""}`, sensitive).length)
    .sort((a, b) => volume(b.traffic) - volume(a.traffic))
    .slice(0, limit);
}

// ponytail: per-process cache, refreshed every 3 hours; fine for one owner, a DB row if several servers run.
let cache: { at: number; topics: TrendTopic[] } | null = null;

export async function trendTopics(f: typeof fetch = fetch): Promise<TrendTopic[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.topics;
  try {
    const res = await f(FEED, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cache = { at: Date.now(), topics: parseTrends(await res.text(), contentSetup().banned.sensitiveTopics) };
  } catch (e) {
    console.warn(`[trends] Google Trends feed failed: ${e instanceof Error ? e.message : String(e)}`);
    return cache?.topics ?? [];
  }
  return cache.topics;
}
