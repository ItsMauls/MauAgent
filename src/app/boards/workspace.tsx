import { Fragment } from "react";
import Link from "next/link";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { likePattern, workedOn } from "@/lib/boards/archive";
import { OUTCOME, outcomeLabel } from "@/lib/boards/outcome";
import { FeedbackForm, FeedbackList } from "./feedback";
import { roleByAgent, type BoardRole } from "@/lib/boards/roles";
import { TASKS } from "@/lib/boards/tasks";
import { taskTitle } from "@/lib/boards/status";
import { formatDuration } from "@/lib/status";
import { AssetsTab, ChangedKeys, Empty, ShotsTab } from "../campaigns/[id]/shots";
import { AutoRefresh, PublishForm } from "../ui";
import { TEXT_PLATFORMS } from "@/lib/publish";
import { targetAccounts, targetOptions } from "@/lib/publishPlan";
import { SocialPosts } from "@/lib/agents/schemas";
import { SchedulePanel } from "./schedule-panel";
import { PostList } from "./posts";
import { Modal } from "./modal";
import { OutputView } from "./outputs";
import { Conversation, GenerationInfo } from "./conversation";
import { agentNames } from "@/lib/boards/snapshot";
import { PostPreview } from "./post-preview";
import { TextBrief } from "../brief/text-brief";
import { editMemory, pinMemory, removeMemory, sendTaskToFlow } from "./actions";
import { DeleteBatchButton, RetryButton, type Option } from "./task-form";
import { RoleAvatar } from "./cards";
import { taskHref } from "@/lib/boards/flows";

export const product = (b: unknown) => (b as { product?: string } | null)?.product;
/** A readable name for an artifact: its campaign product, else what the direct task was asked (product, topic or goal). */
export const artifactTitle = (a: { agentRole: string; campaign: { clientBrief: unknown } | null }, input?: unknown) => {
  const i = (input ?? {}) as Record<string, unknown>;
  const t = [product(a.campaign?.clientBrief), i.product, i.topic, i.objective].find((x): x is string => typeof x === "string" && !!x.trim());
  return t ? (t.length > 60 ? `${t.slice(0, 57)}…` : t) : `${roleByAgent(a.agentRole)?.label ?? a.agentRole} output`;
};
export const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const TASK_PILL: Record<string, string> = {
  QUEUED: "border-slate-200 bg-slate-50 text-slate-700",
  RUNNING: "border-blue-200 bg-brand-soft text-brand-dark",
  WAITING: "border-amber-200 bg-amber-soft text-amber-800",
  DONE: "border-emerald-200 bg-ok-soft text-emerald-800",
  FAILED: "border-red-200 bg-bad-soft text-red-800",
};

const TASK_ICON: Record<string, [string, string]> = {
  QUEUED: ["schedule", "bg-slate-100 text-slate-600"],
  RUNNING: ["progress_activity", "bg-brand-soft text-brand-dark"],
  WAITING: ["hourglass_top", "bg-amber-soft text-amber-800"],
  DONE: ["check_circle", "bg-ok-soft text-emerald-700"],
  FAILED: ["error", "bg-bad-soft text-red-700"],
};

/** Label for an artifact in pickers and lists: its campaign, or "Direct task". */
export const artifactLabel = (a: { agentRole: string; version: number; createdAt: Date; campaign: { clientBrief: unknown } | null }) =>
  `${product(a.campaign?.clientBrief) ?? "Direct task"} · ${roleByAgent(a.agentRole)?.label ?? a.agentRole} v${a.version} · ${when(a.createdAt)}`;

// ---------- Task forms (used by the multi-agent features) ----------

/** Picker options for an artifact field (`ref: role`) or a campaign field (`ref: "campaign"`, campaigns with a shot list). */
export async function refOptions(r: string): Promise<Option[]> {
  return r === "campaign"
    ? (await db.campaign.findMany({
        where: { artifacts: { some: { agentRole: "artDirector" } } }, orderBy: { createdAt: "desc" }, take: 25,
        select: { id: true, status: true, clientBrief: true },
      })).map((c) => ({ id: c.id, label: `${product(c.clientBrief) ?? c.id} · ${c.status.toLowerCase().replace(/_/g, " ")}` }))
    : (await db.artifact.findMany({
        where: { agentRole: r }, orderBy: { createdAt: "desc" }, take: 25,
        select: { id: true, agentRole: true, version: true, createdAt: true, campaign: { select: { clientBrief: true } } },
      })).map((a) => ({ id: a.id, label: artifactLabel(a) }));
}

