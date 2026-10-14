import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/lib/db";
import { ROLES, roleByAgent } from "@/lib/boards/roles";
import { agentNames, boardSnapshot } from "@/lib/boards/snapshot";
import { roleWork, type AgentState } from "@/lib/boards/status";
import { agentExperience, revisedRole } from "@/lib/agents/memory";
import { CreativeBrief } from "@/lib/agents/schemas";
import { formatDuration } from "@/lib/status";
import { StatusPill } from "../pills";
import { CardError, load, RoleAvatar, STATE_PILL } from "./cards";
import { FeedbackForm } from "./feedback";
import { CircleSelect, SessionSlider } from "./modal";
import { chosenConcept } from "./outputs";

const product = (b: unknown, id: string) => (b as { product?: string }).product ?? id;
const DELIVERED = ["APPROVED", "PUBLISHED"] as const;
const RING: Record<AgentState, string> = { busy: "ring-emerald-300", waiting: "ring-amber-300", idle: "ring-slate-200" };

// ---------- C. Team focus (lives inside the session modal, one circle per agent) ----------

async function TeamCircles() {
  const r = await load(async () => {
    const [snap, names, exp, delivered, handoffs, feedback] = await Promise.all([
      boardSnapshot(),
      agentNames(),
      agentExperience(),
      db.campaign.findMany({
        where: { status: { in: [...DELIVERED] } },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true, status: true, clientBrief: true,
          artifacts: { select: { agentRole: true }, distinct: ["agentRole"] },
          decisions: { select: { type: true, targetAgent: true, notes: true } },
          _count: { select: { shots: true, publishJobs: { where: { status: "published" } } } },
        },
      }),
      // Hand-offs another agent finished for this one in the last 7 days (e.g. talent ready for the Content Creator).
      db.agentTask.findMany({
        where: { requestedByRole: { not: null }, status: "DONE", updatedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
        orderBy: { updatedAt: "desc" },
        select: { id: true, agentRole: true, requestedByRole: true, artifactId: true },
      }),
      db.agentFeedback.findMany({ orderBy: { createdAt: "desc" }, distinct: ["agentRole"], select: { agentRole: true, text: true, sentiment: true } }),
    ]);
    const results = await db.artifact.findMany({ where: { id: { in: handoffs.flatMap((h) => h.artifactId ?? []) } }, select: { id: true, payload: true } });
    return ROLES.map((role) => {
      const work = roleWork(role.agentRole, snap);
      const last = delivered.find((c) => c.artifacts.some((a) => a.agentRole === role.agentRole) || (role.agentRole === "videographer" && c._count.shots > 0));
      const revs = last ? last.decisions.filter((d) => revisedRole(d) === role.agentRole).length : 0;
      const done = handoffs.filter((h) => h.requestedByRole === role.agentRole).map((h) => ({
        id: h.id,
        from: roleByAgent(h.agentRole)?.label ?? h.agentRole,
        what: (results.find((a) => a.id === h.artifactId)?.payload as { name?: string } | undefined)?.name ?? "done",
      }));
      return {
        role, work, done, name: names[role.agentRole],
        feedback: feedback.find((f) => f.agentRole === role.agentRole),
        level: (exp as Record<string, { level: string }>)[role.agentRole]?.level,
        last: last && {
          id: last.id,
          title: product(last.clientBrief, last.id),
          result: `${last.status === "PUBLISHED" ? `Published to ${last._count.publishJobs} account${last._count.publishJobs === 1 ? "" : "s"}` : "Approved"}, ${revs ? `after ${revs} revision${revs > 1 ? "s" : ""}` : "first pass"}`,
        },
      };
    });
  });
  if (!r.ok) return <CardError title="Team focus" className="!shadow-none" />;

  return (
    <section aria-labelledby="team-h" className="space-y-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="team-h" className="font-bold">Team focus</h3>
        <p className="text-sm text-ink-2">
          {r.data.filter((x) => x.work.state === "busy").length} busy · {r.data.filter((x) => x.work.state === "waiting").length} waiting
        </p>
      </div>
      <CircleSelect
        items={r.data.map(({ role, work, done, name, level, last, feedback }) => {
          const [label, cls] = STATE_PILL[work.state];
          return {
            key: role.slug,
            label: name,
            circle: (
              <span key={role.slug} className={`flex h-16 w-16 items-center justify-center rounded-full bg-agent-soft text-base font-bold text-violet-700 ring-4 transition group-aria-pressed:ring-brand ${RING[work.state]}`}>
                <RoleAvatar role={role.agentRole} className="h-full w-full" />
                <span className="sr-only">, {label}</span>
              </span>
            ),
            panel: (
              <div key={role.slug} className="space-y-3 rounded-3xl border border-line bg-canvas p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/boards/${role.slug}`} className="block truncate font-bold hover:underline">{name}</Link>
                    <p className="truncate text-xs text-ink-2">{role.label}{level && ` · ${level}`}</p>
                  </div>
                  <span className={`pill ${cls}`}>{label}</span>
                </div>

                {done.length > 0 && (
                  <Link href={`/boards/feature/talent`} role="status" className="block rounded-xl bg-ok-soft px-3 py-2 text-xs font-semibold text-emerald-800 hover:underline">
                    <span className="material-symbols-outlined !text-[14px] align-[-2px]">notifications_active</span> {done[0].from}: {done[0].what} is ready{done.length > 1 && ` (+${done.length - 1})`}
                  </Link>
                )}

                <div>
                  <p className="label !mb-1">Working on</p>
                  {work.items.length ? (
                    <ul className="space-y-1 text-sm">
                      {work.items.slice(0, 3).map((i) => (
                        <li key={i.key}>
                          <Link href={i.href} className="flex justify-between gap-2 rounded-xl bg-white px-3 py-1.5 hover:bg-brand-soft">
                            <span className="min-w-0 truncate"><span className="font-semibold">{i.title}</span> <span className="text-ink-2">· {i.stage}</span></span>
                            <span className="shrink-0 text-xs text-ink-2">{formatDuration(Date.now() - i.since.getTime())}</span>
                          </Link>
                        </li>
                      ))}
                      {work.items.length > 3 && <li className="px-3 text-xs font-semibold text-ink-2">+{work.items.length - 3} more</li>}
                    </ul>
                  ) : (
                    <p className="text-sm text-ink-3">Nothing in progress.</p>
                  )}
                </div>

                <div>
                  <p className="label !mb-1">Last success</p>
                  {last ? (
                    <Link href={`/campaigns/${last.id}`} className="block text-sm hover:underline">
                      <span className="font-semibold">{last.title}</span> <span className="text-ink-2">· {last.result}</span>
                    </Link>
                  ) : (
                    <p className="text-sm text-ink-3">No delivered campaign yet.</p>
                  )}
                </div>

                <div>
                  <p className="label !mb-1">Latest feedback</p>
                  {feedback ? (
                    <p className="text-sm">
                      <span aria-label={feedback.sentiment} className={`material-symbols-outlined !text-[14px] align-[-2px] ${feedback.sentiment === "positive" ? "text-emerald-700" : feedback.sentiment === "negative" ? "text-red-700" : "text-ink-2"}`}>
                        {feedback.sentiment === "positive" ? "thumb_up" : feedback.sentiment === "negative" ? "thumb_down" : "remove"}
                      </span>{" "}
                      <q className="italic text-ink-2">{feedback.text.length > 90 ? `${feedback.text.slice(0, 89)}…` : feedback.text}</q>{" "}
                      <Link href={`/boards/${role.slug}?tab=results`} className="whitespace-nowrap text-xs font-semibold text-brand">See all</Link>
                    </p>
                  ) : (
                    <p className="text-sm text-ink-3">None yet.</p>
                  )}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-brand">Give feedback</summary>
                    <div className="mt-2"><FeedbackForm agentRole={role.agentRole} compact /></div>
                  </details>
                </div>
              </div>
            ),
          };
        })}
      />
    </section>
  );
}

