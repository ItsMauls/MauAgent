import type { TikTokTrendsSettings } from "./schema";

/** Settings → actor input. Only the fields that apply to the chosen trend type are sent. Pure. */
export function buildInput(s: TikTokTrendsSettings) {
  const common = { trendType: s.trendType, maxItems: s.maxItems, saveMedia: s.saveMedia, proxyConfiguration: { useApifyProxy: s.useApifyProxy } };
  return s.trendType === "hashtags"
    ? { ...common, countryCode: s.countryCode, hashtagPeriod: s.hashtagPeriod, industryId: s.industryId }
    : {
        ...common, videoCountry: s.videoCountry, videoPeriod: s.videoPeriod, videoContentTag: s.videoContentTag,
        videoOrderBy: s.videoOrderBy, videoOrganicOnly: s.videoOrganicOnly,
      };
}
