import Link from "next/link";
import { db } from "@/lib/db";
import { roleByAgent, roleBySlug } from "@/lib/boards/roles";
import { FLOWS, type FlowSlug } from "@/lib/boards/flows";
import { taskTitle } from "@/lib/boards/status";
import { Empty } from "../campaigns/[id]/shots";
import { CreatorLibrary } from "./library";
import { RoleAvatar } from "./cards";
import { Modal } from "./modal";
import { OutputView } from "./outputs";
import { fulfilTalent, requestTalent } from "./actions";
import { FlowForm, RetryButton, ScrapButton, TaskForm } from "./task-form";
import { ExecutionQueue, product, refOptions, SendToFlow, TASK_PILL, taskFormProps, TextPosts, when } from "./workspace";

// Features several agents handle together; every direct task starts here (the role dialog has no Quick task). The
// same component renders on /boards/feature/<slug> and as a tab in the dialog of every role involved.

type Task = Awaited<ReturnType<typeof db.agentTask.findMany>>[number];

/** The agents behind a feature, each linking to its dialog. */
export function FeatureAgents({ slugs }: { slugs: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {slugs.map((s) => roleBySlug(s)).filter((r) => !!r).map((r) => (
        <li key={r.slug}>
          <Link href={`/boards/roles?role=${r.slug}`} className="flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-3 text-sm font-semibold shadow-sm hover:bg-brand-soft">
            <RoleAvatar role={r.agentRole} className="h-7 w-7" />{r.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

const payloads = async (tasks: Task[]) => {
  const ids = tasks.map((t) => t.artifactId).filter((x): x is string => !!x);
  const rows = ids.length ? await db.artifact.findMany({ where: { id: { in: ids } }, select: { id: true, payload: true } }) : [];
  return new Map(rows.map((a) => [a.id, a.payload]));
};

/** One role's part of a feature run: who, status, and its output in the view that fits it. */
function StepCard({ agentRole, task, payload, waiting }: { agentRole: string; task?: Task; payload?: unknown; waiting?: string }) {
  const role = roleByAgent(agentRole);
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-white p-4">
      <h3 className="flex flex-wrap items-center gap-2 font-bold">
        <RoleAvatar role={agentRole} className="h-8 w-8" />{role?.label ?? agentRole}
        {task && <span className={`pill !py-0 ${TASK_PILL[task.status]}`}>{task.status.toLowerCase()}</span>}
        {task && <span className="ml-auto text-xs font-normal text-ink-2">US${Number(task.status === "DONE" ? task.costUsd : task.estUsd).toFixed(4)}{task.status !== "DONE" && " est."}</span>}
      </h3>
      {!task ? <p className="text-sm text-ink-3">{waiting ?? "Not run for this pick."}</p>
        : payload !== undefined ? <OutputView payload={payload} />
        : task.error ? <p className="rounded-lg bg-bad-soft p-2 text-sm text-red-800">{task.error}</p>
        : <p className="text-sm text-ink-2">Working on it…</p>}
      {task && (task.status === "FAILED" || task.status === "QUEUED") && (
        <div className="flex gap-4">{task.status === "FAILED" ? <RetryButton taskId={task.id} /> : <ScrapButton taskId={task.id} />}</div>
      )}
      {task && <SendToFlow task={task} />}
    </section>
  );
}

type Sp = Record<string, string | undefined>;

/** "Make the production pack" links carry the form's values (e.g. creativeBriefId=…) next to the routing params. */
const ROUTE_KEYS = new Set(["role", "tab", "task", "new", "group", "pick", "q", "a", "b"]);
const prefillOf = (sp: Sp) => Object.fromEntries(Object.entries(sp).filter((e): e is [string, string] => !ROUTE_KEYS.has(e[0]) && typeof e[1] === "string"));

const FLOW_COPY: Record<FlowSlug, { label: string; run: string; empty: string; after?: { href: string; label: string } }> = {
  "production-pack": { label: "Visual direction (Art Director output)", run: "Run the other three", empty: "No production pack yet. Start one with New production pack." },
  "final-delivery": { label: "Campaign with clips", run: "Render and check", empty: "No delivery yet. Pick a campaign whose clips are uploaded.", after: { href: "/approval", label: "Go to Approval" } },
};

/** The role that starts a flow as a chain (its output becomes the pick of the others). */
const LEAD: Partial<Record<FlowSlug, { agentRole: string; slug: string; title: string }>> = {
  "production-pack": { agentRole: "artDirector", slug: "art-director", title: "New production pack" },
};

type Run = { key: string; at: Date; lead?: Task; steps: Task[] };

/** Production pack / Final delivery: one pick, each role's latest task on it side by side. */
export async function FlowFeature({ slug, sp }: { slug: FlowSlug; sp: Sp }) {
  const f = FLOWS[slug];
  const copy = FLOW_COPY[slug];
  const lead = LEAD[slug];
  const roles = f.steps.map((s) => s.agentRole as string);
  const [options, tasks, leads, form] = await Promise.all([
    refOptions(f.pick),
    db.agentTask.findMany({ where: { agentRole: { in: roles } }, orderBy: { createdAt: "desc" }, take: 80 }),
    lead ? db.agentTask.findMany({ where: { agentRole: lead.agentRole, thenRole: slug }, orderBy: { createdAt: "desc" }, take: 6 }) : [],
    lead ? taskFormProps(lead.agentRole) : null,
  ]);
  // Runs keyed by the pick (visual direction / campaign): every role of one run points at it. A lead task that is not
  // finished has no output yet, so it is keyed by its own id until it does.
  const runs = new Map<string, Run>();
  for (const l of leads) runs.set(l.artifactId ?? l.id, { key: l.artifactId ?? l.id, at: l.createdAt, lead: l, steps: [] });
  for (const t of tasks) {
    const id = (t.input as Record<string, unknown> | null)?.[f.field];
    if (typeof id !== "string") continue;
    const r = runs.get(id) ?? { key: id, at: t.createdAt, steps: [] };
    r.steps.push(t);
    if (t.createdAt > r.at) r.at = t.createdAt;
    runs.set(id, r);
  }
  const shown = [...runs.values()].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 6);
  const out = await payloads(shown.flatMap((r) => [...(r.lead ? [r.lead] : []), ...r.steps]));
  const label = (r: Run) => (r.lead ? taskTitle(r.lead.input) : options.find((o) => o.id === r.key)?.label ?? r.key);
  const picked = (r: Run) => r.key === sp.pick || r.lead?.id === sp.task || r.steps.some((t) => t.id === sp.task);

  return (
    <div className="space-y-6">
      {lead && form ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-2">The {roleByAgent(lead.agentRole)?.label} writes the visual direction; the others start on it automatically.</p>
            <Modal title={lead.title} defaultOpen={!!sp.new} className="btn-primary shrink-0" trigger={<><span className="material-symbols-outlined">add</span>{lead.title}</>}>
              <TaskForm slug={lead.slug} {...form} thenRole={slug} defaults={prefillOf(sp)} />
            </Modal>
          </div>
          <details className="rounded-2xl bg-canvas p-4">
            <summary className="cursor-pointer text-sm font-semibold">Already have a visual direction?</summary>
            <div className="mt-3"><FlowForm slug={slug} label={copy.label} options={options} defaultPick={sp.pick} runLabel={copy.run} /></div>
          </details>
        </div>
      ) : (
        <div className="rounded-2xl bg-canvas p-4"><FlowForm slug={slug} label={copy.label} options={options} defaultPick={sp.pick} runLabel={copy.run} /></div>
      )}
      {!shown.length && <Empty icon="inventory" text={copy.empty} />}
      {shown.map((r, i) => (
        <details key={r.key} open={picked(r) || (i === 0 && !shown.some(picked))}>
          <summary className="cursor-pointer font-bold">{label(r)} <span className="text-xs font-normal text-ink-2">· {when(r.at)}</span></summary>
          <div className="mt-3 space-y-3">
            {r.lead && <StepCard agentRole={r.lead.agentRole} task={r.lead} payload={r.lead.artifactId ? out.get(r.lead.artifactId) : undefined} />}
            {roles.map((role) => {
              const t = r.steps.find((x) => x.agentRole === role);
              return <StepCard key={role} agentRole={role} task={t} payload={t?.artifactId ? out.get(t.artifactId) : undefined} waiting={r.lead && !r.lead.artifactId ? `Starts when the ${roleByAgent(r.lead.agentRole)?.label} is done.` : undefined} />;
            })}
            {copy.after && r.steps.some((t) => t.status === "DONE") && <Link href={copy.after.href} className="btn-primary">{copy.after.label}</Link>}
          </div>
        </details>
      ))}
    </div>
  );
}

/** Concept: Account Manager writes the internal brief, the Creative Director continues on it automatically. */
export async function ConceptFeature({ sp }: { sp: Sp }) {
  const [form, briefs, concepts] = await Promise.all([
    taskFormProps("accountManager"),
    db.agentTask.findMany({ where: { agentRole: "accountManager", thenRole: "creativeDirector" }, orderBy: { createdAt: "desc" }, take: 6 }),
    db.agentTask.findMany({ where: { agentRole: "creativeDirector", requestedByRole: "accountManager" }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const conceptOf = (b: Task) => (b.artifactId ? concepts.find((c) => (c.input as { internalBriefId?: string }).internalBriefId === b.artifactId) : undefined);
  const out = await payloads([...briefs, ...briefs.map(conceptOf).filter((c): c is Task => !!c)]);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-2">The Account Manager turns your idea into a brief; the Creative Director then writes three concepts and picks one.</p>
        <Modal title="New concept" className="btn-primary shrink-0" trigger={<><span className="material-symbols-outlined">add</span>New concept</>}>
          <TaskForm slug="account-manager" {...form} thenRole="creativeDirector" />
        </Modal>
      </div>
      {!briefs.length && <Empty icon="tips_and_updates" text="No concept yet. Start one with New concept." />}
      {briefs.map((b, i) => {
        const c = conceptOf(b);
        const open = sp.task ? sp.task === b.id || sp.task === c?.id : i === 0;
        const brief = b.input as { product?: string; audience?: string };
        const next = c?.artifactId && new URLSearchParams({ new: "1", creativeBriefId: c.artifactId, product: brief.product ?? "", audience: brief.audience ?? "" });
        return (
          <details key={b.id} open={open}>
            <summary className="cursor-pointer font-bold">{taskTitle(b.input)} <span className="text-xs font-normal text-ink-2">· {when(b.createdAt)}</span></summary>
            <div className="mt-3 space-y-3">
              <StepCard agentRole="accountManager" task={b} payload={b.artifactId ? out.get(b.artifactId) : undefined} />
              <StepCard agentRole="creativeDirector" task={c} payload={c?.artifactId ? out.get(c.artifactId) : undefined} waiting={b.artifactId ? undefined : "Starts when the Account Manager is done."} />
              {next && (
                <Link href={`/boards/feature/production-pack?${next}`} className="btn-primary">
                  <span className="material-symbols-outlined">arrow_forward</span>Make the production pack
                </Link>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** Talent hand-off: the Content Creator asks, the Talent Manager answers, the owner locks. One board for both. */
export async function TalentBoard() {
  const [campaigns, requests, characters] = await Promise.all([
    db.campaign.findMany({ where: { status: { notIn: ["REJECTED", "EXPIRED", "FAILED", "PUBLISHED"] } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, clientBrief: true } }),
    db.agentTask.findMany({ where: { agentRole: "talentManager" }, orderBy: [{ status: "desc" }, { createdAt: "desc" }], take: 20 }),
    db.creativeAsset.findMany({ where: { kind: "character" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const waiting = requests.filter((t) => t.status === "WAITING");
  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="ask-h" className="space-y-3">
          <h2 id="ask-h" className="text-lg font-bold">1 · Content Creator asks</h2>
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
        </section>

        <section aria-labelledby="req-h" className="space-y-3">
          <h2 id="req-h" className="text-lg font-bold">2 · Talent Manager answers ({waiting.length} open)</h2>
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
                  <p className="text-amber-800">Answered with <span className="font-semibold">{answer.name}</span>. 3 · Lock it in the characters below to hand it over.</p>
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
        </section>
      </div>
      <HandoffList tasks={requests.filter((t) => t.status !== "WAITING")} />
      <CreatorLibrary kinds={["character"]} />
    </div>
  );
}

/** Hand-off history: who asked, who did it, result. */
function HandoffList({ tasks }: { tasks: Task[] }) {
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

/** The feature component for a slug (feature page and role dialog tab). `base` = this place's URL, ending in ? or &. */
export function Feature({ slug, sp, base }: { slug: string; sp: Sp; base: string }) {
  if (slug === "execution-queue") return <ExecutionQueue />;
  if (slug === "text-posts") return <TextPosts taskId={sp.task} href={(id) => `${base}task=${id}`} />;
  if (slug === "concept") return <ConceptFeature sp={sp} />;
  if (slug === "talent") return <TalentBoard />;
  if (slug in FLOWS) return <FlowFeature slug={slug as FlowSlug} sp={sp} />;
  return null;
}