// ---------- E. Agent sessions ----------

const RUN_STATUS: Record<string, [string, string]> = {
  running: ["Running", "border-emerald-200 bg-ok-soft text-emerald-800"],
  done: ["Complete", "border-blue-200 bg-brand-soft text-brand-dark"],
  failed: ["Failed", "border-red-200 bg-bad-soft text-red-800"],
  superseded: ["Superseded", "border-slate-200 bg-slate-50 text-slate-700"],
};
const runPill = (status: string) => RUN_STATUS[status] ?? [status, "border-slate-200 bg-slate-50 text-slate-700"];

const runSelect = {
  id: true, status: true, startedAt: true, endedAt: true,
  steps: { orderBy: { startedAt: "asc" as const }, select: { agentRole: true, status: true } },
  campaign: { select: { id: true, status: true, clientBrief: true, artifacts: { where: { agentRole: "creativeDirector" }, orderBy: { version: "desc" as const }, take: 1, select: { payload: true } } } },
};

/** No Deliberation entity exists yet, so a "session" is a pipeline Run: its agents are the participants. Several live runs auto-slide. */
export async function SessionsCard() {
  const r = await load(async () => {
    const [live, recent, names] = await Promise.all([
      db.run.findMany({ where: { status: "running" }, orderBy: { startedAt: "desc" }, take: 6, select: runSelect }),
      db.run.findMany({ where: { status: { not: "running" } }, orderBy: { startedAt: "desc" }, take: 5, select: runSelect }),
      agentNames(),
    ]);
    return { live, recent, names };
  });
  if (!r.ok) return <CardError title="Agent sessions" className="h-full" />;
  const { live, recent, names } = r.data;
  const shown = live.length ? live : recent.slice(0, 1); // no live session: show the last one
  const all = [...live, ...recent];

  return (
    <section aria-labelledby="ses-h" className="card flex h-full flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="ses-h" className="label !mb-0">Agent sessions</h2>
        <span className={`pill ${live.length ? "border-emerald-200 bg-ok-soft text-emerald-800" : "border-line bg-canvas text-ink-2"}`}>
          {live.length ? `${live.length} live` : "None live"}
        </span>
      </div>

      {!shown.length ? (
        <p className="rounded-2xl bg-canvas p-6 text-center text-sm text-ink-2">No agent session yet. A session starts when a brief or a revision runs the pipeline.</p>
      ) : (
        <SessionSlider
          slides={shown.map((run) => ({
            key: run.id,
            title: product(run.campaign.clientBrief, run.campaign.id),
            body: <SessionSummary run={run} names={names} isLive={live.length > 0} />,
            detail: <SessionDetail run={run} />,
          }))}
          shared={
            <>
              <AllSessions runs={all} />
              <Suspense fallback={<div className="h-24 animate-pulse rounded-2xl bg-canvas" aria-label="Loading team focus" />}>
                <TeamCircles />
              </Suspense>
            </>
          }
        />
      )}
    </section>
  );
}

