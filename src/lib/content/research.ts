// Web research for text posts (Tavily). Facts for educational / thread / hot take, recent news for satire on a trend,
// and real places for a location topic (config/angles.yaml placesQuery). Results are cleaned to title, a 1-2
// sentence summary, date and URL; the model cites them by number and the code turns the citations into sourceNote.
// Any failure returns empty research plus the error, so the batch falls back to writing without factual claims.
import type { ContentConfig, TopicAngles } from "./config";
import { bannedHits } from "./validate";

export type Query = {
  query: string; topic: "general" | "news"; max_results: number;
  time_range?: string; include_domains?: string[]; include_answer?: boolean;
};
export type Raw = { answer?: string | null; results?: { title?: string; url?: string; content?: string; score?: number; published_date?: string }[] };
export type Search = (q: Query) => Promise<Raw>;

export type Fact = { title: string; summary: string; date: string | null; url: string };
export type Research = { facts: Fact[]; news: Fact[]; places: string; errors: string[] };
export const NO_RESEARCH: Research = { facts: [], news: [], places: "", errors: [] };

/** The Tavily search endpoint. The key comes from the environment and only ever goes into the request header. */
export const tavily = (key = process.env.TAVILY_API_KEY, f: typeof fetch = fetch): Search => async (q) => {
  if (!key) throw new Error("TAVILY_API_KEY is not set");
  const res = await f("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...q, search_depth: "basic" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  return (await res.json()) as Raw;
};

// ponytail: per-process cache, one entry per query per day, lost on restart; a DB table if quota matters across deploys.
const cache = new Map<string, Promise<Raw>>();
/** Same query on the same day = one Tavily call. A failed call is not cached. */
export const cachedSearch = (search: Search, today = () => new Date().toISOString().slice(0, 10)): Search => (q) => {
  const key = `${today()}|${JSON.stringify(q)}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = search(q);
    cache.set(key, hit);
    hit.catch(() => cache.delete(key));
  }
  return hit;
};

const firstSentences = (s: string, n: number) =>
  (s.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+/g) ?? [s]).slice(0, n).join("").trim().slice(0, 240);

/** Drop low-score, duplicate, already-used and sensitive results; keep title, short summary, date and URL. */
export function cleanResults(raw: Raw, o: { minScore: number; maxItems: number; sensitive: string[]; used: Set<string> }): Fact[] {
  const seen = new Set<string>();
  const out: Fact[] = [];
  for (const r of raw.results ?? []) {
    const url = r.url?.trim() ?? "";
    const title = r.title?.replace(/\s+/g, " ").trim().slice(0, 120) ?? "";
    if (!url || !title || (r.score ?? 0) < o.minScore || o.used.has(url) || seen.has(url) || seen.has(title.toLowerCase())) continue;
    seen.add(url).add(title.toLowerCase());
    const summary = firstSentences(r.content ?? "", 2);
    if (bannedHits(`${title} ${summary}`, o.sensitive).length) continue;
    out.push({ title, summary, date: r.published_date?.slice(0, 10) ?? null, url });
  }
  return out.slice(0, o.maxItems);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** Research for one batch: only the modes its types use, plus places when the topic entry has a placesQuery. */
export async function gatherResearch(o: {
  topic: string; entry: TopicAngles | null; modes: Set<string>; cfg: ContentConfig["research"];
  sensitive: string[]; used: Set<string>; search: Search;
}): Promise<Research> {
  const out: Research = { facts: [], news: [], places: "", errors: [] };
  const clean = (raw: Raw) => cleanResults(raw, { minScore: o.cfg.minScore, maxItems: o.cfg.maxItems, sensitive: o.sensitive, used: o.used });
  const jobs: Promise<void>[] = [];
  const run = (what: string, job: () => Promise<void>) => jobs.push(job().catch((e) => void out.errors.push(`${what}: ${message(e)}`)));

  if (o.modes.has("facts"))
    run("facts", async () => {
      const domains = o.cfg.credibleDomains.length ? { include_domains: o.cfg.credibleDomains } : {};
      out.facts = clean(await o.search({ query: o.entry?.factsQuery ?? o.topic, topic: "general", max_results: 8, ...domains }));
    });
  if (o.modes.has("news"))
    run("news", async () => {
      out.news = clean(await o.search({ query: o.topic, topic: "news", max_results: 8, time_range: o.cfg.newsTimeRange }));
    });
  if (o.entry?.placesQuery)
    run("places", async () => {
      const raw = await o.search({ query: o.entry!.placesQuery!, topic: "general", max_results: 8, include_answer: true });
      const answer = raw.answer && !bannedHits(raw.answer, o.sensitive).length ? raw.answer.replace(/\s+/g, " ").trim().slice(0, 600) : "";
      const items = clean(raw).slice(0, 5).map((f) => `- ${f.title}: ${f.summary}`);
      out.places = [answer, ...items].filter(Boolean).join("\n");
    });
  await Promise.all(jobs);
  return out;
}

/** "title (date) url" for every cited item; null when nothing valid is cited. */
export function sourceNoteFor(cited: number[], items: Fact[]): string | null {
  const used = [...new Set(cited)].map((n) => items[n - 1]).filter(Boolean);
  return used.length ? used.map((f) => `${f.title}${f.date ? ` (${f.date})` : ""} ${f.url}`).join("; ") : null;
}
