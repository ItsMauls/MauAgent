"use client";
import type { TrendTopic } from "@/lib/content/trendTopics";

/** Today's trending searches under the topic field; a click puts the term in the form's topic box. */
export function TrendBubbles({ topics }: { topics: TrendTopic[] }) {
  if (!topics.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
        <span className="material-symbols-outlined !text-[14px]">trending_up</span>Trending today
      </span>
      {topics.map((t) => (
        <button
          key={t.term}
          type="button"
          title={[t.headline, t.traffic && `${t.traffic} searches`].filter(Boolean).join(" · ")}
          onClick={(e) => {
            const box = e.currentTarget.form?.elements.namedItem("topic");
            if (box instanceof HTMLTextAreaElement) {
              box.value = t.term;
              box.focus();
            }
          }}
          className="pill border-line bg-white px-3 py-1 text-xs text-ink-2 hover:border-brand/40 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {t.term}
        </button>
      ))}
    </div>
  );
}
