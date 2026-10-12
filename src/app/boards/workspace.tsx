import Link from "next/link";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { likePattern } from "@/lib/boards/archive";
import { roleByAgent, type BoardRole } from "@/lib/boards/roles";
import { TASKS, taskTitle } from "@/lib/boards/tasks";
import { formatDuration } from "@/lib/status";
import { ChangedKeys, Empty } from "../campaigns/[id]/shots";
import { sendTaskToFlow } from "./actions";
import { RetryButton, TaskForm, type Option } from "./task-form";

const product = (b: unknown) => (b as { product?: string } | null)?.product;
const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const TASK_PILL: Record<string, string> = {
  QUEUED: "border-slate-200 bg-slate-50 text-slate-700",
  RUNNING: "border-blue-200 bg-brand-soft text-brand-dark",
  WAITING: "border-amber-200 bg-amber-soft text-amber-800",
  DONE: "border-emerald-200 bg-ok-soft text-emerald-800",
  FAILED: "border-red-200 bg-bad-soft text-red-800",
};

/** Label for an artifact in pickers and lists: its campaign, or "Direct task". */
const artifactLabel = (a: { agentRole: string; version: number; createdAt: Date; campaign: { clientBrief: unknown } | null }) =>
  `${product(a.campaign?.clientBrief) ?? "Direct task"} · ${roleByAgent(a.agentRole)?.label ?? a.agentRole} v${a.version} · ${when(a.createdAt)}`;

// ---------- Quick task ----------

export async function QuickTask({ role, taskId }: { role: BoardRole; taskId?: string }) {
  const def = TASKS[role.agentRole];
  if (!def) return <Empty icon="construction" text={`${role.label} has no direct task yet.`} />;
  const schema = z.toJSONSchema(def.input, { io: "input" }) as { properties: Record<string, { ref?: string; library?: string }>; required?: string[] };
  const fields = Object.values(schema.properties);
  const refRoles = [...new Set(fields.map((p) => p.ref).filter((r): r is string => !!r))];
  const kinds = [...new Set(fields.map((p) => p.library).filter((k): k is string => !!k))];

  const [refRows, libRows, tasks, selected] = await Promise.all([
    Promise.all(refRoles.map((r) => db.artifact.findMany({
      where: { agentRole: r }, orderBy: { createdAt: "desc" }, take: 25,
      select: { id: true, agentRole: true, version: true, createdAt: true, campaign: { select: { clientBrief: true } } },
    }))),
    kinds.length ? db.creativeAsset.findMany({ where: { kind: { in: kinds as ("character" | "location" | "style")[] } }, orderBy: { name: "asc" }, select: { id: true, kind: true, name: true } }) : [],
    db.agentTask.findMany({ where: { agentRole: role.agentRole }, orderBy: { createdAt: "desc" }, take: 20 }),
    taskId ? db.agentTask.findUnique({ where: { id: taskId } }) : null,
  ]);
  const refs: Record<string, Option[]> = Object.fromEntries(refRoles.map((r, i) => [r, refRows[i].map((a) => ({ id: a.id, label: artifactLabel(a) }))]));
  const library: Record<string, Option[]> = Object.fromEntries(kinds.map((k) => [k, libRows.filter((a) => a.kind === k).map((a) => ({ id: a.id, label: a.name }))]));

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="space-y-3 lg:col-span-5">
        <h2 className="text-lg font-bold">New task</h2>
        <p className="text-sm text-ink-2">Runs only this agent. Output: {def.output}.</p>
        <TaskForm slug={role.slug} schema={schema} refs={refs} library={library} llm={def.llm} />
      </div>
      <div className="space-y-3 lg:col-span-7">
        <h2 className="text-lg font-bold">Tasks</h2>
        {!tasks.length ? (
          <p className="rounded-2xl bg-canvas p-6 text-center text-sm text-ink-2">No tasks yet.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li key={t.id} className={`rounded-2xl p-3 text-sm ${t.id === taskId ? "bg-brand-soft" : "bg-canvas"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`pill ${TASK_PILL[t.status]}`}>{t.status.toLowerCase()}</span>
                  <Link href={`/boards/${role.slug}?tab=task&task=${t.id}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">
                    {taskTitle(t.input)}
                  </Link>
                  <span className="text-xs text-ink-2">
                    {when(t.createdAt)} · {t.status === "DONE" || t.status === "FAILED" ? formatDuration(t.updatedAt.getTime() - t.createdAt.getTime()) : "…"} · US${Number(t.status === "DONE" ? t.costUsd : t.estUsd).toFixed(4)}{t.status !== "DONE" && " est."}
                  </span>
                  {t.status === "FAILED" && <RetryButton taskId={t.id} />}
                </div>
                {t.requestedByRole && <p className="mt-1 text-xs text-ink-2">Requested by {roleByAgent(t.requestedByRole)?.label ?? t.requestedByRole}</p>}
                {t.error && <p className="mt-1 text-xs text-red-700">{t.error}</p>}
              </li>
            ))}
          </ul>
        )}
        {selected && <TaskResult task={selected} />}
      </div>
    </div>
  );
}

