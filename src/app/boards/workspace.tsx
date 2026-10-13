import Link from "next/link";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { presignGet } from "@/lib/s3";
import { likePattern, workedOn } from "@/lib/boards/archive";
import { OUTCOME, outcomeLabel } from "@/lib/boards/outcome";
import { FeedbackForm, FeedbackList } from "./feedback";
import { roleByAgent, type BoardRole } from "@/lib/boards/roles";
import { TASKS } from "@/lib/boards/tasks";
import { taskTitle } from "@/lib/boards/status";
import { formatDuration } from "@/lib/status";
import { AssetsTab, ChangedKeys, Empty, ShotsTab } from "../campaigns/[id]/shots";
import { PublishForm } from "../ui";
import { TEXT_PLATFORMS } from "@/lib/publish";
import { targetAccounts, targetOptions } from "@/lib/publishPlan";
import { SocialPosts } from "@/lib/agents/schemas";
import { SchedulePanel } from "./schedule-panel";
import { PostList } from "./posts";
import { Modal } from "./modal";
import { PayloadView } from "./payload";
import { PostPreview } from "./post-preview";
import { TextBrief } from "../brief/text-brief";
import { fulfilTalent, requestTalent, sendTaskToFlow } from "./actions";
import { RetryButton, ScrapButton, TaskForm, type Option } from "./task-form";

