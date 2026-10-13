"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CHAR_LIMIT, MODES, MODE_LABEL, charCount, fmtZoned, postText, textProblem, toZonedInput, zonedToIso } from "@/lib/publish";
import { MAX_THREAD } from "@/lib/providers/buffer/mapper";
import { CancelPublishButton, ErrorText, useAction } from "../ui";
import { updateTextPost } from "./actions";
import { Modal } from "./modal";

type Mode = (typeof MODES)[number];
type Draft = { text: string; thread: string[]; mode: Mode; dueAt?: string };

export type PostRow = {
  id: string; platform: string; handle: string; avatarUrl?: string | null; status: string; mode: Mode; scheduledAt: Date | null;
  caption: string | null; hashtags: string[]; thread: string[]; error: string | null; permalink: string | null;
  postId: string | null; campaignId: string | null; agentTaskId: string | null;
  sourceNote?: string | null; sourceConfidence?: string | null;
};

const STATUS_PILL: Record<string, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-700",
  scheduled: "border-blue-200 bg-brand-soft text-brand-dark",
  publishing: "border-amber-200 bg-amber-soft text-amber-800",
  published: "border-emerald-200 bg-ok-soft text-emerald-800",
  failed: "border-red-200 bg-bad-soft text-red-800",
};
const PILL = "pill border-line bg-white px-4 py-2 text-ink-2 peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:text-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand";

/** Text, thread parts, how and when. Used for a new post and for editing one; the caller decides what saving means. */
function PostEditor({ platforms, init, due: initDue, timezone, submitLabel, onSave, onCancel }: {
  platforms: string[]; init: Draft; due?: string; timezone: string; submitLabel: string;
  onSave: (d: Draft) => Promise<unknown>; onCancel?: () => void;
}) {
  const save = useAction();
  const id = useId();
  const [text, setText] = useState(init.text);
  const [parts, setParts] = useState(init.thread);
  const [mode, setMode] = useState<Mode>(init.mode);
  const [due, setDue] = useState(initDue ?? "");
  const [confirmNow, setConfirmNow] = useState(false);

  const limit = Math.min(...platforms.map((p) => CHAR_LIMIT[p] ?? Infinity));
  const problem = (t: string) => platforms.map((p) => textProblem(p, t)).find(Boolean) ?? null;
  const blocked = [text, ...parts].map(problem).find(Boolean) ?? null;
  const ready = !blocked && !!platforms.length && (mode !== "scheduled" || !!due) && (mode !== "now" || confirmNow);
  const count = (t: string) => (platforms.length ? Math.max(...platforms.map((p) => charCount(p, t))) : t.length);
  const counter = (t: string) => (
    <p className={`mt-1 text-xs ${problem(t) ? "text-red-700" : "text-ink-3"}`}>{count(t)}{Number.isFinite(limit) ? ` / ${limit}` : ""} {problem(t) && t.trim() ? `· ${problem(t)}` : ""}</p>
  );

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="label">{parts.length ? "Post 1" : "Post"}</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="input" placeholder="What do you want to say?" />
        {counter(text)}
      </label>
      {parts.map((t, k) => (
        <label key={k} className="block">
          <span className="label flex items-center justify-between">
            Part {k + 2}
            <button type="button" onClick={() => setParts(parts.filter((_, i) => i !== k))} className="normal-case tracking-normal text-red-700">Remove</button>
          </span>
          <textarea value={t} onChange={(e) => setParts(parts.map((x, i) => (i === k ? e.target.value : x)))} rows={3} className="input" />
          {counter(t)}
        </label>
      ))}
      {parts.length + 1 < MAX_THREAD && (
        <button type="button" onClick={() => setParts([...parts, ""])} className="text-sm font-semibold text-brand">+ Add a thread part</button>
      )}

      <fieldset>
        <legend className="label">How</legend>
        <div className="flex flex-wrap items-center gap-2">
          {MODES.map((m) => (
            <label key={m} className="cursor-pointer">
              <input type="radio" name={id} checked={mode === m} onChange={() => setMode(m)} className="peer sr-only" />
              <span className={PILL}>{MODE_LABEL[m]}</span>
            </label>
          ))}
        </div>
        {(mode === "scheduled" || mode === "draft") && (
          <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="input w-auto" />
            <span className="text-ink-2">{timezone}{mode === "draft" ? " · optional for a draft" : ""}</span>
          </label>
        )}
      </fieldset>
      {mode === "now" && (
        <label className="flex items-center gap-2 text-sm font-medium text-red-800">
          <input type="checkbox" checked={confirmNow} onChange={(e) => setConfirmNow(e.target.checked)} />
          I understand this posts to the live account right away.
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={save.pending || !ready}
          onClick={() => save.run(() => onSave({ text, thread: parts, mode, ...(due && (mode === "scheduled" || mode === "draft") ? { dueAt: zonedToIso(due, timezone) } : {}) }))}
          className="btn-primary"
        >
          {save.pending ? "Saving…" : submitLabel}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="btn-soft">Close</button>}
      </div>
      <ErrorText error={save.error} />
    </div>
  );
}

