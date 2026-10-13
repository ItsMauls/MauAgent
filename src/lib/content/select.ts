// Step 1 of a text-post batch: pick a content type per post, and an angle per variant. Pure.
import type { ContentType } from "@/lib/agents/schemas";
import type { Angles, ContentConfig, TopicAngles } from "./config";

/** Thread types count toward the weekly thread cap. */
export const isThreadType = (cfg: ContentConfig, type: string) => !!cfg.types[type as ContentType]?.thread;

/**
 * One weighted pick. `recent` is the type history, most recent last (earlier batches + this one). A type is left out
 * when it would run more than maxConsecutive times in a row, or when it is a thread type and the weekly cap is
 * reached. Returns null when nothing is left.
 */
export function pickType(
  cfg: ContentConfig,
  s: { recent: string[]; threadsThisWeek: number },
  rand: () => number = Math.random,
): ContentType | null {
  const tail = s.recent.slice(-cfg.maxConsecutive);
  const repeated = tail.length === cfg.maxConsecutive && tail.every((t) => t === tail[0]) ? tail[0] : null;
  const options = (Object.entries(cfg.types) as [ContentType, NonNullable<ContentConfig["types"][ContentType]>][]).filter(
    ([t, c]) => c.weight > 0 && t !== repeated && !(c.thread && s.threadsThisWeek >= cfg.weeklyThreadCap),
  );
  const total = options.reduce((n, [, c]) => n + c.weight, 0);
  if (!total) return null;
  let r = rand() * total;
  for (const [t, c] of options) if ((r -= c.weight) < 0) return t;
  return options[options.length - 1][0];
}

/** The angles.yaml entry for a batch topic: every `match` phrase appears in it. */
export const topicEntry = (angles: Angles, topic: string): TopicAngles | null =>
  angles.topics.find((e) => e.match.every((m) => topic.toLowerCase().includes(m.toLowerCase()))) ?? null;

/**
 * `count` different angles from `list`, at random: never one already `used` in this batch, and none of the `recent`
 * ones (last posts) while unused ones are left. Picks may repeat only when the list is shorter than the batch.
 */
export function pickAngles(list: string[], count: number, used: Set<string>, recent: string[], rand: () => number = Math.random): string[] {
  const out: string[] = [];
  for (let i = 0; i < count && list.length; i++) {
    const taken = (a: string) => used.has(a) || out.includes(a);
    const tiers = [list.filter((a) => !taken(a) && !recent.includes(a)), list.filter((a) => !taken(a)), list.filter((a) => !out.includes(a)), list];
    const pool = tiers.find((t) => t.length)!;
    out.push(pool[Math.floor(rand() * pool.length)]);
  }
  return out;
}
