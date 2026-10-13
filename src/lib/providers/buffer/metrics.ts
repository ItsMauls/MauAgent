import type { BufferPostInfo } from "./schemas";

// The PRD never uses these (they are retired or unreliable on Instagram), so they are dropped even if Buffer sends them.
const NEVER = new Set(["impressions", "plays"]);

export const WINDOWS = [["1h", "1h"], ["24h", "23h"], ["7d", "6d"]] as const; // [label, sleep since the previous pull]

/** Exactly what Buffer reported for the post. An empty list carries the reason; nothing is invented or filled in. */
export function snapshotFrom(post: Pick<BufferPostInfo, "metrics" | "metricsUpdatedAt">) {
  const items = (post.metrics ?? []).filter((m) => !NEVER.has(m.type.toLowerCase()));
  return {
    source: "buffer" as const,
    items,
    metricsUpdatedAt: post.metricsUpdatedAt ?? null,
    ...(items.length ? {} : { reason: "Buffer has not reported metrics for this post yet (they refresh about daily, and not every network reports them)." }),
  };
}