/** What TaskForm needs for a role: its input schema as JSON and the options of its pickers. */
export async function taskFormProps(agentRole: string) {
  const def = TASKS[agentRole];
  // Round-tripped through JSON so the client component only ever receives plain objects (React refuses anything else).
  const schema = JSON.parse(JSON.stringify(z.toJSONSchema(def.input, { io: "input" }))) as { properties: Record<string, { ref?: string; library?: string }>; required?: string[] };
  const fields = Object.values(schema.properties);
  const refRoles = [...new Set(fields.map((p) => p.ref).filter((r): r is string => !!r))];
  const kinds = [...new Set(fields.map((p) => p.library).filter((k): k is string => !!k))];
  const [refRows, libRows] = await Promise.all([
    Promise.all(refRoles.map(refOptions)),
    kinds.length ? db.creativeAsset.findMany({ where: { kind: { in: kinds as ("character" | "location" | "style")[] } }, orderBy: { name: "asc" }, select: { id: true, kind: true, name: true } }) : [],
  ]);
  const refs: Record<string, Option[]> = Object.fromEntries(refRoles.map((r, i) => [r, refRows[i]]));
  const library: Record<string, Option[]> = Object.fromEntries(kinds.map((k) => [k, libRows.filter((a) => a.kind === k).map((a) => ({ id: a.id, label: a.name }))]));
  return { schema, refs, library, llm: def.llm };
}

// ---------- Text posts (Socmed Specialist writes, QC checks) ----------

const PLATFORM_LABEL: Record<string, string> = { twitter: "X", x: "X", threads: "Threads" };
const busy = (status: string) => status === "QUEUED" || status === "RUNNING";

/** Photo ring by state: green = generated, blue + flicker = being worked on, yellow = waiting for a review. */
const RING_STATE = { done: "ring-emerald-500", working: "flicker ring-brand", review: "ring-amber-400", idle: "ring-line" } as const;
type Ring = keyof typeof RING_STATE;
/** The arrow between two people takes the state of the one it leaves: what they hand over is done, being worked on, or waiting for review. */
const ARROW_STATE = {
  done: ["bg-emerald-500", "text-emerald-500"], working: ["flicker bg-brand", "text-brand"], review: ["bg-amber-400", "text-amber-500"], idle: ["bg-line", "text-ink-3"],
} as const;

/**
 * Who handles text posts, as o --- o --- o: photo circles joined by a line, name, role and what they did under each.
 * The ring follows the batch being looked at (or blue while any batch is being worked on).
 */
function TeamStrip({ working, posts, names }: { working: boolean; posts?: SocialPosts; names: Record<string, string> }) {
  const n = (f: (p: SocialPosts["posts"][number]) => boolean) => posts?.posts.filter(f).length ?? 0;
  const toReview = n((p) => p.status === "needs_review" && !p.decision); // QC still has posts you must look at
  const undecided = n((p) => p.status !== "rejected" && !p.decision); // you still have posts to approve or reject
  const done = (pending: number): Ring => (working ? "working" : !posts ? "idle" : pending ? "review" : "done");
  const members: { role: string; name?: string; label: string; about: string; text: string; ring: Ring }[] = [
    { role: "socmedSpecialist", name: names.socmedSpecialist, label: "Socmed Specialist", ring: done(0), about: "Writes 3 variants per post in your voice", text: working ? "Working…" : posts ? `Wrote ${posts.posts.length} post${posts.posts.length === 1 ? "" : "s"}${posts.skipped.length ? `, skipped ${posts.skipped.length}` : ""}` : "Idle" },
    { role: "accountTeam", name: names.accountTeam, label: "QC", ring: done(toReview), about: "Runs the rule checks, then the quality judge", text: working ? "Working…" : posts ? `${n((p) => p.status === "approved")} passed, ${n((p) => p.status === "needs_review")} need review` : "Idle" },
    { role: "", name: "You", label: "Owner", ring: working ? "idle" : done(undecided), about: "Approves or rejects each post, then schedules", text: working ? "Waiting" : posts ? `${n((p) => p.decision === "approved")} approved, ${n((p) => p.decision === "rejected")} rejected` : "Idle" },
  ];
  return (
    <div className="space-y-1">
      <ol aria-label="Who handles text posts" className="flex items-start rounded-2xl bg-canvas px-3 py-3">
        {members.map((m, k) => (
          <Fragment key={m.label}>
            {k > 0 && (
              <li aria-hidden className="mt-[13px] flex min-w-6 flex-1 items-center">
                <span className={`h-0.5 flex-1 rounded-full ${ARROW_STATE[members[k - 1].ring][0]}`} />
                <span className={`material-symbols-outlined -ml-2 !text-[18px] ${ARROW_STATE[members[k - 1].ring][1]}`}>chevron_right</span>
              </li>
            )}
            <li className="w-28 shrink-0 sm:w-40">
             <span tabIndex={0} aria-label={`${m.name ?? m.label}, ${m.label}: ${m.about}`} className="group relative flex flex-col items-center gap-0.5 text-center outline-none">
              {m.role ? (
                <RoleAvatar role={m.role} className={`h-11 w-11 ring-2 ring-offset-2 ring-offset-canvas ${RING_STATE[m.ring]}`} />
              ) : (
                <span className={`flex h-11 w-11 items-center justify-center rounded-full bg-white text-ink-2 ring-2 ring-offset-2 ring-offset-canvas ${RING_STATE[m.ring]}`}><span className="material-symbols-outlined !text-[22px]">person</span></span>
              )}
              <span className="mt-1 w-full truncate text-xs font-bold">{m.name ?? m.label}</span>
              <span className="text-[11px] font-semibold text-brand">{m.label}</span>
              <span className="text-[11px] leading-tight text-ink-2">{m.text}</span>
              <span role="tooltip" className="pointer-events-none absolute -top-9 left-1/2 z-10 hidden w-max max-w-56 -translate-x-1/2 rounded-xl bg-ink px-3 py-1.5 text-xs font-semibold text-white group-hover:block group-focus-visible:block">{m.about}</span>
             </span>
            </li>
          </Fragment>
        ))}
      </ol>
      <p className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 px-1 text-[11px] text-ink-2">
        Photo border:
        <span><span className="text-emerald-600">●</span> done</span>
        <span><span className="text-brand">●</span> working</span>
        <span><span className="text-amber-500">●</span> needs a review</span>
      </p>
    </div>
  );
}

