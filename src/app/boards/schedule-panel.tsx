"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { buildScheduleSlots, charCount, CHAR_LIMIT, fmtZoned, slotCount, textProblem } from "@/lib/publish";
import { useAction, ErrorText } from "../ui";
import { applySchedule, pushDrafts, regeneratePost, setPostDecision } from "./actions";

type Review = "approved" | "needs_review" | "rejected";
type Confidence = "high" | "medium" | "low";
type VariantView = { text: string; thread: string[]; status?: Review; reasons: string[]; sourceNote?: string | null; confidence?: Confidence | null };
const CONFIDENCE_PILL: Record<Confidence, string> = {
  high: "border-emerald-200 bg-ok-soft text-emerald-800",
  medium: "border-amber-200 bg-amber-soft text-amber-800",
  low: "border-red-200 bg-bad-soft text-red-800",
};
/** A generated post: its content type and check result, plus the other usable variants (content pipeline). */
export type SchedulePost = VariantView & { type?: string | null; alternatives: VariantView[]; cta?: string | null; decision?: Decision | null };
type Decision = "approved" | "rejected";
/** The brief controls the cards show. */
export type ScheduleBrief = { platforms: string[]; length?: string; mediaType?: string; linkUrl?: string; imageNote?: string };
const MEDIA_ICON: Record<string, string> = { image: "image", video: "videocam", link: "link" };
const platformName = (p: string) => (p === "twitter" ? "X" : p === "threads" ? "Threads" : p);
const REVIEW_PILL: Record<Review, string> = {
  approved: "border-emerald-200 bg-ok-soft text-emerald-800",
  needs_review: "border-amber-200 bg-amber-soft text-amber-800",
  rejected: "border-red-200 bg-bad-soft text-red-800",
};
export type ScheduleChannel = { id: string; platform: string; handle: string };
export type ScheduleJob = {
  id: string; platform: string; handle: string; status: string; mode: string; scheduledAt: Date | null;
  postId: string | null; permalink: string | null; error: string | null; caption: string | null; thread: string[];
};

const STATUS_PILL: Record<string, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-700",
  scheduled: "border-blue-200 bg-brand-soft text-brand-dark",
  publishing: "border-amber-200 bg-amber-soft text-amber-800",
  published: "border-emerald-200 bg-ok-soft text-emerald-800",
  failed: "border-red-200 bg-bad-soft text-red-800",
};
const today = () => new Date().toISOString().slice(0, 10);

/**
 * "Schedule" panel on a Socmed Specialist result: a date range and the publish times per day are laid into slots by
 * buildScheduleSlots (deterministic, no AI), the table below is editable and rows can be swapped, and the two
 * buttons are deliberately separate so nothing reaches a live account without a second confirmation.
 */