type RunRow = {
  id: string; status: string; startedAt: Date; endedAt: Date | null;
  steps: { agentRole: string; status: string }[];
  campaign: { id: string; status: string; clientBrief: unknown; artifacts: { payload: unknown }[] };
};

const tile = "rounded-2xl bg-canvas px-4 py-3";
const fmt = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const roomOf = (run: RunRow) => `/campaigns/workflow?filter=all&campaign=${run.campaign.id}`;
const speakingOf = (run: RunRow) => run.steps.findLast((s) => s.status === "running")?.agentRole;
function chosenOf(run: RunRow) {
  const cb = CreativeBrief.safeParse(run.campaign.artifacts[0]?.payload);
  return cb.success ? { cb: cb.data, chosen: chosenConcept(cb.data) } : null;
}

function SessionSummary({ run, names, isLive }: { run: RunRow; names: Record<string, string>; isLive: boolean }) {
  const roles = [...new Set(run.steps.map((s) => s.agentRole))];
  const speaking = speakingOf(run);
  const c = chosenOf(run);
  const title = product(run.campaign.clientBrief, run.campaign.id);
  const [statusLabel, statusCls] = runPill(run.status);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-2xl font-bold tracking-tight">{title}</h3>
        <span className={`pill shrink-0 ${statusCls}`}>{statusLabel}</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-3">
          <div className={tile}>
            <p className="label">Guests ({roles.length})</p>
            <ul className="flex flex-wrap gap-2">
              {roles.map((role) => (
                <li key={role}>
                  <span tabIndex={0} className="group relative block outline-none" aria-label={`${names[role] ?? role}, ${roleByAgent(role)?.label ?? role}${role === speaking ? ", speaking" : ""}`}>
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-agent-soft text-xs font-bold text-violet-700 ring-2 ring-white group-focus-visible:ring-brand">
                      <RoleAvatar role={role} className="h-full w-full" />
                    </span>
                    {role === speaking && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-ok" />}
                    <span role="tooltip" className="pointer-events-none absolute -top-9 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white group-hover:block group-focus-visible:block">
                      {roleByAgent(role)?.label ?? role}
                    </span>
                  </span>
                </li>
              ))}
              {!roles.length && <li className="text-sm text-ink-3">Starting…</li>}
            </ul>
          </div>

          <div className={tile}>
            <p className="label">Where</p>
            <Link href={roomOf(run)} className="flex items-center justify-between gap-2 text-sm font-semibold hover:underline">
              <span className="truncate">Meeting room · {title}</span>
              <span className="material-symbols-outlined text-ink-3">headset_mic</span>
            </Link>
          </div>
        </div>

        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-3">
            {([["From", fmt(run.startedAt)], ["To", run.endedAt ? fmt(run.endedAt) : "Ongoing"]] as const).map(([k, v]) => (
              <div key={k} className={tile}>
                <dt className="label">{k}</dt>
                <dd className="flex items-center gap-2 text-sm font-semibold"><span className="material-symbols-outlined !text-[16px] text-ink-3">schedule</span>{v}</dd>
              </div>
            ))}
          </dl>

          <div className={tile}>
            <p className="label">Description</p>
            <p className="line-clamp-2 text-sm">
              {c?.chosen ? `Adopted concept: ${c.chosen.title}.` : `Pipeline run ${statusLabel.toLowerCase()}.`} {!isLive && "This was the last session."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Modal part for the slide on screen. */
function SessionDetail({ run }: { run: RunRow }) {
  const speaking = speakingOf(run);
  const c = chosenOf(run);
  const [statusLabel, statusCls] = runPill(run.status);
  const done = run.steps.filter((s) => s.status === "done").length;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
        <span className={`pill ${statusCls}`}>{statusLabel}</span>
        <StatusPill status={run.campaign.status} />
        {speaking && <span>Now: {roleByAgent(speaking)?.label ?? speaking}</span>}
        <span>{fmt(run.startedAt)} → {run.endedAt ? fmt(run.endedAt) : "ongoing"}</span>
        <span>{done}/{run.steps.length} steps done</span>
      </div>
      {c?.chosen && (
        <div className="rounded-2xl bg-canvas p-3 text-sm">
          <p><span className="font-semibold text-emerald-700">Adopted:</span> {c.chosen.title}</p>
          <p className="text-ink-2"><span className="font-semibold">Skipped:</span> {c.cb.conceptOptions.filter((o) => o !== c.chosen).map((o) => o.title).join(", ")}</p>
        </div>
      )}
      <Link href={roomOf(run)} className="btn-primary w-full">
        <span className="material-symbols-outlined">meeting_room</span>Enter meeting room
      </Link>
    </>
  );
}

/** Every recent session at a glance: running, complete, failed, superseded. */
function AllSessions({ runs }: { runs: RunRow[] }) {
  return (
    <section aria-labelledby="all-ses-h" className="space-y-2 border-t border-line pt-4">
      <h3 id="all-ses-h" className="font-bold">All sessions ({runs.length})</h3>
      <ul className="space-y-1.5">
        {runs.map((run) => {
          const [label, cls] = runPill(run.status);
          return (
            <li key={run.id}>
              <Link href={roomOf(run)} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-canvas px-3 py-2 text-sm hover:bg-brand-soft">
                <span className="min-w-0 flex-1 truncate font-semibold">{product(run.campaign.clientBrief, run.campaign.id)}</span>
                <span className={`pill ${cls}`}>{label}</span>
                <span className="text-xs text-ink-2">{new Set(run.steps.map((s) => s.agentRole)).size} agents · {fmt(run.startedAt)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
