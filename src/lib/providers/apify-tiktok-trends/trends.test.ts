import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInput } from "./build-input";
import { normalize, hashtagScore, videoScore } from "./normalize";
import { DEFAULTS, TikTokTrendsSettings } from "./schema";
import { defaultCountries, profileCountry, resolveDefaultCountry } from "./default-country";
import { cronDue, runGate } from "@/lib/trends";

const base = TikTokTrendsSettings.parse({ ...DEFAULTS, countryCode: "ID", videoCountry: "ID" });

// ---------- build-input ----------

test("buildInput: hashtags sends only hashtag fields", () => {
  assert.deepEqual(buildInput(base), {
    trendType: "hashtags", maxItems: 20, saveMedia: false, proxyConfiguration: { useApifyProxy: true },
    countryCode: "ID", hashtagPeriod: "7", industryId: "",
  });
});

test("buildInput: videos sends only video fields", () => {
  const i = buildInput({ ...base, trendType: "videos", videoOrderBy: "2", videoOrganicOnly: true });
  assert.deepEqual(i, {
    trendType: "videos", maxItems: 20, saveMedia: false, proxyConfiguration: { useApifyProxy: true },
    videoCountry: "ID", videoPeriod: "7", videoContentTag: "", videoOrderBy: "2", videoOrganicOnly: true,
  });
  assert.ok(!("countryCode" in i));
});

// ---------- settings validation ----------

test("settings: rejects unsupported options and out-of-range maxItems", () => {
  const bad = (o: object) => !TikTokTrendsSettings.safeParse({ ...base, ...o }).success;
  assert.ok(bad({ trendType: "songs" })); // removed by TikTok
  assert.ok(bad({ countryCode: "XX" }));
  assert.ok(bad({ videoCountry: "FR" })); // top videos: US/JP/VN/TH/ID only
  assert.ok(bad({ maxItems: 0 }));
  assert.ok(bad({ maxItems: 201 }));
  assert.ok(bad({ hashtagPeriod: "14" }));
  assert.ok(!bad({ maxItems: "50" })); // form strings are coerced
});

// ---------- normalize (README fixtures) ----------

const HASHTAG = {
  Rank: 21, Hashtag: "#joliegarcegang", "Hashtag ID": "1075929", Posts: 1212, "Video Views": 0, Industries: [], Country: "France",
  "Country Code": "FR", Period: "7 days", "TikTok URL": "https://www.tiktok.com/tag/joliegarcegang", "Trend Direction": "down",
  "Trend Stats": { average: 51.26, max: 100, min: 0 },
};
const VIDEO = {
  "Video Rank": 1, Title: "The easiest 15-minute dinner you'll make this week 🍝", Author: "Chef Marco", "Author Handle": "@chefmarco",
  Views: 4820000, Followers: 984000, "Video ID": "7512345678901234567", "Video Country Code": "US",
  "Video TikTok URL": "https://www.tiktok.com/@chefmarco/video/7512345678901234567", Metrics: [{ metric: "Views", value: 4820000 }],
};

test("normalize: hashtag item", () => {
  const items = [HASHTAG, ...Array.from({ length: 29 }, (_, i) => ({ ...HASHTAG, Rank: i + 30, "Hashtag ID": String(i) }))];
  const [s] = normalize("hashtags", items, "7", new Date("2026-10-12T00:00:00Z"));
  assert.equal(s.platform, "tiktok");
  assert.equal(s.source, "apify_tiktok");
  assert.equal(s.format, "hashtag");
  assert.equal(s.hook, "#joliegarcegang");
  assert.equal(s.url, "https://www.tiktok.com/tag/joliegarcegang");
  assert.equal(s.externalId, "hashtag:7:FR:1075929");
  assert.equal(s.outlierScore, hashtagScore(21, 30, "down"));
  assert.equal(s.audio, null);
  assert.deepEqual(s.rawPayload["Trend Stats"], HASHTAG["Trend Stats"]); // unknown fields kept
});

test("normalize: video item, tolerant of junk", () => {
  const out = normalize("videos", [VIDEO, { Title: "no url" }, "garbage", null], "30");
  assert.equal(out.length, 1);
  assert.equal(out[0].externalId, "video:30:7512345678901234567");
  assert.equal(out[0].hook, VIDEO.Title);
  assert.equal(out[0].outlierScore, videoScore(4820000, 984000));
});

