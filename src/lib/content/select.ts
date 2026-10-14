// Step 1 of a text-post batch: pick a content type per post, and an angle per variant. Pure.
import type { ContentType, Cta } from "@/lib/agents/schemas";
import type { Angles, ContentConfig, TopicAngles } from "./config";

/**
 * Which posts of a batch carry the CTA: none for "none"; otherwise spread evenly, at most 30% of a batch of 6 or more
 * (never every post), half of a smaller one, and the only post of a batch of 1.
 */
export function ctaPlan(count: number, cta: Cta = "none"): (Cta | null)[] {
  const n = cta === "none" ? 0 : count === 1 ? 1 : count >= 6 ? Math.max(1, Math.floor(count * 0.3)) : Math.ceil(count / 2);
  const slots = new Set(Array.from({ length: n }, (_, k) => Math.floor(((k + 0.5) * count) / n)));
  return Array.from({ length: count }, (_, i) => (slots.has(i) ? cta : null));
}

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