const product = (b: unknown) => (b as { product?: string } | null)?.product;
const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const TASK_PILL: Record<string, string> = {
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
const artifactLabel = (a: { agentRole: string; version: number; createdAt: Date; campaign: { clientBrief: unknown } | null }) =>
  `${product(a.campaign?.clientBrief) ?? "Direct task"} · ${roleByAgent(a.agentRole)?.label ?? a.agentRole} v${a.version} · ${when(a.createdAt)}`;

// ---------- Quick task ----------

export async function QuickTask({ role, taskId }: { role: BoardRole; taskId?: string }) {
  const def = TASKS[role.agentRole];
  if (!def) return <Empty icon="construction" text={`${role.label} has no direct task yet.`} />;
  // Round-tripped through JSON so the client component only ever receives plain objects (React refuses anything else).
  const schema = JSON.parse(JSON.stringify(z.toJSONSchema(def.input, { io: "input" }))) as { properties: Record<string, { ref?: string; library?: string }>; required?: string[] };
  const fields = Object.values(schema.properties);
  const refRoles = [...new Set(fields.map((p) => p.ref).filter((r): r is string => !!r))];
  const kinds = [...new Set(fields.map((p) => p.library).filter((k): k is string => !!k))];

  const [refRows, libRows, tasks, selected] = await Promise.all([
    Promise.all(refRoles.map(async (r): Promise<Option[]> =>
      r === "campaign"
        ? (await db.campaign.findMany({
            where: { artifacts: { some: { agentRole: "artDirector" } } }, orderBy: { createdAt: "desc" }, take: 25,
            select: { id: true, status: true, clientBrief: true },
          })).map((c) => ({ id: c.id, label: `${product(c.clientBrief) ?? c.id} · ${c.status.toLowerCase().replace(/_/g, " ")}` }))
        : (await db.artifact.findMany({
            where: { agentRole: r }, orderBy: { createdAt: "desc" }, take: 25,
            select: { id: true, agentRole: true, version: true, createdAt: true, campaign: { select: { clientBrief: true } } },
          })).map((a) => ({ id: a.id, label: artifactLabel(a) })),
    )),
    kinds.length ? db.creativeAsset.findMany({ where: { kind: { in: kinds as ("character" | "location" | "style")[] } }, orderBy: { name: "asc" }, select: { id: true, kind: true, name: true } }) : [],
    db.agentTask.findMany({ where: { agentRole: role.agentRole }, orderBy: { createdAt: "desc" }, take: 20 }),
    taskId ? db.agentTask.findUnique({ where: { id: taskId } }) : null,
  ]);
  const refs: Record<string, Option[]> = Object.fromEntries(refRoles.map((r, i) => [r, refRows[i]]));
  const library: Record<string, Option[]> = Object.fromEntries(kinds.map((k) => [k, libRows.filter((a) => a.kind === k).map((a) => ({ id: a.id, label: a.name }))]));

  return (
    <div className="grid gap-6 lg:h-full lg:grid-cols-12 lg:grid-rows-[minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-3 lg:col-span-5">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Tasks <span className="text-sm font-normal text-ink-3">{tasks.length}</span></h2>
          <Modal
            title={`New task · ${role.label}`}
            label="New task"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white shadow-sm hover:bg-brand-dark"
            trigger={<span className="material-symbols-outlined">add</span>}
          >
            <p className="text-sm text-ink-2">Runs only this agent. Output: {def.output}.</p>
            <TaskForm slug={role.slug} schema={schema} refs={refs} library={library} llm={def.llm} />
          </Modal>
        </div>
        {!tasks.length ? (
          <p className="rounded-2xl bg-canvas p-6 text-center text-sm text-ink-2">No tasks yet. Use + to start one.</p>
        ) : (
          <ul className="quiet-scroll -mr-2 max-h-96 min-h-0 flex-1 space-y-2 overflow-y-auto pr-2 lg:max-h-none">
            {tasks.map((t) => {
              const [icon, tone] = TASK_ICON[t.status];
              const on = t.id === taskId;
              return (
                <li key={t.id} className={`rounded-2xl border bg-white p-3 text-sm shadow-sm transition ${on ? "border-brand ring-2 ring-brand/20" : "border-line hover:border-brand/50"}`}>
                  <Link href={`/boards/roles?role=${role.slug}&tab=task&task=${t.id}`} scroll={false} className="flex items-start gap-3">
                    <span aria-hidden className={`flex size-9 shrink-0 items-center justify-center rounded-full ${tone}`}>
                      <span className={`material-symbols-outlined !text-[20px] ${t.status === "RUNNING" ? "animate-spin" : ""}`}>{icon}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 font-semibold leading-snug">{taskTitle(t.input)}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
                        <span className={`pill !px-2 !py-0 !text-[10px] ${TASK_PILL[t.status]}`}>{t.status.toLowerCase()}</span>
                        <span>{when(t.createdAt)}</span>
                        {(t.status === "DONE" || t.status === "FAILED") && <span>· {formatDuration(t.updatedAt.getTime() - t.createdAt.getTime())}</span>}
                        <span>· US${Number(t.status === "DONE" ? t.costUsd : t.estUsd).toFixed(4)}{t.status !== "DONE" && " est."}</span>
                      </span>
                      {t.requestedByRole && <span className="mt-1 block text-xs text-ink-3">from {roleByAgent(t.requestedByRole)?.label ?? t.requestedByRole}</span>}
                    </span>
                  </Link>
                  {t.error && <p className="mt-2 line-clamp-2 rounded-lg bg-bad-soft p-2 text-xs text-red-800">{t.error}</p>}
                  {(t.status === "FAILED" || t.status === "QUEUED") && (
                    <div className="mt-2 flex items-center gap-4 border-t border-line pt-2">
                      {t.status === "FAILED" && <RetryButton taskId={t.id} />}
                      {t.status === "QUEUED" && <ScrapButton taskId={t.id} />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="quiet-scroll order-first min-h-0 lg:order-none lg:col-span-7 lg:overflow-y-auto">
        {selected ? <TaskResult task={selected} /> : <Empty icon="task_alt" text="Pick a task to see its output here." />}
      </div>
    </div>
  );
}

async function TaskResult({ task }: { task: Awaited<ReturnType<typeof db.agentTask.findUnique>> & {} }) {
  const def = TASKS[task.agentRole];
  const artifact = task.artifactId ? await db.artifact.findUnique({ where: { id: task.artifactId } }) : null;
  const input = (task.input ?? {}) as { objective?: string; product?: string; audience?: string; platforms?: string[] };
  const s = await getSettings();
  const pdfKey = (artifact?.payload as { pdfKey?: string } | null)?.pdfKey;
  const pdfUrl = pdfKey ? await presignGet(pdfKey, 3600) : null;
  const posts = artifact && task.agentRole === "socmedSpecialist" ? SocialPosts.safeParse(artifact.payload).data : undefined;
  const who = posts ? await socialWho() : null;
  return (
    <section aria-label="Task output" className="space-y-3 rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">{taskTitle(task.input)}</h3>
        <span className={`pill ${TASK_PILL[task.status]}`}>{task.status.toLowerCase()}</span>
      </div>
      {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer" className="btn-soft">Download storyboard PDF</a>}
      {artifact ? (
        posts ? (
          <>
            <PostPreview posts={posts.posts} who={who} />
            <Modal title="Schedule posts" className="btn-primary" trigger={<><span className="material-symbols-outlined">event_upcoming</span>Schedule posts</>}>
              <PostSchedule taskId={task.id} payload={artifact.payload} timezone={s.timezone} />
            </Modal>
            <details><summary className="cursor-pointer text-xs font-semibold text-ink-2">Raw JSON</summary><pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-canvas p-3 text-xs">{JSON.stringify(artifact.payload, null, 2)}</pre></details>
          </>
        ) : (
          <PayloadView payload={artifact.payload} />
        )
      ) : (
        <p className="text-sm text-ink-2">{task.status === "FAILED" ? "No output: the task failed." : "Not finished yet."}</p>
      )}
      {artifact && def?.next && (task.campaignId ? (
        <Link href={`/campaigns/${task.campaignId}`} className="btn-soft">Open the campaign started from this</Link>
      ) : (
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
      ))}
    </section>
  );
}

/** Loads the pieces the schedule panel needs: the generated posts, the X/Threads channels and the rows so far. */
async function PostSchedule({ taskId, payload, timezone }: { taskId: string; payload: unknown; timezone: string }) {
  const parsed = SocialPosts.safeParse(payload);
  if (!parsed.success) return <p className="text-sm text-ink-2">This output is not a set of posts, so it cannot be scheduled.</p>;
  const [accounts, jobs] = await Promise.all([
    targetAccounts(),
    db.publishJob.findMany({
      where: { agentTaskId: taskId },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
      select: { id: true, platform: true, status: true, mode: true, scheduledAt: true, postId: true, permalink: true, error: true, caption: true, thread: true, socialAccount: { select: { handle: true } } },
    }),
  ]);
  return (
    <SchedulePanel
      taskId={taskId}
      posts={parsed.data.posts}
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

type Who = { handle: string; avatarUrl: string | null } | null;
const socialWho = () => db.socialAccount.findFirst({ where: { publisher: "buffer", active: true, platform: { in: ["twitter", "threads"] } }, select: { handle: true, avatarUrl: true } });

/** An output as the X/Threads-style preview when it is a set of posts, otherwise as labelled fields. */
function OutputView({ payload, who }: { payload: unknown; who: Who }) {
  const posts = SocialPosts.safeParse(payload).data;
  return posts ? <PostPreview posts={posts.posts} who={who} /> : <PayloadView payload={payload} />;
}

export async function ArtifactsPanel({ role, q, a, b }: { role: BoardRole; q?: string; a?: string; b?: string }) {
  const ids = q ? (await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Artifact" WHERE "agentRole" = ${role.agentRole} AND payload::text ILIKE ${likePattern(q)}`).map((r) => r.id) : null;
  const rows = await db.artifact.findMany({
    where: { agentRole: role.agentRole, ...(ids && { id: { in: ids } }) },
    orderBy: { createdAt: "desc" }, take: 30,
    select: { id: true, agentRole: true, version: true, createdAt: true, costUsd: true, payload: true, campaignId: true, agentTaskId: true, campaign: { select: { clientBrief: true } } },
  });
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
                <p className="mb-2 text-xs font-semibold text-ink-2">{artifactLabel(x)}</p>
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
                title={`${product(x.campaign?.clientBrief) ?? "Direct task"} · v${x.version}`}
                label="Open output"
                className="flex h-full w-full flex-col gap-2 rounded-2xl border border-line bg-white p-4 text-left shadow-sm transition hover:border-brand hover:bg-brand-soft"
                trigger={
                  <>
                    <span className="flex items-center justify-between gap-2">
                      <span className="pill border-violet-200 bg-agent-soft !px-2.5 !py-0.5 text-violet-700">v{x.version}</span>
                      <span className="text-xs text-ink-3">{when(x.createdAt)}</span>
                    </span>
                    <span className="line-clamp-1 font-semibold">{product(x.campaign?.clientBrief) ?? "Direct task"}</span>
                    <span className="line-clamp-3 flex-1 text-sm text-ink-2">{text ?? "No text preview."}</span>
                    <span className="text-xs text-ink-3">US${Number(x.costUsd).toFixed(4)}</span>
                  </>
                }
              >
                <p className="text-sm text-ink-2">{artifactLabel(x)} · US${Number(x.costUsd).toFixed(4)}</p>
                <div className="flex flex-wrap gap-3 text-sm font-semibold">
                  {x.campaignId && <Link href={`/campaigns/${x.campaignId}?tab=artifacts`} className="text-brand">Open campaign</Link>}
                  {x.agentTaskId && !x.campaignId && <Link href={`/boards/roles?role=${role.slug}&tab=task&task=${x.agentTaskId}`} className="text-brand">Open task</Link>}
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
  if (!rows.length) return <Empty icon="neurology" text="No memories yet. Episodes are written when a campaign this agent worked on is approved." />;
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
        </li>
      ))}
    </ul>
  );
}

// ---------- Talent hand-off ----------

/** Content Creator: locked talent (ready to use) and the "request new talent" hand-off to the Talent Manager. */
export async function ReadyTalent() {
  const [campaigns, requests] = await Promise.all([
    db.campaign.findMany({ where: { status: { notIn: ["REJECTED", "EXPIRED", "FAILED", "PUBLISHED"] } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, clientBrief: true } }),
    db.agentTask.findMany({ where: { agentRole: "talentManager", requestedByRole: "videographer" }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return (
    <div className="mb-8 grid gap-6 lg:grid-cols-12">
      <div className="space-y-3 lg:col-span-12">
        <h2 className="text-lg font-bold">Request new talent</h2>
        <form action={requestTalent} className="space-y-3">
          <label className="block"><span className="label">What do you need?</span>
            <textarea name="request" required maxLength={1500} rows={3} placeholder="e.g. A friendly barista in her 20s for a morning coffee reel" className="input" />
          </label>
          <label className="block"><span className="label">For campaign (optional)</span>
            <select name="campaignId" className="input">
              <option value="">—</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{product(c.clientBrief) ?? c.id}</option>)}
            </select>
          </label>
          <button className="btn-primary"><span className="material-symbols-outlined">send</span>Send to Talent Manager</button>
        </form>
        <HandoffList tasks={requests} />
      </div>
    </div>
  );
}

/** Talent Manager: open requests from other agents, each answered with a new or existing character. */
export async function TalentRequests() {
  const [open, characters] = await Promise.all([
    db.agentTask.findMany({ where: { agentRole: "talentManager" }, orderBy: [{ status: "desc" }, { createdAt: "desc" }], take: 20 }),
    db.creativeAsset.findMany({ where: { kind: "character" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const waiting = open.filter((t) => t.status === "WAITING");
  return (
    <section aria-labelledby="req-h" className="mb-8 space-y-3">
      <h2 id="req-h" className="text-lg font-bold">Requests ({waiting.length} open)</h2>
      {!waiting.length && <p className="rounded-2xl bg-canvas p-4 text-sm text-ink-2">No open requests.</p>}
      {waiting.map((t) => {
        const i = t.input as { request?: string; product?: string; creativeAssetId?: string };
        const answer = characters.find((c) => c.id === i.creativeAssetId);
        return (
          <article key={t.id} className="space-y-3 rounded-2xl bg-canvas p-4 text-sm">
            <p>
              <span className="font-semibold">{roleByAgent(t.requestedByRole ?? "")?.label ?? "Owner"}</span> asks{i.product && <> for <span className="font-semibold">{i.product}</span></>}: {i.request}
            </p>
            {answer ? (
              <p className="text-amber-800">Answered with <span className="font-semibold">{answer.name}</span>. Lock it below to hand it over.</p>
            ) : (
              <form action={fulfilTalent.bind(null, t.id)} className="grid gap-2 sm:grid-cols-2">
                <label className="block sm:col-span-2"><span className="label">Use an existing character</span>
                  <select name="creativeAssetId" className="input">
                    <option value="">— or create a new one below —</option>
                    {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label className="block"><span className="label">New name</span><input name="name" maxLength={80} className="input" /></label>
                <label className="block"><span className="label">Reference image URLs</span><textarea name="imageUrls" rows={1} className="input font-mono" /></label>
                <label className="block sm:col-span-2"><span className="label">Description / talent sheet</span><textarea name="description" maxLength={1500} rows={3} className="input" /></label>
                <button className="btn-primary sm:col-span-2">Answer request</button>
              </form>
            )}
          </article>
        );
      })}
      <HandoffList tasks={open.filter((t) => t.status !== "WAITING")} />
    </section>
  );
}

/** Hand-off history: who asked, who did it, result. */
function HandoffList({ tasks }: { tasks: { id: string; status: string; requestedByRole: string | null; input: unknown; createdAt: Date; updatedAt: Date }[] }) {
  if (!tasks.length) return null;
  return (
    <details className="rounded-2xl bg-canvas p-3 text-sm">
      <summary className="cursor-pointer font-semibold">Hand-off history ({tasks.length})</summary>
      <ul className="mt-2 space-y-1">
        {tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap gap-2">
            <span className={`pill ${TASK_PILL[t.status]}`}>{t.status.toLowerCase()}</span>
            <span>{roleByAgent(t.requestedByRole ?? "")?.label ?? "Owner"} → Talent Manager: {taskTitle(t.input)}</span>
            <span className="ml-auto text-xs text-ink-2">{when(t.status === "DONE" ? t.updatedAt : t.createdAt)}</span>
          </li>
        ))}
      </ul>
    </details>
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
