"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { buildScheduleSlots, charCount, CHAR_LIMIT, fmtZoned, slotCount, textProblem } from "@/lib/publish";
import { useAction, ErrorText } from "../ui";
import { applySchedule, pushDrafts } from "./actions";
import { Modal } from "./modal";

type Review = "approved" | "needs_review" | "rejected";
type Confidence = "high" | "medium" | "low";
type VariantView = { text: string; thread: string[]; status?: Review; reasons: string[]; sourceNote?: string | null; confidence?: Confidence | null };
const CONFIDENCE_PILL: Record<Confidence, string> = {
  high: "border-emerald-200 bg-ok-soft text-emerald-800",
  medium: "border-amber-200 bg-amber-soft text-amber-800",
  low: "border-red-200 bg-bad-soft text-red-800",
};
/** A generated post: its content type and check result, plus the other usable variants (content pipeline). */
export type SchedulePost = VariantView & { type?: string; alternatives: VariantView[] };
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
export function SchedulePanel({ taskId, posts, skipped = [], channels, timezone, jobs }: {
  taskId: string; posts: SchedulePost[]; skipped?: { type: string; reason: string }[]; channels: ScheduleChannel[]; timezone: string; jobs: ScheduleJob[];
}) {
  const router = useRouter();
  const push = useAction();
  const apply = useAction();

  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [timesText, setTimesText] = useState("09:00, 19:00");
  const [tz, setTz] = useState(timezone);
  const [picked, setPicked] = useState<string[]>(channels.slice(0, 1).map((c) => c.id));
  // Editable copies of the generated posts, plus which draft sits in which slot (swapping reorders this).
  // variant 0 = the post, k = alternatives[k-1]; reviewed = the owner ticked a needs_review post.
  const [drafts, setDrafts] = useState(posts.map((p) => ({ text: p.text, thread: p.thread, variant: 0, reviewed: false })));
  const variantsOf = (i: number): VariantView[] => [posts[i], ...posts[i].alternatives];
  const [order, setOrder] = useState(posts.map((_, i) => i));

  const timeSlots = useMemo(() => timesText.split(",").map((t) => t.trim()).filter(Boolean), [timesText]);
  const grid = { startDate, endDate, timeSlots };
  const total = slotCount(grid);

  const { slots, gridError } = useMemo(() => {
    try {
      return { slots: buildScheduleSlots({ ...grid, timezone: tz, drafts: order.map((i) => ({ id: String(i) })) }), gridError: null as string | null };
    } catch (e) {
      return { slots: [], gridError: e instanceof Error ? e.message : String(e) };
    }
  }, [startDate, endDate, timesText, tz, order]); // eslint-disable-line react-hooks/exhaustive-deps

  const services = channels.filter((c) => picked.includes(c.id)).map((c) => c.platform);
  /** The strictest budget among the picked channels: one text has to fit every one of them. */
  const limit = Math.min(...services.map((s) => CHAR_LIMIT[s] ?? Infinity));
  const problem = (text: string) => services.map((s) => textProblem(s, text)).find(Boolean) ?? null;

  const items = slots.map((s) => {
    const d = drafts[Number(s.draftId)];
    return { text: d.text, thread: d.thread, dueAtUtc: s.dueAtUtc, slot: Number(s.draftId), variant: d.variant, reviewed: d.reviewed };
  });
  const unreviewed = items.filter((i) => variantsOf(i.slot)[i.variant].status === "needs_review" && !i.reviewed).length;
  const blocked = items.flatMap((i) => [i.text, ...i.thread]).map(problem).find(Boolean) ?? null;
  const unscheduled = Math.max(0, drafts.length - slots.length);

  const edit = (draftIdx: number, text: string) => setDrafts((d) => d.map((x, i) => (i === draftIdx ? { ...x, text } : x)));
  const pickVariant = (draftIdx: number, variant: number) => {
    const v = variantsOf(draftIdx)[variant];
    setDrafts((d) => d.map((x, i) => (i === draftIdx ? { text: v.text, thread: v.thread, variant, reviewed: false } : x)));
  };
  const setReviewed = (draftIdx: number, reviewed: boolean) => setDrafts((d) => d.map((x, i) => (i === draftIdx ? { ...x, reviewed } : x)));
  /** Swap which draft fills this slot with whichever slot currently holds the chosen one. */
  const swap = (slotIdx: number, draftIdx: number) =>
    setOrder((o) => {
      const at = o.indexOf(draftIdx);
      if (at < 0 || at === slotIdx) return o;
      const next = [...o];
      [next[slotIdx], next[at]] = [next[at], next[slotIdx]];
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

      <Step n={3} title={`Posts (${slots.length})`} hint="Click a post to edit its text, swap it with another or pick a variant.">
        {gridError && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-red-800">{gridError}</p>}
        {!gridError && unscheduled > 0 && (
          <p role="status" className="rounded-xl bg-amber-soft p-3 text-sm text-amber-900">
            {total} slot{total === 1 ? "" : "s"} for {drafts.length} posts: the last {unscheduled} would not be scheduled. Widen the date range or add a time.
          </p>
        )}
        {skipped.length > 0 && (
          <p role="status" className="rounded-xl bg-amber-soft p-3 text-sm text-amber-900">
            {skipped.length} post{skipped.length === 1 ? " was" : "s were"} not usable: {skipped.map((s) => `${s.type}: ${s.reason}`).join(" · ")}
          </p>
        )}
        {unreviewed > 0 && <p role="status" className="rounded-xl bg-amber-soft p-3 text-sm text-amber-900">{unreviewed} post{unreviewed === 1 ? " needs" : "s need"} review: read the reasons, fix or swap the text, then tick Reviewed.</p>}
        {blocked && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-red-800">{blocked}. Shorten it before sending.</p>}
        <ul className="space-y-2">
          {slots.map((s, n) => {
            const i = Number(s.draftId);
            const d = drafts[i];
            const bad = problem(d.text);
            const n16 = services.length ? charCount(services[0], d.text) : d.text.length;
            const v = variantsOf(i)[d.variant];
            const when = fmtZoned(new Date(s.dueAtUtc), tz);
            return (
              <li key={n}>
                <Modal
                  title={`Post ${i + 1} · ${when}`}
                  label={`Open post ${i + 1}`}
                  className="flex w-full items-center gap-3 rounded-2xl bg-canvas p-3 text-left hover:bg-brand-soft"
                  trigger={
                    <>
                      <span className="w-28 shrink-0 text-xs font-semibold text-ink-2">{when}</span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm">{d.text || "(empty)"}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                          <span>Post {i + 1}</span>
                          {d.thread.length > 0 && <span>· +{d.thread.length} part{d.thread.length === 1 ? "" : "s"}</span>}
                          {v.status && <span className={`pill !px-2 !py-0 !text-[10px] ${REVIEW_PILL[v.status]}`}>{v.status.replace("_", " ")}</span>}
                          {bad && <span className="text-red-700">· {bad}</span>}
                        </span>
                      </span>
                      <span aria-hidden className="material-symbols-outlined text-ink-3">chevron_right</span>
                    </>
                  }
                >
                  <label className="block"><span className="label">Post in this slot</span>
                    <select value={i} onChange={(e) => swap(n, Number(e.target.value))} className="input">
                      {drafts.map((_, k) => <option key={k} value={k}>Post {k + 1}</option>)}
                    </select>
                  </label>
                  <ReviewCell
                    type={posts[i].type} variants={variantsOf(i)} variant={d.variant} reviewed={d.reviewed}
                    onVariant={(x) => pickVariant(i, x)} onReviewed={(r) => setReviewed(i, r)}
                  />
                  <label className="block"><span className="label">Text</span>
                    <textarea value={d.text} onChange={(e) => edit(i, e.target.value)} rows={6} className="input" />
                    <span className={`text-xs ${bad ? "text-red-700" : "text-ink-3"}`}>
                      {n16}{Number.isFinite(limit) ? ` / ${limit}` : ""} {bad ?? ""}
                    </span>
                  </label>
                  {d.thread.map((t, k) => (
                    <p key={k} className="text-sm text-ink-2">
                      <span className="text-ink-3">part {k + 2}:</span> {t}
                      {problem(t) && <span className="text-red-700"> — {problem(t)}</span>}
                    </p>
                  ))}
                </Modal>
              </li>
            );
          })}
        </ul>
      </Step>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white p-3 shadow-float">
        <button
          disabled={push.pending || !!gridError || !!blocked || !!unreviewed || !slots.length || !picked.length}
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

/** Content type, check result and reasons of the chosen variant, the variant switch and the Reviewed tick. */
function ReviewCell({ type, variants, variant, reviewed, onVariant, onReviewed }: {
  type?: string; variants: VariantView[]; variant: number; reviewed: boolean; onVariant: (v: number) => void; onReviewed: (r: boolean) => void;
}) {
  const v = variants[variant];
  if (!type && !v.status) return null;
  return (
    <div className="mt-2 space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        {type && <span className="pill border-line bg-canvas">{type.replaceAll("_", " ")}</span>}
        {v.status && <span className={`pill ${REVIEW_PILL[v.status]}`}>{v.status.replace("_", " ")}</span>}
      </div>
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
      {v.status === "needs_review" && (
        <label className="flex items-center gap-1 font-semibold">
          <input type="checkbox" checked={reviewed} onChange={(e) => onReviewed(e.target.checked)} />Reviewed
        </label>
      )}
    </div>
  );
}
