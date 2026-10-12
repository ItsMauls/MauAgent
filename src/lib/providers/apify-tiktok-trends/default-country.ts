// Default trend country = the signed-in owner's country. Runs only when settings are first created or on
// "Reset to my country"; the result is stored, and the cron reads the stored value only. Never stores or logs an IP.
import { COUNTRY_CODES, VIDEO_COUNTRY_CODES } from "./schema";

export const FALLBACK_COUNTRY = "ID";

/** Request headers set by the CDN in front of the app, in order of preference. */
export const COUNTRY_HEADERS = ["cloudfront-viewer-country", "x-vercel-ip-country", "cf-ipcountry"] as const;

export type CountryCtx = {
  /** Value already stored in TrendSourceSettings: an explicit choice always wins. */
  saved?: string | null;
  /** Auth0 custom claim or user_metadata.country. */
  profileCountry?: unknown;
  /** Lower-case header lookup (e.g. Next's headers().get). */
  header?: (name: string) => string | null | undefined;
};

const norm = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : "");

/** First valid ISO 3166-1 alpha-2 code from saved → profile → CDN headers, else ID (or the first valid option). Pure. */
export function resolveDefaultCountry(ctx: CountryCtx, valid: readonly string[] = COUNTRY_CODES): string {
  const candidates = [ctx.saved, ctx.profileCountry, ...COUNTRY_HEADERS.map((h) => ctx.header?.(h))];
  for (const c of candidates.map(norm)) if (/^[A-Z]{2}$/.test(c) && valid.includes(c)) return c;
  return valid.includes(FALLBACK_COUNTRY) ? FALLBACK_COUNTRY : valid[0];
}

/** Both country fields start from the same resolved country; video falls back when TikTok has no video feed there. */
export function defaultCountries(ctx: Omit<CountryCtx, "saved">) {
  const countryCode = resolveDefaultCountry(ctx, COUNTRY_CODES);
  return { countryCode, videoCountry: resolveDefaultCountry({ saved: countryCode }, VIDEO_COUNTRY_CODES) };
}

/** Country from the Auth0 session user: a namespaced custom claim, a plain `country` claim or user_metadata. */
export function profileCountry(user: Record<string, unknown> | undefined): unknown {
  if (!user) return undefined;
  const claim = Object.entries(user).find(([k]) => k.endsWith("/country"))?.[1];
  const meta = user.user_metadata as { country?: unknown } | undefined;
  return claim ?? user.country ?? meta?.country;
}