test("scores: 0–10 for both types, rank 1 / viral video score high", () => {
  assert.equal(hashtagScore(1, 20, "flat"), 10);
  assert.equal(hashtagScore(1, 20, "up"), 10); // capped
  assert.ok(hashtagScore(20, 20) < 1);
  assert.equal(videoScore(0, 1000), 0);
  assert.ok(videoScore(1_000_000, 1000) > 7);
  assert.equal(videoScore(1e12, 1), 10);
});

// ---------- default country ----------

test("resolveDefaultCountry: saved > profile > CloudFront > Vercel > Cloudflare > ID", () => {
  const h = (m: Record<string, string>) => (n: string) => m[n];
  assert.equal(resolveDefaultCountry({ saved: "jp", profileCountry: "US", header: h({ "cloudfront-viewer-country": "FR" }) }), "JP");
  assert.equal(resolveDefaultCountry({ profileCountry: "us", header: h({ "cloudfront-viewer-country": "FR" }) }), "US");
  assert.equal(resolveDefaultCountry({ header: h({ "cloudfront-viewer-country": "FR", "x-vercel-ip-country": "DE" }) }), "FR");
  assert.equal(resolveDefaultCountry({ header: h({ "x-vercel-ip-country": "de", "cf-ipcountry": "GB" }) }), "DE");
  assert.equal(resolveDefaultCountry({ header: h({ "cf-ipcountry": "GB" }) }), "GB");
  assert.equal(resolveDefaultCountry({}), "ID");
});

test("resolveDefaultCountry: invalid or unsupported codes are skipped", () => {
  const h = (m: Record<string, string>) => (n: string) => m[n];
  assert.equal(resolveDefaultCountry({ profileCountry: "Indonesia", header: h({ "cf-ipcountry": "XX" }) }), "ID");
  assert.equal(resolveDefaultCountry({ header: h({ "cloudfront-viewer-country": "NL", "cf-ipcountry": "SG" }) }), "SG"); // NL not offered
  assert.equal(resolveDefaultCountry({ profileCountry: 42 }), "ID");
  assert.equal(resolveDefaultCountry({}, ["US", "JP"]), "US"); // ID not valid → first option
});

test("defaultCountries: both fields start equal; video falls back to ID where TikTok has no video feed", () => {
  assert.deepEqual(defaultCountries({}), { countryCode: "ID", videoCountry: "ID" });
  assert.deepEqual(defaultCountries({ profileCountry: "JP" }), { countryCode: "JP", videoCountry: "JP" });
  assert.deepEqual(defaultCountries({ profileCountry: "FR" }), { countryCode: "FR", videoCountry: "ID" });
});

test("profileCountry: namespaced claim, plain claim, user_metadata", () => {
  assert.equal(profileCountry({ "https://mauagent.app/country": "ID" }), "ID");
  assert.equal(profileCountry({ country: "JP" }), "JP");
  assert.equal(profileCountry({ user_metadata: { country: "TH" } }), "TH");
  assert.equal(profileCountry(undefined), undefined);
});

// ---------- schedule + gate ----------

test("cronDue: 15-minute window in the owner's time zone", () => {
  const jkt = "Asia/Jakarta"; // UTC+7
  assert.equal(cronDue("0 6 * * *", new Date("2026-10-11T23:00:00Z"), jkt), true); // 06:00 WIB
  assert.equal(cronDue("0 6 * * *", new Date("2026-10-11T23:15:00Z"), jkt), false); // next tick: no double run
  assert.equal(cronDue("10 6 * * *", new Date("2026-10-11T23:00:00Z"), jkt), true); // 06:10 inside the window
  assert.equal(cronDue("*/30 * * * *", new Date("2026-10-11T23:15:00Z"), jkt), false);
  assert.equal(cronDue("0 6 * * 1-5", new Date("2026-10-10T23:00:00Z"), jkt), false); // Sunday 11 Oct
  assert.equal(cronDue("0 6 * * 0,6", new Date("2026-10-10T23:00:00Z"), jkt), true);
  assert.equal(cronDue("0 6 * * 7", new Date("2026-10-10T23:00:00Z"), jkt), true); // 7 = Sunday
  assert.equal(cronDue("bad", new Date(), jkt), false);
});

test("runGate: monthly run cap and per-run estimate", () => {
  assert.equal(runGate({ runsThisMonth: 1, monthlyRunCap: 60, estUsd: 0.055, maxCostPerRunUsd: 0.5 }), null);
  assert.match(String(runGate({ runsThisMonth: 60, monthlyRunCap: 60, estUsd: 0, maxCostPerRunUsd: 1 })), /sync limit/);
  assert.match(String(runGate({ runsThisMonth: 0, monthlyRunCap: 60, estUsd: 0.325, maxCostPerRunUsd: 0.1 })), /per-run cap/);
});