export function SchedulePanel({ taskId, posts: initial, brief, skipped = [], channels, timezone, jobs }: {
  taskId: string; posts: SchedulePost[]; brief: ScheduleBrief; skipped?: { type: string; reason: string }[]; channels: ScheduleChannel[]; timezone: string; jobs: ScheduleJob[];
}) {
  const router = useRouter();
  const push = useAction();
  const apply = useAction();
  // Local copy: Regenerate and Approve / Reject update one card without reloading the page.
  const [posts, setPosts] = useState(initial);

  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [timesText, setTimesText] = useState("09:00, 19:00");
  const [tz, setTz] = useState(timezone);
  const [picked, setPicked] = useState<string[]>(channels.slice(0, 1).map((c) => c.id));
  // Editable copies of the generated posts, plus which draft sits in which slot (swapping reorders this).
  // variant 0 = the post, k = alternatives[k-1]. Rejected posts leave the slots.
  const [drafts, setDrafts] = useState(posts.map((p) => ({ text: p.text, thread: p.thread, variant: 0 })));
  const variantsOf = (i: number): VariantView[] => [posts[i], ...posts[i].alternatives];
  const [allOrder, setOrder] = useState(posts.map((_, i) => i));
  const order = allOrder.filter((i) => posts[i].decision !== "rejected");
  const rejected = posts.flatMap((p, i) => (p.decision === "rejected" ? [i] : []));

  const timeSlots = useMemo(() => timesText.split(",").map((t) => t.trim()).filter(Boolean), [timesText]);
  const grid = { startDate, endDate, timeSlots };
  const total = slotCount(grid);

  const { slots, gridError } = useMemo(() => {
    try {
      return { slots: buildScheduleSlots({ ...grid, timezone: tz, drafts: order.map((i) => ({ id: String(i) })) }), gridError: null as string | null };
    } catch (e) {
      return { slots: [], gridError: e instanceof Error ? e.message : String(e) };
    }
  }, [startDate, endDate, timesText, tz, order.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const services = channels.filter((c) => picked.includes(c.id)).map((c) => c.platform);
  const problem = (text: string) => services.map((s) => textProblem(s, text)).find(Boolean) ?? null;
  /** Counters follow the picked channels, or the brief's platforms before any is picked. */
  const counted = [...new Set(services.length ? services : brief.platforms)];

  const items = slots.map((s) => {
    const d = drafts[Number(s.draftId)];
    return { text: d.text, thread: d.thread, dueAtUtc: s.dueAtUtc, slot: Number(s.draftId), variant: d.variant };
  });
  const unapproved = items.filter((i) => posts[i.slot].decision !== "approved").length;
  const blocked = items.flatMap((i) => [i.text, ...i.thread]).map(problem).find(Boolean) ?? null;
  const unscheduled = Math.max(0, order.length - slots.length);

  const setDraft = (draftIdx: number, patch: Partial<(typeof drafts)[number]>) => setDrafts((d) => d.map((x, i) => (i === draftIdx ? { ...x, ...patch } : x)));
  const pickVariant = (draftIdx: number, variant: number) => {
    const v = variantsOf(draftIdx)[variant];
    setDraft(draftIdx, { text: v.text, thread: v.thread, variant });
  };
  const setPost = (i: number, p: SchedulePost) => setPosts((ps) => ps.map((x, k) => (k === i ? p : x)));
  const decide = async (i: number, decision: Decision | null) => {
    await setPostDecision(taskId, i, decision);
    setPost(i, { ...posts[i], decision });
  };
  const regenerate = async (i: number) => {
    const p = await regeneratePost(taskId, i);
    setPost(i, p);
    setDraft(i, { text: p.text, thread: p.thread, variant: 0 });
  };
  /** Swap which draft fills this slot with whichever slot currently holds the chosen one. */
  const swap = (slotIdx: number, draftIdx: number) =>
    setOrder((o) => {
      const a = o.indexOf(order[slotIdx]);
      const b = o.indexOf(draftIdx);
      if (a < 0 || b < 0 || a === b) return o;
      const next = [...o];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });

  const sent = jobs.filter((j) => j.postId).length;
  const toSchedule = jobs.filter((j) => j.postId && j.mode === "draft").length;

  return (
    <section aria-label="Schedule" className="space-y-8">
      <Step n={1} title="When" hint={`${drafts.length} generated post${drafts.length === 1 ? "" : "s"} fill the slots below in order.`}>
        <div className="grid gap-3 sm:grid-cols-2 ">
          <label className="block"><span className="label">From</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
          </label>
          <label className="block"><span className="label">To</span>
            <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="input" />
          </label>
          <label className="block"><span className="label">Times each day</span>
            <input value={timesText} onChange={(e) => setTimesText(e.target.value)} placeholder="09:00, 19:00" className="input" />
          </label>
          <label className="block"><span className="label">Time zone</span>
            <select value={tz} onChange={(e) => setTz(e.target.value)} className="input">
              {[...new Set([timezone, tz, "Asia/Jakarta", "Asia/Bangkok", "UTC"])].map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
        </div>
      </Step>

      <Step n={2} title="Channels">
        {!channels.length ? (
          <p className="text-sm text-ink-3">No X or Threads channel is enabled. Connect one in Buffer, then sync it under Connections.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {channels.map((c) => (
              <label key={c.id} className="pill cursor-pointer border-line bg-white px-3.5 py-2 text-ink-2 has-checked:border-brand has-checked:bg-brand-soft has-checked:text-brand">
                <input
                  type="checkbox" className="sr-only" checked={picked.includes(c.id)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))}
                />
                {c.platform} @{c.handle}
              </label>
            ))}
          </div>
        )}
      </Step>

      <Step n={3} title={`Posts (${slots.length})`} hint="Approve each post you want to send. Edit, regenerate or reject the rest.">
        {gridError && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-red-800">{gridError}</p>}
        {!gridError && unscheduled > 0 && (
          <p role="status" className="rounded-xl bg-amber-soft p-3 text-sm text-amber-900">
            {total} slot{total === 1 ? "" : "s"} for {order.length} posts: the last {unscheduled} would not be scheduled. Widen the date range or add a time.
          </p>
        )}
        {skipped.length > 0 && (
          <p role="status" className="rounded-xl bg-amber-soft p-3 text-sm text-amber-900">
            {skipped.length} post{skipped.length === 1 ? " was" : "s were"} not usable: {skipped.map((s) => `${s.type}: ${s.reason}`).join(" · ")}
          </p>
        )}
        {unapproved > 0 && <p role="status" className="rounded-xl bg-amber-soft p-3 text-sm text-amber-900">{unapproved} post{unapproved === 1 ? " is" : "s are"} not approved yet. Approve or reject each one before sending.</p>}
        {blocked && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-red-800">{blocked}. Shorten it before sending.</p>}
        <ul className="space-y-3">
          {slots.map((s, n) => {
            const i = Number(s.draftId);
            return (
              <li key={i}>
                <PostCard
                  n={i + 1} when={fmtZoned(new Date(s.dueAtUtc), tz)} post={posts[i]} draft={drafts[i]} variants={variantsOf(i)} brief={brief} platforms={counted} problem={problem}
                  slotPicker={
                    <select aria-label="Post in this slot" value={i} onChange={(e) => swap(n, Number(e.target.value))} className="input w-auto py-1 text-xs">
                      {order.map((k) => <option key={k} value={k}>Post {k + 1}</option>)}
                    </select>
                  }
                  onVariant={(x) => pickVariant(i, x)} onEdit={(patch) => setDraft(i, patch)}
                  onDecide={(d) => decide(i, d)} onRegenerate={() => regenerate(i)}
                />
              </li>
            );
          })}
        </ul>
        {rejected.length > 0 && (
          <details className="rounded-2xl bg-canvas p-3 text-sm">
            <summary className="cursor-pointer font-semibold text-ink-2">Rejected ({rejected.length})</summary>
            <ul className="mt-2 space-y-2">
              {rejected.map((i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="line-clamp-1 min-w-0 flex-1 text-ink-3">Post {i + 1}: {drafts[i].text}</span>
                  <RestoreButton onRestore={() => decide(i, null)} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </Step>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white p-3 shadow-float">
        <button
          disabled={push.pending || !!gridError || !!blocked || !!unapproved || !slots.length || !picked.length}
          onClick={() => push.run(() => pushDrafts(taskId, { accountIds: picked, items }), () => router.refresh())}
          className="btn-primary"
        >
          <span className="material-symbols-outlined">drafts</span>
          {push.pending ? "Sending…" : "Send to Buffer as drafts"}
        </button>
        <button
          disabled={apply.pending || !toSchedule}
          onClick={() => apply.run(() => applySchedule(taskId), () => router.refresh())}
          className="btn-soft"
          title={toSchedule ? undefined : "Send the drafts first"}
        >
          <span className="material-symbols-outlined">schedule_send</span>
          {apply.pending ? "Scheduling…" : `Schedule${toSchedule ? ` ${toSchedule} draft${toSchedule === 1 ? "" : "s"}` : ""}`}
        </button>
        <p className="min-w-48 flex-1 text-xs text-ink-2">Drafts never publish on their own. Scheduling is the second, explicit step.</p>
        <ErrorText error={push.error ?? apply.error} />
      </div>

      {jobs.length > 0 && (
        <Step n={4} title={`In Buffer (${sent} of ${jobs.length} sent)`}>
          <ul className="space-y-2">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-canvas p-3 text-sm">
                <span className="w-28 shrink-0 text-xs font-semibold text-ink-2">{j.scheduledAt ? fmtZoned(j.scheduledAt, tz) : "No time"}</span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1">{j.caption || "(no text)"}</span>
                  <span className="text-xs text-ink-3">{j.platform} @{j.handle}{j.mode === "draft" && j.postId ? " · not scheduled yet" : ""}</span>
                  {j.error && <span className="block text-xs text-red-700">{j.error}</span>}
                </span>
                <span className={`pill !px-2.5 !py-0.5 ${STATUS_PILL[j.status] ?? "border-line bg-white text-ink-2"}`}>{j.status}</span>
                {j.permalink && <a href={j.permalink} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand">Open</a>}
              </li>
            ))}
          </ul>
        </Step>
      )}
    </section>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="flex items-center gap-2 font-bold">
          <span className="flex size-6 items-center justify-center rounded-full bg-brand text-xs text-white">{n}</span>{title}
        </h3>
        {hint && <p className="mt-0.5 text-sm text-ink-2">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

type DraftView = { text: string; thread: string[]; variant: number };

/** One generated post: text, badges, live counters, the variant and its check reasons, and the owner's actions. */
function PostCard({ n, when, post, draft, variants, brief, platforms, problem, slotPicker, onVariant, onEdit, onDecide, onRegenerate }: {
  n: number; when: string; post: SchedulePost; draft: DraftView; variants: VariantView[]; brief: ScheduleBrief; platforms: string[];
  problem: (t: string) => string | null; slotPicker: ReactNode;
  onVariant: (v: number) => void; onEdit: (patch: Partial<DraftView>) => void;
  onDecide: (d: Decision | null) => Promise<void>; onRegenerate: () => Promise<void>;
}) {
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const approved = post.decision === "approved";
  const media = brief.imageNote ? "image" : brief.mediaType && brief.mediaType !== "text_only" ? brief.mediaType : null;
  const counter = (t: string) => (
    <p className={`mt-1 text-xs tabular-nums ${problem(t) ? "text-red-700" : "text-ink-3"}`}>
      {platforms.map((p) => `${charCount(p, t)} / ${CHAR_LIMIT[p] ?? "∞"}${platforms.length > 1 ? ` ${platformName(p)}` : ""}`).join(" · ")}
      {problem(t) ? ` · ${problem(t)}` : ""}
    </p>
  );
  const pill = "pill !px-2 !py-0.5 !text-[11px] border-line bg-canvas text-ink-2";

  return (
    <article className={`space-y-3 rounded-2xl border bg-white p-4 ${approved ? "border-emerald-300" : "border-line"}`}>
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-bold text-ink">Post {n}</span>
        <span className="text-ink-2">{when}</span>
        <span className="ml-auto">{slotPicker}</span>
      </header>
      <div className="flex flex-wrap items-center gap-1">
        {brief.platforms.map((p) => <span key={p} className={pill}>{platformName(p)}</span>)}
        {post.type && <span className={pill}>{post.type.replaceAll("_", " ")}</span>}
        <span className={pill}>{brief.length ?? "auto"} length</span>
        {post.cta && <span className={pill}>CTA: {post.cta.replaceAll("_", " ")}</span>}
        {media && <span className={pill}><span aria-hidden className="material-symbols-outlined !text-[14px]">{MEDIA_ICON[media]}</span>{media}</span>}
        {approved && <span className="pill !px-2 !py-0.5 !text-[11px] border-emerald-200 bg-ok-soft text-emerald-800">approved by you</span>}
      </div>

      {editing ? (
        <div className="space-y-2">
          <label className="block"><span className="label">{draft.thread.length ? "Part 1" : "Text"}</span>
            <textarea value={draft.text} onChange={(e) => onEdit({ text: e.target.value })} rows={5} className="input" />
            {counter(draft.text)}
          </label>
          {draft.thread.map((t, k) => (
            <label key={k} className="block"><span className="label">Part {k + 2}</span>
              <textarea value={t} onChange={(e) => onEdit({ thread: draft.thread.map((x, j) => (j === k ? e.target.value : x)) })} rows={3} className="input" />
              {counter(t)}
            </label>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <p className="whitespace-pre-wrap text-sm">{draft.text || <span className="text-ink-3">(empty)</span>}</p>
            {counter(draft.text)}
          </div>
          {draft.thread.length > 0 && (
            <ol className="space-y-2 border-l-2 border-line pl-3">
              {draft.thread.map((t, k) => (
                <li key={k} className="text-sm"><span className="mr-1 text-xs font-bold text-ink-3">{k + 2}.</span><span className="whitespace-pre-wrap">{t}</span>{counter(t)}</li>
              ))}
            </ol>
          )}
        </div>
      )}

      <ReviewCell variants={variants} variant={draft.variant} onVariant={onVariant} />

      <footer className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
        <button disabled={act.pending} onClick={() => act.run(async () => { await onRegenerate(); setEditing(false); })} className="btn-soft !px-3 !py-1.5">
          <span className="material-symbols-outlined !text-[18px]">refresh</span>{act.pending ? "Working…" : "Regenerate"}
        </button>
        <button onClick={() => setEditing(!editing)} className="btn-soft !px-3 !py-1.5">
          <span className="material-symbols-outlined !text-[18px]">{editing ? "check" : "edit"}</span>{editing ? "Done" : "Edit"}
        </button>
        <button
          disabled={act.pending} onClick={() => act.run(() => onDecide(approved ? null : "approved"))}
          className={approved ? "btn-soft !px-3 !py-1.5" : "btn-primary !px-3 !py-1.5"}
        >
          <span className="material-symbols-outlined !text-[18px]">{approved ? "undo" : "task_alt"}</span>{approved ? "Unapprove" : "Approve"}
        </button>
        <button disabled={act.pending} onClick={() => act.run(() => onDecide("rejected"))} className="ml-auto px-2 font-semibold text-red-700">Reject</button>
        <ErrorText error={act.error} />
      </footer>
    </article>
  );
}

function RestoreButton({ onRestore }: { onRestore: () => Promise<void> }) {
  const act = useAction();
  return <button disabled={act.pending} onClick={() => act.run(onRestore)} className="font-semibold text-brand">{act.pending ? "…" : "Restore"}</button>;
}

/** Check result and reasons of the chosen variant, and the variant switch. */
function ReviewCell({ variants, variant, onVariant }: { variants: VariantView[]; variant: number; onVariant: (v: number) => void }) {
  const v = variants[variant];
  if (!v.status && variants.length < 2) return null;
  return (
    <div className="space-y-1 text-xs">
      {v.status && <span className={`pill ${REVIEW_PILL[v.status]}`}>checks: {v.status.replace("_", " ")}</span>}
      {variants.length > 1 && (
        <select aria-label="Variant" value={variant} onChange={(e) => onVariant(Number(e.target.value))} className="input py-1 text-xs">
          {variants.map((x, k) => <option key={k} value={k}>Variant {k + 1}{x.status ? ` (${x.status.replace("_", " ")})` : ""}</option>)}
        </select>
      )}
      {v.reasons.length > 0 && <ul className="list-disc pl-4 text-ink-2">{v.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {v.sourceNote && (
        <div className="rounded-lg bg-canvas p-2">
          <p className="flex flex-wrap items-center gap-1 font-semibold text-ink-2">
            Source named by the AI
            {v.confidence && <span className={`pill ${CONFIDENCE_PILL[v.confidence]}`}>{v.confidence} confidence</span>}
          </p>
          <p className="mt-0.5 text-ink-2">{v.sourceNote}</p>
          <p className="mt-0.5 text-ink-3">Not checked by us: look it up before you post.</p>
        </div>
      )}
    </div>
  );
}
