// Step 1 of a text-post batch: pick a content type per post, and an optional creative angle. Pure.
import type { ContentConfig } from "./config";

/** Thread types count toward the weekly thread cap. */
export const isThreadType = (cfg: ContentConfig, type: string) => !!cfg.types[type]?.thread;

/**
 * One weighted pick. `recent` is the type history, most recent last (earlier batches + this one). A type is left out
 * when it would run more than maxConsecutive times in a row, or when it is a thread type and the weekly cap is
 * reached. Returns null when nothing is left.
 */
export function pickType(
  cfg: ContentConfig,
  s: { recent: string[]; threadsThisWeek: number },
  rand: () => number = Math.random,
): string | null {
  const tail = s.recent.slice(-cfg.maxConsecutive);
  const repeated = tail.length === cfg.maxConsecutive && tail.every((t) => t === tail[0]) ? tail[0] : null;
  const options = Object.entries(cfg.types).filter(
    ([t, c]) => c.weight > 0 && t !== repeated && !(c.thread && s.threadsThisWeek >= cfg.weeklyThreadCap),
  );
  const total = options.reduce((n, [, c]) => n + c.weight, 0);
  if (!total) return null;
  let r = rand() * total;
  for (const [t, c] of options) if ((r -= c.weight) < 0) return t;
  return options[options.length - 1][0];
}

/** A seed theme for the light types (null for the others), avoiding the ones already used in this batch. */
export function angleFor(cfg: ContentConfig, type: string, used: Set<string>, rand: () => number = Math.random): string | null {
  if (!cfg.types[type]?.seedTheme) return null;
  const free = cfg.seedThemes.filter((t) => !used.has(t));
  const pool = free.length ? free : cfg.seedThemes;
  return pool[Math.floor(rand() * pool.length)];
}
