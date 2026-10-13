import type { SocialPosts } from "@/lib/agents/schemas";

type Who = { handle: string; avatarUrl: string | null } | null;
const REVIEW: Record<string, string> = {
  approved: "text-emerald-700",
  needs_review: "text-amber-700",
  rejected: "text-red-700",
};

/** Generated posts as they look on X / Threads: avatar, name, handle, text, thread parts under a connector line. */
export function PostPreview({ posts, who }: { posts: SocialPosts["posts"]; who: Who }) {
  const handle = who?.handle.replace(/^@/, "") ?? "youraccount";
  const avatar = (
    who?.avatarUrl
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={who.avatarUrl} alt="" className="size-10 rounded-full object-cover" />
      : <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">{handle.slice(0, 2).toUpperCase()}</span>
  );
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
      {posts.map((p, i) => (
        <li key={i} className="flex gap-3 px-4 py-3">
          <div className="flex shrink-0 flex-col items-center">
            {avatar}
            {p.thread.length > 0 && <span aria-hidden className="mt-1 w-0.5 flex-1 rounded bg-line" />}
          </div>
          <div className="min-w-0 flex-1 text-[15px] leading-snug">
            <p className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="font-bold">{handle}</span>
              <span className="text-sm text-ink-3">@{handle} · Post {i + 1}</span>
              {p.type && <span className="text-xs text-ink-3">· {p.type.replaceAll("_", " ")}</span>}
              {p.status && <span className={`ml-auto text-xs font-semibold ${REVIEW[p.status]}`}>{p.status.replace("_", " ")}</span>}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap break-words">{p.text}</p>
            {p.thread.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-semibold text-brand">Show thread ({p.thread.length} more)</summary>
                <ol className="mt-2 space-y-2 border-l-2 border-line pl-3">
                  {p.thread.map((t, k) => <li key={k} className="whitespace-pre-wrap break-words text-sm"><span className="mr-1 text-xs font-bold text-ink-3">{k + 2}/</span>{t}</li>)}
                </ol>
              </details>
            )}
            {p.reasons.length > 0 && <p className="mt-1 text-xs text-ink-3">{p.reasons.join(" · ")}</p>}
            {p.sourceNote && <p className="mt-1 text-xs text-ink-3">Source named by the AI{p.confidence ? ` (${p.confidence})` : ""}: {p.sourceNote}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
