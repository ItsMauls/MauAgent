// Raw dataset items → TrendSignal rows. Pure; tested with the README fixtures.
// outlierScore is 0–10 for both types so signals from every source can be ranked together.
import { RawHashtag, RawVideo } from "./schema";

export type NormalizedSignal = {
  source: "apify_tiktok";
  platform: "tiktok";
  trendType: "hashtags" | "videos";
  externalId: string;
  url: string;
  outlierScore: number;
  hook: string;
  format: string;
  audio: string | null;
  capturedAt: Date;
  rawPayload: Record<string, unknown>;
};

const round = (n: number) => Math.round(n * 100) / 100;
const DIRECTION: Record<string, number> = { up: 1.2, down: 0.8 };

/** Hashtags have no view/follower ratio: score by rank (1 = 10), nudged by trend direction, capped at 10. */
export const hashtagScore = (rank: number, n: number, direction?: string) =>
  round(Math.min(10, 10 * (1 - (Math.max(rank, 1) - 1) / Math.max(n, 1)) * (DIRECTION[direction ?? ""] ?? 1)));

/** Videos: views relative to the author's followers (classic outlier), on a log scale: 10× → 2.6, 1000× → 7.5, capped at 10. */
export const videoScore = (views: number, followers: number) => round(Math.min(10, 2.5 * Math.log10(1 + views / Math.max(followers, 1))));

/** `period` (7 or 30 days) is part of externalId: the same hashtag appears in both windows on the same day. */
export function normalize(trendType: "hashtags" | "videos", items: unknown[], period: string, capturedAt = new Date()): NormalizedSignal[] {
  const out: NormalizedSignal[] = [];
  for (const raw of items) {
    if (trendType === "hashtags") {
      const r = RawHashtag.safeParse(raw);
      if (!r.success) continue;
      const h = r.data;
      const tag = h.Hashtag?.trim();
      const url = h["TikTok URL"] ?? (tag ? `https://www.tiktok.com/tag/${encodeURIComponent(tag.replace(/^#/, ""))}` : undefined);
      if (!tag || !url) continue;
      out.push({
        source: "apify_tiktok", platform: "tiktok", trendType, capturedAt, audio: null, format: "hashtag",
        externalId: `hashtag:${period}:${h["Country Code"] ?? ""}:${h["Hashtag ID"] ?? tag}`,
        url, hook: tag, outlierScore: hashtagScore(h.Rank ?? items.length, items.length, h["Trend Direction"]),
        rawPayload: h,
      });
    } else {
      const r = RawVideo.safeParse(raw);
      if (!r.success) continue;
      const v = r.data;
      const url = v["Video TikTok URL"];
      if (!url) continue;
      out.push({
        source: "apify_tiktok", platform: "tiktok", trendType, capturedAt, audio: null, format: "video",
        externalId: `video:${period}:${v["Video ID"] ?? url}`,
        url, hook: (v.Title ?? "").trim() || (v["Author Handle"] ?? url), outlierScore: videoScore(v.Views ?? 0, v.Followers ?? 0),
        rawPayload: v,
      });
    }
  }
  return out;
}