const PLATFORM_ICON: Record<string, string> = { twitter: "tag", threads: "alternate_email", instagram: "photo_camera", tiktok: "music_note" };

/** Channel profile picture, or the handle's initials until Buffer provides one. */
function Avatar({ url, handle, platform }: { url?: string | null; handle: string; platform: string }) {
  return (
    <span className="relative shrink-0">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-10 rounded-full object-cover" />
      ) : (
        <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">{handle.replace(/^@/, "").slice(0, 2).toUpperCase()}</span>
      )}
      <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-white shadow-sm">
        <span className="material-symbols-outlined !text-[11px]">{PLATFORM_ICON[platform] ?? "public"}</span>
      </span>
    </span>
  );
}

function PostCard({ p, timezone }: { p: PostRow; timezone: string }) {
  const router = useRouter();
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const text = p.campaignId ? postText(p.caption, p.hashtags) : (p.caption ?? "");
  const editable = !p.campaignId && (p.status === "draft" || p.status === "scheduled" || (p.status === "failed" && !p.postId && p.error !== "Cancelled"));
  const open = p.permalink ?? (p.campaignId ? `/campaigns/${p.campaignId}?tab=publication` : p.agentTaskId ? `/boards/roles?role=socmed-specialist&tab=task&task=${p.agentTaskId}` : null);

  return (
    <article className="space-y-3 rounded-2xl border border-line bg-white p-4">
      <header className="flex flex-wrap items-center gap-3 text-sm">
        <Avatar url={p.avatarUrl} handle={p.handle} platform={p.platform} />
        <span className="min-w-0">
          <span className="block truncate font-semibold leading-tight">@{p.handle.replace(/^@/, "")}</span>
          <span className="block text-xs capitalize leading-tight text-ink-3">{p.platform === "twitter" ? "X" : p.platform}</span>
        </span>
        <span className={`pill ${STATUS_PILL[p.status] ?? "border-line bg-white text-ink-2"}`}>{p.status}</span>
        {p.campaignId && <span className="pill border-line bg-canvas text-ink-2">Video</span>}
        {p.mode !== "draft" && <span className="text-ink-2">· {MODE_LABEL[p.mode]}</span>}
        <span className="ml-auto flex items-center gap-1 text-ink-2">
          <span className="material-symbols-outlined !text-[18px]" aria-hidden>schedule</span>
          {p.scheduledAt ? fmtZoned(p.scheduledAt, timezone) : p.mode === "queue" ? "Next Buffer slot" : "No time set"}
        </span>
      </header>

      {editing ? (
        <PostEditor
          platforms={[p.platform]} timezone={timezone} submitLabel="Save changes" onCancel={() => setEditing(false)}
          init={{ text: p.caption ?? "", thread: p.thread, mode: p.mode }}
          due={p.scheduledAt ? toZonedInput(p.scheduledAt, timezone) : undefined}
          onSave={async (d) => { await updateTextPost(p.id, d); setEditing(false); router.refresh(); }}
        />
      ) : (
        <>
          <p className="whitespace-pre-wrap text-sm">{text || <span className="text-ink-3">(no text)</span>}</p>
          {p.thread.length > 0 && (
            <ol className="space-y-2 border-l-2 border-line pl-3">
              {p.thread.map((t, k) => (
                <li key={k} className="text-sm"><span className="mr-1 text-xs font-bold text-ink-3">{k + 2}.</span><span className="whitespace-pre-wrap">{t}</span></li>
              ))}
            </ol>
          )}
        </>
      )}
      {p.sourceNote && !editing && (
        <p className="rounded-xl bg-canvas p-2.5 text-xs text-ink-2">
          <span className="font-semibold">Source named by the AI{p.sourceConfidence ? ` (${p.sourceConfidence} confidence)` : ""}:</span> {p.sourceNote}
          {p.status === "draft" && <span className="text-ink-3"> · Check it before you schedule this post.</span>}
        </p>
      )}
      {p.error && <p role="alert" className="rounded-xl bg-bad-soft p-2.5 text-xs text-red-800">{p.error}</p>}

      {!editing && (
        <footer className="flex flex-wrap items-center gap-4 text-sm">
          {editable && <button onClick={() => setEditing(true)} className="font-semibold text-brand">Edit</button>}
          {editable && p.mode !== "now" && (
            <button
              disabled={act.pending}
              onClick={() => confirm("Publish this post to the live account right now?") && act.run(() => updateTextPost(p.id, { text: p.caption ?? "", thread: p.thread, mode: "now" }), () => router.refresh())}
              className="font-semibold text-brand"
            >
              Publish now
            </button>
          )}
          {(p.status === "draft" || p.status === "scheduled") && !p.postId && <CancelPublishButton jobId={p.id} />}
          {open && (open.startsWith("/") ? <Link href={open} className="ml-auto font-semibold text-brand">Open</Link> : <a href={open} target="_blank" rel="noreferrer" className="ml-auto font-semibold text-brand">View post</a>)}
          <ErrorText error={act.error} />
        </footer>
      )}
    </article>
  );
}

