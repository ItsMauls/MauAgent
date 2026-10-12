// Options copied from the actor's input schema (GULLsEZsAD69QFACQ, stable build 1.0.22, read 12 Oct 2026 via
// GET /v2/acts/{id}/builds/default). Re-check there when the actor changes. See DECISIONS.md.
import { z } from "zod";

type Opt = readonly (readonly [string, string])[];
const values = <T extends Opt>(o: T) => o.map(([v]) => v) as [T[number][0], ...T[number][0][]];

/** Songs and creators are not offered: TikTok removed those feeds from Creative Center (actor README, 2026). */
export const TREND_TYPES = [["hashtags", "Trending hashtags"], ["videos", "Top videos"]] as const;

/** Hashtag countries (ISO 3166-1 alpha-2). */
export const COUNTRIES = [
  ["US", "United States"], ["FR", "France"], ["DE", "Germany"], ["IT", "Italy"], ["ES", "Spain"], ["GB", "United Kingdom"],
  ["AR", "Argentina"], ["AU", "Australia"], ["BR", "Brazil"], ["CA", "Canada"], ["CO", "Colombia"], ["EG", "Egypt"],
  ["ID", "Indonesia"], ["IL", "Israel"], ["JP", "Japan"], ["KR", "South Korea"], ["MY", "Malaysia"], ["MX", "Mexico"],
  ["PH", "Philippines"], ["SA", "Saudi Arabia"], ["SG", "Singapore"], ["ZA", "South Africa"], ["TW", "Taiwan"],
  ["TH", "Thailand"], ["TR", "Turkey"], ["AE", "United Arab Emirates"], ["VN", "Vietnam"],
] as const;
/** TikTok exposes Top Videos for these five regions only. */
export const VIDEO_COUNTRIES = [["US", "United States"], ["JP", "Japan"], ["VN", "Vietnam"], ["TH", "Thailand"], ["ID", "Indonesia"]] as const;
export const HASHTAG_PERIODS = [["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]] as const;
export const VIDEO_PERIODS = [["7", "Last 7 days"], ["30", "Last 30 days"]] as const;
export const INDUSTRIES = [
  ["", "All industries"], ["10000000000", "Education"], ["11000000000", "Vehicle & Transportation"],
  ["12000000000", "Baby, Kids & Maternity"], ["14000000000", "Beauty & Personal Care"], ["15000000000", "Tech & Electronics"],
  ["17000000000", "Travel"], ["18000000000", "Household Products"], ["19000000000", "Pets"], ["21000000000", "Home Improvement"],
  ["22000000000", "Apparel & Accessories"], ["23000000000", "News & Entertainment"], ["25000000000", "Games"],
  ["27000000000", "Food & Beverage"], ["28000000000", "Sports & Outdoor"], ["29000000000", "Health"],
] as const;
export const CONTENT_TAGS = [
  ["", "All content tags"], ["11002", "Beauty & Care"], ["11003", "Fashion"], ["11010", "Food & Beverage"],
  ["11013", "Lifestyle & Leisure"], ["11015", "Technology & Finance"],
] as const;
export const VIDEO_ORDER = [["1", "Highest video views"], ["2", "Highest engagement"], ["3", "Highest 6s views"]] as const;

export const COUNTRY_CODES: readonly string[] = values(COUNTRIES);
export const VIDEO_COUNTRY_CODES: readonly string[] = values(VIDEO_COUNTRIES);
export const countryName = (code: string) => COUNTRIES.find(([c]) => c === code)?.[1] ?? code;

/** Non-country defaults (the actor's sample). Countries default to the owner's country: default-country.ts. */
export const DEFAULTS = {
  trendType: "hashtags", maxItems: 20, saveMedia: false, hashtagPeriod: "7", industryId: "", videoPeriod: "7",
  videoContentTag: "", videoOrderBy: "1", videoOrganicOnly: false, useApifyProxy: true,
} as const;

export const MAX_ITEMS = { min: 1, max: 200 };

/** Everything the actor needs plus our own run controls. Validated on save and before every run. */
export const TikTokTrendsSettings = z.object({
  trendType: z.enum(values(TREND_TYPES)),
  maxItems: z.coerce.number().int().min(MAX_ITEMS.min).max(MAX_ITEMS.max),
  countryCode: z.enum(values(COUNTRIES)),
  hashtagPeriod: z.enum(values(HASHTAG_PERIODS)),
  industryId: z.enum(values(INDUSTRIES)),
  videoCountry: z.enum(values(VIDEO_COUNTRIES)),
  videoPeriod: z.enum(values(VIDEO_PERIODS)),
  videoContentTag: z.enum(values(CONTENT_TAGS)),
  videoOrderBy: z.enum(values(VIDEO_ORDER)),
  videoOrganicOnly: z.boolean(),
  saveMedia: z.boolean(),
  useApifyProxy: z.boolean(),
});
export type TikTokTrendsSettings = z.infer<typeof TikTokTrendsSettings>;

/** Run controls stored next to the actor settings. */
export const TrendRunControls = z.object({
  scheduleCron: z.string().trim().regex(/^(\S+\s+){4}\S+$/, "Cron needs 5 fields (min hour day month weekday)"),
  enabled: z.boolean(),
  cacheHours: z.coerce.number().int().min(0).max(24 * 30),
  monthlyRunCap: z.coerce.number().int().min(0).max(10000),
  maxCostPerRunUsd: z.coerce.number().min(0).max(100),
});

const num = z.coerce.number().optional().catch(undefined);

/** Raw dataset items: tolerant (every field optional, unknown fields kept). */
export const RawHashtag = z.looseObject({
  Rank: num,
  Hashtag: z.string().optional(),
  "Hashtag ID": z.coerce.string().optional(),
  Posts: num,
  "Video Views": num,
  "Country Code": z.string().optional(),
  "TikTok URL": z.string().optional(),
  "Trend Direction": z.string().optional(),
});
export const RawVideo = z.looseObject({
  "Video Rank": num,
  Title: z.string().optional(),
  "Author Handle": z.string().optional(),
  Views: num,
  Followers: num,
  "Video ID": z.coerce.string().optional(),
  "Video TikTok URL": z.string().optional(),
  "Create Time": z.string().optional(),
});