async function TaskResult({ task }: { task: Awaited<ReturnType<typeof db.agentTask.findUnique>> & {} }) {
  const def = TASKS[task.agentRole];
  const artifact = task.artifactId ? await db.artifact.findUnique({ where: { id: task.artifactId } }) : null;
  const input = (task.input ?? {}) as { objective?: string; product?: string; audience?: string; platforms?: string[] };
  const s = await getSettings();
  return (
    <section aria-label="Task output" className="space-y-3 rounded-2xl border border-line p-4">
      <h3 className="font-bold">Output</h3>
      {artifact ? (
        <pre className="max-h-96 overflow-auto rounded-xl bg-canvas p-3 text-xs">{JSON.stringify(artifact.payload, null, 2)}</pre>
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

// ---------- Artifacts (search + compare) ----------

export async function ArtifactsPanel({ role, q, a, b }: { role: BoardRole; q?: string; a?: string; b?: string }) {
  const ids = q ? (await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Artifact" WHERE "agentRole" = ${role.agentRole} AND payload::text ILIKE ${likePattern(q)}`).map((r) => r.id) : null;
  const rows = await db.artifact.findMany({
    where: { agentRole: role.agentRole, ...(ids && { id: { in: ids } }) },
    orderBy: { createdAt: "desc" }, take: 30,
    select: { id: true, agentRole: true, version: true, createdAt: true, costUsd: true, payload: true, campaignId: true, agentTaskId: true, campaign: { select: { clientBrief: true } } },
  });
  const [left, right] = [rows.find((r) => r.id === a), rows.find((r) => r.id === b)];
  const base = `/boards/${role.slug}?tab=artifacts${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  return (
    <div className="space-y-4">
      <form action={`/boards/${role.slug}`} role="search">
        <input type="hidden" name="tab" value="artifacts" />
        <input name="q" type="search" defaultValue={q} aria-label="Search this agent's outputs" placeholder="Search outputs…" className="input rounded-full" />
      </form>
      {!rows.length && <Empty icon="psychology" text={q ? "No output matches." : "No output yet."} />}
      {left && right && (
        <div className="rounded-2xl border border-line p-4">
          <h3 className="mb-3 font-semibold">Compare</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {[left, right].map((x) => (
              <div key={x.id}>
                <p className="mb-1 text-xs font-semibold text-ink-2">{artifactLabel(x)}</p>
                <pre className="max-h-[28rem] overflow-auto rounded-xl bg-canvas p-3 text-xs">{JSON.stringify(x.payload, null, 2)}</pre>
              </div>
            ))}
          </div>
          <ChangedKeys a={left.payload} b={right.payload} />
        </div>
      )}
      <ul className="space-y-2">
        {rows.map((x) => (
          <li key={x.id}>
            <details className="rounded-2xl bg-canvas p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                {artifactLabel(x)} <span className="font-normal text-ink-2">· US${Number(x.costUsd).toFixed(4)}</span>
              </summary>
              <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
                {x.campaignId && <Link href={`/campaigns/${x.campaignId}?tab=artifacts`} className="text-brand">Open campaign</Link>}
                {x.agentTaskId && !x.campaignId && <Link href={`/boards/${role.slug}?tab=task&task=${x.agentTaskId}`} className="text-brand">Open task</Link>}
                <Link href={`${base}&a=${x.id}&b=${b && b !== x.id ? b : (rows.find((r) => r.id !== x.id)?.id ?? x.id)}`} className="text-brand">Compare as left</Link>
                {a && a !== x.id && <Link href={`${base}&a=${a}&b=${x.id}`} className="text-brand">Compare as right</Link>}
              </div>
              <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-white p-3 text-xs">{JSON.stringify(x.payload, null, 2)}</pre>
            </details>
          </li>
        ))}
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
