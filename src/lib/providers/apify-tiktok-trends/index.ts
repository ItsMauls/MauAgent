import { fetchTrends } from "./fetch-trends";
import type { NormalizedSignal } from "./normalize";
import type { TikTokTrendsSettings } from "./schema";

/** A trend source (Apify now, vidIQ later): settings in, normalized signals out. */
export interface TrendSource<S> {
  fetch(settings: S): Promise<NormalizedSignal[]>;
}

export const apifyTikTokTrends = (maxCostPerRunUsd: number): TrendSource<TikTokTrendsSettings> => ({
  fetch: (s) => fetchTrends(s, maxCostPerRunUsd),
});

export * from "./schema";
export { buildInput } from "./build-input";
export { normalize, type NormalizedSignal } from "./normalize";
export { resolveDefaultCountry, defaultCountries, profileCountry, COUNTRY_HEADERS, type CountryCtx } from "./default-country";
export { startRun, getRun, listItems, RUN_TIMEOUT_SECS } from "./fetch-trends";