const TABS = [["all", "All"], ["draft", "Drafts"], ["scheduled", "Scheduled"], ["published", "Published"], ["failed", "Failed"]] as const;

const dayLabel = (d: Date | null, tz: string) =>
  d ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(d) : "No time set";
const timeLabel = (p: PostRow, tz: string) =>
  p.scheduledAt ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(p.scheduledAt) : p.mode === "queue" ? "Next slot" : "-";

/** One compact row; click opens the full card (edit, publish, cancel) in a dialog. */
function PostItem({ p, timezone }: { p: PostRow; timezone: string }) {
  const text = p.campaignId ? postText(p.caption, p.hashtags) : (p.caption ?? "");
  return (
    <Modal
      title={`@${p.handle.replace(/^@/, "")} · ${p.platform === "twitter" ? "X" : p.platform}`}
      label="Open post"
      className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-3 text-left transition hover:border-brand hover:bg-brand-soft"
      trigger={
        <>
          <span className="w-14 shrink-0 text-center text-sm font-bold tabular-nums text-ink-2">{timeLabel(p, timezone)}</span>
          <Avatar url={p.avatarUrl} handle={p.handle} platform={p.platform} />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-sm">{text || "(no text)"}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
              <span>@{p.handle.replace(/^@/, "")}</span>
              {p.thread.length > 0 && <span>· +{p.thread.length} part{p.thread.length === 1 ? "" : "s"}</span>}
              {p.campaignId && <span>· Video</span>}
              {p.error && <span className="text-red-700">· error</span>}
            </span>
          </span>
          <span className={`pill !px-2.5 !py-0.5 ${STATUS_PILL[p.status] ?? "border-line bg-white text-ink-2"}`}>{p.status}</span>
          <span aria-hidden className="material-symbols-outlined text-ink-3">chevron_right</span>
        </>
      }
    >
      <PostCard p={p} timezone={timezone} />
    </Modal>
  );
}

export function PostList({ posts, timezone, action }: { posts: PostRow[]; timezone: string; action?: ReactNode }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("all");
  const shown = posts.filter((p) => tab === "all" || p.status === tab || (tab === "scheduled" && p.status === "publishing"));
  const days: { label: string; rows: PostRow[] }[] = [];
  for (const p of shown) {
    const label = dayLabel(p.scheduledAt, timezone);
    if (days.at(-1)?.label === label) days.at(-1)!.rows.push(p);
    else days.push({ label, rows: [p] });
  }
  return (
    <section aria-label="Posts" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex flex-wrap gap-1 rounded-full bg-canvas p-1">
          {TABS.map(([k, label]) => {
            const n = k === "all" ? posts.length : posts.filter((p) => p.status === k).length;
            return (
              <button
                key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${tab === k ? "bg-white text-brand shadow-sm" : "text-ink-2 hover:text-ink"}`}
              >
                {label} <span className="text-ink-3">{n}</span>
              </button>
            );
          })}
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {days.length ? (
        <div className="space-y-5">
          {days.map((d) => (
            <div key={d.label} className="space-y-2">
              <h3 className="label !mb-0">{d.label}</h3>
              <ul className="space-y-2">{d.rows.map((p) => <li key={p.id}><PostItem p={p} timezone={timezone} /></li>)}</ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl bg-canvas p-5 text-sm text-ink-2">Nothing here yet.</p>
      )}
    </section>
  );
}