/** Batches on the left, the picked one (or the latest) on the right. `href` links a batch in the current place. */
export async function TextPosts({ taskId, href }: { taskId?: string; href: (taskId: string) => string }) {
  const [tasks, picked] = await Promise.all([
    db.agentTask.findMany({ where: { agentRole: "socmedSpecialist" }, orderBy: { createdAt: "desc" }, take: 20 }),
    taskId ? db.agentTask.findUnique({ where: { id: taskId } }) : null,
  ]);
  // Nothing picked: show the latest batch, so the panel is never empty when there is work.
  const selected = picked ?? (taskId ? null : tasks[0] ?? null);
  const working = tasks.some((t) => busy(t.status));
  const [names, shown] = await Promise.all([agentNames(), selected?.artifactId ? db.artifact.findUnique({ where: { id: selected.artifactId }, select: { payload: true } }) : null]);
  const posts = shown ? SocialPosts.safeParse(shown.payload).data : undefined;

  return (
    <div className="space-y-6">
      {working && <AutoRefresh seconds={4} quiet />}
      <TeamStrip working={working} posts={posts} names={names} />
      <div className="grid gap-6 lg:grid-cols-12">
        <section aria-labelledby="batches-h" className="flex min-h-0 flex-col gap-3 lg:col-span-5">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <h2 id="batches-h" className="text-lg font-bold">Batches <span className="text-sm font-normal text-ink-3">{tasks.length}</span></h2>
            <Modal title="New text posts" className="btn-primary" trigger={<><span className="material-symbols-outlined">add</span>New posts</>}>
              <TextBrief />
            </Modal>
          </div>
          {!tasks.length ? (
            <Empty icon="edit_note" text="No posts yet. Use New posts to write a batch." />
          ) : (
            <ul className="quiet-scroll -mr-2 max-h-[40rem] space-y-2 overflow-y-auto pr-2">
              {tasks.map((t) => {
                const [icon, tone] = TASK_ICON[t.status];
                const on = t.id === selected?.id;
                const i = (t.input ?? {}) as { platforms?: string[]; count?: number };
                return (
                  <li key={t.id} className={`relative rounded-2xl border bg-white text-sm shadow-sm transition ${on ? "border-brand ring-2 ring-brand/20" : "border-line hover:border-brand/50"}`}>
                    <Link href={href(t.id)} scroll={false} aria-current={on ? "true" : undefined} className="block space-y-2 p-3 pr-12">
                      <span className="flex items-start gap-3">
                        <span aria-hidden className={`flex size-9 shrink-0 items-center justify-center rounded-full ${tone}`}>
                          <span className={`material-symbols-outlined !text-[20px] ${t.status === "RUNNING" ? "animate-spin" : ""}`}>{icon}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 font-semibold leading-snug">{taskTitle(t.input)}</span>
                          <span className="mt-1 block text-xs text-ink-2">
                            {when(t.createdAt)}
                            {(t.status === "DONE" || t.status === "FAILED") && ` · ${formatDuration(t.updatedAt.getTime() - t.createdAt.getTime())}`}
                          </span>
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className={`pill !px-2 !py-0 !text-[10px] ${TASK_PILL[t.status]}`}>{t.status.toLowerCase()}</span>
                        {i.platforms?.map((p) => <span key={p} className="pill border-line bg-canvas !px-2 !py-0 !text-[10px] text-ink-2">{PLATFORM_LABEL[p] ?? p}</span>)}
                        {i.count && <span className="text-ink-2">{i.count} post{i.count === 1 ? "" : "s"}</span>}
                        <span className="ml-auto text-ink-2">US${Number(t.status === "DONE" ? t.costUsd : t.estUsd).toFixed(4)}{t.status !== "DONE" && " est."}</span>
                      </span>
                      {busy(t.status) && <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-line"><span className="indeterminate block h-full w-1/3 rounded-full bg-brand" /></span>}
                    </Link>
                    <div className="absolute right-2 top-2"><DeleteBatchButton taskId={t.id} running={t.status === "RUNNING"} selected={on} /></div>
                    {t.error && <p className="mx-3 mb-3 line-clamp-2 rounded-lg bg-bad-soft p-2 text-xs text-red-800">{t.error}</p>}
                    {t.status === "FAILED" && <div className="mx-3 mb-3 border-t border-line pt-2"><RetryButton taskId={t.id} /></div>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <div className="order-first lg:order-none lg:col-span-7">
          {selected ? <PostsResult task={selected} /> : <Empty icon="task_alt" text="Pick a batch to see its posts here." />}
        </div>
      </div>
    </div>
  );
}

/** While a batch is being worked on: the Socmed Specialist and QC trade drafts and verdicts. */
function Collaborating({ task }: { task: { status: string; createdAt: Date; input: unknown; progress: unknown } }) {
  const n = ((task.input ?? {}) as { count?: number }).count;
  const live = Array.isArray(task.progress) && task.progress.length > 0;
  const steps = [
    ["edit_note", "Socmed Specialist drafts 3 variants for each post"],
    ["rule", "QC runs the rule checks, then the quality judge reads what is left"],
    ["replay", "Weak variants go back for a rewrite; what passes is kept"],
  ] as const;
  return (
    <div role="status" aria-live="polite" className="space-y-5 rounded-2xl bg-canvas p-5">
      <div className="flex items-center justify-center gap-3">
        <span className="flex flex-col items-center gap-1.5 text-center">
          <RoleAvatar role="socmedSpecialist" className="flicker h-11 w-11 ring-2 ring-offset-2 ring-brand" />
          <span className="text-[11px] font-bold">Socmed Specialist</span>
        </span>
        <span aria-hidden className="flex w-24 flex-col gap-3 sm:w-40">
          <span className="flex items-center gap-1 text-ink-3"><span className="flow flow-right h-0.5 flex-1" /><span className="material-symbols-outlined !text-[18px]">chevron_right</span></span>
          <span className="flex items-center gap-1 text-ink-3"><span className="material-symbols-outlined !text-[18px]">chevron_left</span><span className="flow flow-left h-0.5 flex-1" /></span>
        </span>
        <span className="flex flex-col items-center gap-1.5 text-center">
          <RoleAvatar role="accountTeam" className="flicker h-11 w-11 ring-2 ring-offset-2 ring-brand [animation-delay:350ms]" />
          <span className="text-[11px] font-bold">QC</span>
        </span>
      </div>
      <p className="text-center text-sm font-semibold">
        {task.status === "QUEUED" ? "Waiting for a worker to pick this batch up…" : `Working on ${n ?? "your"} post${n === 1 ? "" : "s"} together…`}
        <span className="ml-1 font-normal text-ink-2">{formatDuration(Date.now() - task.createdAt.getTime())}</span>
      </p>
      {live ? (
        <Conversation notes={task.progress} />
      ) : (
        <ol className="space-y-2">
          {steps.map(([icon, text], k) => (
            <li key={text} className="flex items-center gap-3 rounded-xl bg-white p-2.5 text-sm">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-dark">
                <span className="material-symbols-outlined !text-[18px] animate-pulse" style={{ animationDelay: `${k * 500}ms` }}>{icon}</span>
              </span>
              {text}
            </li>
          ))}
        </ol>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-3">This page refreshes by itself. A batch usually takes a minute or two.</p>
        <GenerationInfo />
      </div>
    </div>
  );
}

async function PostsResult({ task }: { task: Awaited<ReturnType<typeof db.agentTask.findUnique>> & {} }) {
  const artifact = task.artifactId ? await db.artifact.findUnique({ where: { id: task.artifactId } }) : null;
  const s = await getSettings();
  const posts = artifact ? SocialPosts.safeParse(artifact.payload).data : undefined;
  const who = posts ? await socialWho() : null;
  return (
    <section aria-label="Batch output" className="space-y-4 rounded-2xl border border-line p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-lg font-bold leading-snug">{taskTitle(task.input)}</h3>
          <p className="text-xs text-ink-2">{when(task.createdAt)} · US${Number(task.status === "DONE" ? task.costUsd : task.estUsd).toFixed(4)}{task.status !== "DONE" && " est."}</p>
        </div>
        <span className={`pill shrink-0 ${TASK_PILL[task.status]}`}>{task.status.toLowerCase()}</span>
      </div>
      {busy(task.status) ? (
        <Collaborating task={task} />
      ) : !artifact ? (
        <Empty icon="error" text={task.status === "FAILED" ? "No output: the batch failed. Retry it from the list." : "Not finished yet."} />
      ) : posts ? (
        <>
          {posts.transcript.length > 0 && (
            <details className="rounded-2xl border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold">Specialist and QC conversation <span className="font-normal text-ink-3">· how these posts were picked</span></summary>
              <div className="mt-3"><Conversation notes={posts.transcript} /></div>
            </details>
          )}
          <PostPreview posts={posts.posts} who={who} />
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Modal title="Schedule posts" className="btn-primary" trigger={<><span className="material-symbols-outlined">event_upcoming</span>Schedule posts</>}>
              <PostSchedule taskId={task.id} payload={artifact.payload} timezone={s.timezone} />
            </Modal>
            <GenerationInfo />
            <details className="ml-auto"><summary className="cursor-pointer text-xs font-semibold text-ink-2">Raw JSON</summary><pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-canvas p-3 text-xs">{JSON.stringify(artifact.payload, null, 2)}</pre></details>
          </div>
        </>
      ) : (
        <OutputView payload={artifact.payload} />
      )}
    </section>
  );
}

/** "Send to flow": a finished brief, concept or visual direction starts a campaign at the next pipeline stage. */
export async function SendToFlow({ task }: { task: { id: string; agentRole: string; status: string; campaignId: string | null; input: unknown } }) {
  const def = TASKS[task.agentRole];
  if (task.status !== "DONE" || !def?.next) return null;
  if (task.campaignId) return <Link href={`/campaigns/${task.campaignId}`} className="btn-soft">Open the campaign started from this</Link>;
  const input = (task.input ?? {}) as { objective?: string; product?: string; audience?: string; platforms?: string[] };
  const s = await getSettings();
  return (
    <details className="rounded-2xl bg-canvas p-4">
      <summary className="cursor-pointer font-semibold">Send to flow (starts at {roleByAgent(def.next)?.label ?? def.next})</summary>
      <form action={sendTaskToFlow.bind(null, task.id)} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">Product</span><input name="product" required defaultValue={input.product} className="input" /></label>
        <label className="block"><span className="label">Audience</span><input name="audience" required defaultValue={input.audience} className="input" /></label>
        <label className="block sm:col-span-2"><span className="label">Objective</span><input name="objective" required defaultValue={input.objective} className="input" /></label>
        <fieldset>
          <legend className="label">Platforms</legend>
          {["instagram", "tiktok"].map((p) => (
            <label key={p} className="mr-3 text-sm"><input type="checkbox" name="platforms" value={p} defaultChecked={input.platforms?.includes(p) ?? p === "instagram"} /> {p}</label>
          ))}
        </fieldset>
        <label className="block"><span className="label">Budget cap (USD)</span><input name="budgetCapUsd" type="number" min="0.01" step="0.01" required defaultValue={String(s.campaignBudgetUsd)} className="input" /></label>
        <label className="block"><span className="label">Video source</span>
          <select name="defaultSource" defaultValue={s.defaultVideoSource} className="input">
            <option value="manual_upload">Manual upload</option><option value="seedance_api">Seedance API</option>
          </select>
        </label>
        <button className="btn-primary sm:col-span-2"><span className="material-symbols-outlined">rocket_launch</span>Create campaign from this output</button>
      </form>
    </details>
  );
}

/** Loads the pieces the schedule panel needs: the generated posts, the X/Threads channels and the rows so far. */
async function PostSchedule({ taskId, payload, timezone }: { taskId: string; payload: unknown; timezone: string }) {
  const parsed = SocialPosts.safeParse(payload);
  if (!parsed.success) return <p className="text-sm text-ink-2">This output is not a set of posts, so it cannot be scheduled.</p>;
  const [accounts, jobs, task] = await Promise.all([
    targetAccounts(),
    db.publishJob.findMany({
      where: { agentTaskId: taskId },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
      select: { id: true, platform: true, status: true, mode: true, scheduledAt: true, postId: true, permalink: true, error: true, caption: true, thread: true, socialAccount: { select: { handle: true } } },
    }),
    db.agentTask.findUnique({ where: { id: taskId }, select: { input: true } }),
  ]);
  const i = (task?.input ?? {}) as { platforms?: string[]; length?: string; mediaType?: string; linkUrl?: string; imageNote?: string };
  return (
    <SchedulePanel
      taskId={taskId}
      posts={parsed.data.posts}
      brief={{ platforms: i.platforms ?? [], length: i.length, mediaType: i.mediaType, linkUrl: i.linkUrl, imageNote: i.imageNote }}
      skipped={parsed.data.skipped}
      channels={accounts.filter((a) => TEXT_PLATFORMS.includes(a.platform)).map((a) => ({ id: a.id, platform: a.platform, handle: a.handle }))}
      timezone={timezone}
      jobs={jobs.map((j) => ({ ...j, handle: j.socialAccount.handle }))}
    />
  );
}

// ---------- Artifacts (search + compare) ----------

/** First readable sentence-like string in an output, for the grid card preview. */
function preview(v: unknown, depth = 0): string | null {
  if (typeof v === "string") return v.length > 24 ? v : null;
  if (depth > 4 || v === null || typeof v !== "object") return null;
  for (const x of Array.isArray(v) ? v : Object.values(v)) {
    const p = preview(x, depth + 1);
    if (p) return p;
  }
  return null;
}

const socialWho = () => db.socialAccount.findFirst({ where: { publisher: "buffer", active: true, platform: { in: ["twitter", "threads"] } }, select: { handle: true, avatarUrl: true } });

export async function ArtifactsPanel({ role, q, a, b }: { role: BoardRole; q?: string; a?: string; b?: string }) {
  const ids = q ? (await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Artifact" WHERE "agentRole" = ${role.agentRole} AND payload::text ILIKE ${likePattern(q)}`).map((r) => r.id) : null;
  const rows = await db.artifact.findMany({
    where: { agentRole: role.agentRole, ...(ids && { id: { in: ids } }) },
    orderBy: { createdAt: "desc" }, take: 30,
    select: { id: true, agentRole: true, version: true, createdAt: true, costUsd: true, payload: true, campaignId: true, agentTaskId: true, campaign: { select: { clientBrief: true } } },
  });
  const inputs = new Map((await db.agentTask.findMany({ where: { id: { in: rows.flatMap((r) => r.agentTaskId ?? []) } }, select: { id: true, input: true } })).map((t) => [t.id, t.input]));
  const titleOf = (x: (typeof rows)[number]) => artifactTitle(x, x.agentTaskId ? inputs.get(x.agentTaskId) : undefined);
  const [left, right] = [rows.find((r) => r.id === a), rows.find((r) => r.id === b)];
  const who = role.agentRole === "socmedSpecialist" ? await socialWho() : null;
  const base = `/boards/roles?role=${role.slug}&tab=artifacts${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  return (
    <div className="space-y-4">
      <form action="/boards/roles" role="search" className="flex gap-2">
        <input type="hidden" name="role" value={role.slug} />
        <input type="hidden" name="tab" value="artifacts" />
        <input name="q" type="search" defaultValue={q} aria-label="Search this agent's outputs" placeholder="Search outputs…" className="input rounded-full" />
      </form>
      {!rows.length && <Empty icon="psychology" text={q ? "No output matches." : "No output yet."} />}
      {left && right && (
        <div className="rounded-2xl border border-line p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-semibold">Compare</h3>
            <Link href={base} scroll={false} className="text-xs font-semibold text-brand">Close</Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[left, right].map((x) => (
              <div key={x.id} className="min-w-0">
                <p className="mb-2 text-xs font-semibold text-ink-2">{titleOf(x)} · v{x.version} · {when(x.createdAt)}</p>
                <OutputView payload={x.payload} who={who} />
              </div>
            ))}
          </div>
          <ChangedKeys a={left.payload} b={right.payload} />
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((x) => {
          const text = preview(x.payload);
          return (
            <li key={x.id} className="min-w-0">
              <Modal
                title={`${titleOf(x)} · v${x.version}`}
                label="Open output"
                className="flex h-full w-full flex-col gap-2 rounded-2xl border border-line bg-white p-4 text-left shadow-sm transition hover:border-brand hover:bg-brand-soft"
                trigger={
                  <>
                    <span className="flex items-center justify-between gap-2">
                      <span className="pill border-violet-200 bg-agent-soft !px-2.5 !py-0.5 text-violet-700">v{x.version}</span>
                      <span className="text-xs text-ink-3">{when(x.createdAt)}</span>
                    </span>
                    <span className="line-clamp-2 font-semibold">{titleOf(x)}</span>
                    <span className="text-xs font-semibold text-ink-3">{x.campaignId ? "Campaign" : "Direct task"}</span>
                    <span className="line-clamp-3 flex-1 text-sm text-ink-2">{text ?? "No text preview."}</span>
                    <span className="text-xs text-ink-3">US${Number(x.costUsd).toFixed(4)}</span>
                  </>
                }
              >
                <p className="text-sm text-ink-2">{x.campaignId ? "Campaign" : "Direct task"} · {when(x.createdAt)} · US${Number(x.costUsd).toFixed(4)}</p>
                <div className="flex flex-wrap gap-3 text-sm font-semibold">
                  {x.campaignId && <Link href={`/campaigns/${x.campaignId}?tab=artifacts`} className="text-brand">Open campaign</Link>}
                  {x.agentTaskId && !x.campaignId && <Link href={taskHref(x.agentRole, x.agentTaskId)} className="text-brand">Open task</Link>}
                  <Link href={`${base}&a=${x.id}&b=${b && b !== x.id ? b : (rows.find((r) => r.id !== x.id)?.id ?? x.id)}`} className="text-brand">Compare as left</Link>
                  {a && a !== x.id && <Link href={`${base}&a=${a}&b=${x.id}`} className="text-brand">Compare as right</Link>}
                </div>
                <OutputView payload={x.payload} who={who} />
              </Modal>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- Memory ----------

export async function MemoryPanel({ role }: { role: BoardRole }) {
  const rows = await db.agentMemory.findMany({
    where: { role: role.agentRole, archivedAt: null },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 30,
  });
  if (!rows.length) return <Empty icon="neurology" text="No memories yet. Tell this agent how to work in the Chat tab, or approve a campaign it worked on." />;
  return (
    <ul className="space-y-2">
      {rows.map((m) => (
        <li key={m.id} className="rounded-2xl bg-canvas p-4 text-sm">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="pill border-violet-200 bg-agent-soft text-violet-700">{m.layer}</span>
            {m.pinned && <span className="pill border-line bg-white text-ink-2">pinned</span>}
            {m.layer !== "episodic" && <span className="text-ink-2">confidence {m.confidence.toFixed(2)}</span>}
            <span className="ml-auto text-ink-3">{when(m.updatedAt)}</span>
          </div>
          <p className="whitespace-pre-wrap">{m.content}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold">
            <form action={pinMemory.bind(null, m.id, !m.pinned)}><button className="text-brand">{m.pinned ? "Unpin" : "Pin"}</button></form>
            <form action={removeMemory.bind(null, m.id)}><button className="text-red-700">Remove</button></form>
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold text-brand">Edit</summary>
            <form action={editMemory.bind(null, m.id)} className="mt-2 space-y-2">
              <textarea name="content" required maxLength={600} rows={3} defaultValue={m.content} aria-label="Memory text" className="input" />
              <button className="btn-soft">Save</button>
            </form>
          </details>
        </li>
      ))}
    </ul>
  );
}

// ---------- Results & feedback ----------

export async function ResultsPanel({ role }: { role: BoardRole }) {
  const [campaigns, feedback] = await Promise.all([
    db.campaign.findMany({
      where: workedOn(role.agentRole), orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, status: true, clientBrief: true, createdAt: true, decisions: { select: { type: true, targetAgent: true, notes: true } } },
    }),
    db.agentFeedback.findMany({ where: { agentRole: role.agentRole }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const rows = campaigns.map((c) => ({ ...c, outcome: outcomeLabel(c.status, c.decisions, role.agentRole) }));
  const counts = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.outcome]: (m[r.outcome] ?? 0) + 1 }), {});
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <section aria-labelledby="res-h" className="space-y-3 lg:col-span-6">
        <h2 id="res-h" className="text-lg font-bold">Results</h2>
        <p className="flex flex-wrap gap-2">
          {(Object.keys(OUTCOME) as (keyof typeof OUTCOME)[]).filter((o) => counts[o]).map((o) => (
            <span key={o} className={`pill ${OUTCOME[o][1]}`}>{OUTCOME[o][0]}: {counts[o]}</span>
          ))}
        </p>
        {!rows.length ? (
          <p className="rounded-2xl bg-canvas p-4 text-sm text-ink-2">No campaign work yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <Link href={`/campaigns/${c.id}`} className="font-semibold hover:underline">{product(c.clientBrief) ?? c.id}</Link>
                <span className={`pill ${OUTCOME[c.outcome][1]}`}>{OUTCOME[c.outcome][0]}</span>
                <span className="ml-auto text-xs text-ink-2">{when(c.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="fb-h" className="space-y-3 lg:col-span-6">
        <h2 id="fb-h" className="text-lg font-bold">Feedback</h2>
        <FeedbackForm agentRole={role.agentRole} />
        <FeedbackList rows={feedback} />
      </section>
    </div>
  );
}

// ---------- Cross-role views ----------

/** Shots waiting for footage across all campaigns: the same cards as the campaign Shots/Assets tabs. */
export async function ExecutionQueue() {
  const campaigns = await db.campaign.findMany({
    where: { status: "AWAITING_VIDEO_UPLOAD" },
    orderBy: { createdAt: "asc" },
    select: { id: true, clientBrief: true, shots: { orderBy: { shotId: "asc" }, include: { assets: { orderBy: { version: "desc" } } } } },
  });
  if (!campaigns.length) return <Empty icon="task_alt" text="No shots waiting for footage." />;
  return (
    <div className="space-y-8">
      {campaigns.map((c) => (
        <article key={c.id} className="space-y-4">
          <h2 className="text-lg font-bold">
            <Link href={`/campaigns/${c.id}?tab=assets`} className="hover:underline">{(c.clientBrief as { product?: string }).product ?? c.id}</Link>
          </h2>
          <ShotsTab shots={c.shots.filter((s) => s.status !== "ready")} />
          <AssetsTab shots={c.shots.filter((s) => s.status !== "ready")} />
        </article>
      ))}
    </div>
  );
}

export async function Schedule() {
  const [jobs, campaigns, accounts, settings] = await Promise.all([
    db.publishJob.findMany({
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
      take: 100,
      select: { id: true, campaignId: true, agentTaskId: true, platform: true, status: true, mode: true, scheduledAt: true, postId: true, error: true, permalink: true, caption: true, hashtags: true, thread: true, sourceNote: true, sourceConfidence: true, socialAccount: { select: { handle: true, avatarUrl: true } } },
    }),
    db.campaign.findMany({
      where: { status: { in: ["APPROVED", "PUBLISHED"] }, finalCutKey: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, clientBrief: true, approvalPackage: true },
    }),
    targetAccounts(),
    getSettings(),
  ]);
  return (
    <div className="space-y-8">
      <PostList
        posts={jobs.map(({ socialAccount, ...j }) => ({ ...j, handle: socialAccount.handle, avatarUrl: socialAccount.avatarUrl }))}
        timezone={settings.timezone}
        action={
          <Modal title="New post" className="btn-primary" trigger={<><span className="material-symbols-outlined">add</span>New post</>}>
            <TextBrief />
          </Modal>
        }
      />
      <details className="rounded-2xl border border-line p-4">
        <summary className="cursor-pointer font-bold">Publish a campaign video</summary>
        <div className="mt-4">
          {accounts.length && campaigns.length ? (
            <PublishForm
              timezone={settings.timezone}
              campaigns={campaigns.map((c) => ({
                id: c.id,
                label: (c.clientBrief as { product?: string }).product ?? c.id,
                options: targetOptions(accounts, c.approvalPackage, (c.clientBrief as { platforms?: string[] }).platforms ?? []),
              }))}
            />
          ) : (
            <Empty icon="schedule_send" text={accounts.length ? "No approved campaign with a final cut yet." : "No Buffer accounts yet. Use Sync from Buffer in Accounts (top-right menu)."} />
          )}
        </div>
      </details>
    </div>
  );
}
