import Link from "next/link";
import { notFound } from "next/navigation";
import { roleBySlug } from "@/lib/boards/roles";
import { boardSnapshot } from "@/lib/boards/snapshot";
import { roleWork } from "@/lib/boards/status";
import { formatDuration } from "@/lib/status";
import { getPersona, isAgentRole } from "@/lib/agents/persona";
import { agentExperience } from "@/lib/agents/memory";
import { Empty } from "../../campaigns/[id]/shots";
import { ArtifactsPanel, MemoryPanel } from "../workspace";
import { FEATURES } from "../feature/features";
import { avatarUrl, initials, RoleAvatar, STATE_PILL } from "../cards";
import { ProfileBody } from "../profile";
import { profileOf, VOICES } from "@/lib/agents/profiles";
import { ScrapButton } from "../task-form";
import { AgentChat } from "../chat";
import type { WorkColumn, WorkItem } from "@/lib/boards/status";

export const dynamic = "force-dynamic";

type Tab = "info" | "chat" | "memory" | "focus" | "artifacts";
const TAB_LABEL: Record<Tab, string> = {
  info: "Info",
  focus: "Current focus",
  chat: "Chat",
  artifacts: "Artifacts",
  memory: "Memory",
};

const TAB_ICON: Record<Tab, string> = {
  info: "badge", focus: "center_focus_strong", chat: "chat", artifacts: "inventory_2", memory: "neurology",
};

const COLUMNS: { key: WorkColumn; title: string; icon: string; hint: string }[] = [
  { key: "queued", title: "Queued", icon: "schedule", hint: "Not started. Scrap one to stop a worker from picking it up." },
  { key: "working", title: "Working", icon: "bolt", hint: "Running now." },
  { key: "waiting", title: "Waiting", icon: "hourglass_top", hint: "Parked at a gate or for another agent." },
];

function Kanban({ items, name }: { items: WorkItem[]; name: string }) {
  if (!items.length) return <Empty icon="coffee" text={`${name} is idle: no campaign or task in progress.`} />;
  return (
    <div className="grid h-full gap-4 md:grid-cols-3 md:grid-rows-[minmax(0,1fr)]">
      {COLUMNS.map((c) => {
        const col = items.filter((i) => i.column === c.key);
        return (
          <section key={c.key} aria-label={c.title} className="flex min-h-0 flex-col rounded-2xl bg-canvas p-3">
            <h3 className="mb-3 flex shrink-0 items-center gap-1.5 px-1 text-sm font-bold">
              <span className="material-symbols-outlined !text-[18px] text-ink-2">{c.icon}</span>{c.title}
              <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs text-ink-2">{col.length}</span>
            </h3>
            <ul className="quiet-scroll min-h-0 flex-1 space-y-2 overflow-y-auto">
              {col.map((i) => (
                <li key={i.key} className="rounded-xl border border-line bg-white p-3 text-sm shadow-sm">
                  <Link href={i.href} className="block hover:text-brand">
                    <span className="line-clamp-2 font-semibold">{i.title}</span>
                    <span className="mt-1 flex items-center justify-between gap-2 text-xs text-ink-2">
                      <span className="truncate">{i.stage}</span>
                      <span className="shrink-0">{formatDuration(Date.now() - i.since.getTime())}</span>
                    </span>
                  </Link>
                  {i.column === "queued" && i.taskId && <div className="mt-2 border-t border-line pt-2"><ScrapButton taskId={i.taskId} /></div>}
                </li>
              ))}
              {!col.length && <li className="px-1 py-4 text-center text-xs text-ink-3">{c.hint}</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Character detail, rendered inside the dialog of /boards/roles. */
export async function RoleDetail({ slug, sp }: { slug: string; sp: Record<string, string | undefined> }) {
  const role = roleBySlug(slug);
  if (!role) notFound();
  const llmRole = isAgentRole(role.agentRole);
  // The agent dialog is for information (and chat); the work itself starts from the features in the sidebar.
  const tabs: Tab[] = ["info", ...(llmRole ? (["chat"] as const) : []), "focus", "artifacts", ...(llmRole ? (["memory"] as const) : [])];
  const features = FEATURES.filter((f) => (f.roles as readonly string[]).includes(role.slug));
  const tab: Tab = tabs.includes(sp.tab as Tab) ? (sp.tab as Tab) : tabs[0];

  const [persona, exp, work] = await Promise.all([
    isAgentRole(role.agentRole) ? getPersona(role.agentRole).then((p) => p.persona) : null,
    isAgentRole(role.agentRole) ? agentExperience().then((e) => e[role.agentRole as keyof typeof e]) : null,
    boardSnapshot().then((s) => roleWork(role.agentRole, s)),
  ]);
  const prof = profileOf(role.agentRole);
  const name = persona?.nickname ?? profileOf(role.agentRole)?.name ?? role.label;
  const [stateLabel, stateCls] = STATE_PILL[work.state];

  return (
    <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="card flex flex-col gap-3 p-4">
        <RoleAvatar role={role.agentRole} className="mx-auto size-44 shadow-card" />
        <div className="text-center">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
            <span className={`pill ${stateCls}`}>{stateLabel}</span>
          </div>
          <p className="text-sm font-semibold text-ink-2">
            <span className="material-symbols-outlined !text-[16px] align-[-3px]">{role.icon}</span> {role.label}
          </p>
          {exp && <span className="pill mx-auto mt-2 border-violet-200 bg-agent-soft text-violet-700">{exp.level}</span>}
        </div>
        {exp && (
          <dl className="grid grid-cols-2 gap-x-4 text-sm">
            <dt className="text-ink-2">Delivered</dt><dd className="text-right font-semibold">{exp.delivered}</dd>
            <dt className="text-ink-2">First-pass rate</dt><dd className="text-right font-semibold">{Math.round(exp.firstPassRate * 100)}%</dd>
          </dl>
        )}
        <dl className="grid grid-cols-3 gap-2 text-center text-xs">
          {([["Queued", work.items.filter((i) => i.column === "queued").length], ["Working", work.items.filter((i) => i.column === "working").length], ["Waiting", work.items.filter((i) => i.column === "waiting").length]] as const).map(([k, n]) => (
            <div key={k} className="rounded-xl bg-canvas py-2"><dd className="text-lg font-bold">{n}</dd><dt className="text-ink-2">{k}</dt></div>
          ))}
        </dl>
        {prof && (
          <div>
            <h2 className="label">Top skills</h2>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {prof.skills.slice(0, 5).map((k) => <li key={k} className="rounded-full bg-canvas px-2.5 py-1 text-xs font-semibold text-ink-2">{k}</li>)}
            </ul>
          </div>
        )}
        {features.length > 0 && (
          <div>
            <h2 className="label">Works in</h2>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {features.map((f) => (
                <li key={f.slug}>
                  <Link href={`/boards/feature/${f.slug}`} className="flex items-center gap-1 rounded-full bg-canvas px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand-soft">
                    <span className="material-symbols-outlined !text-[14px]">{f.icon}</span>{f.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <div className="card flex min-h-0 flex-col overflow-hidden">
      <nav aria-label={`${role.label} sections`} className="quiet-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-line px-4">
        {tabs.map((t) => (
          <Link
            key={t}
            href={`/boards/roles?role=${role.slug}&tab=${t}${sp.group ? `&group=${sp.group}` : ""}`}
            scroll={false}
            aria-current={t === tab ? "page" : undefined}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${t === tab ? "border-brand text-brand" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            <span className="material-symbols-outlined !text-[18px]">{TAB_ICON[t]}</span>
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>

      <section className="quiet-scroll min-h-0 flex-1 overflow-y-auto p-6">
        {tab === "info" && (
          <div className="space-y-5">
            {persona ? (
              <dl className="grid gap-3 sm:grid-cols-2">
                {([["Values", "favorite", persona.values], ["Strengths", "military_tech", persona.strengths], ["Blind spots", "visibility_off", persona.blindSpots], ["Non-negotiables", "block", persona.nonNegotiables]] as const).map(([k, icon, v]) => (
                  <div key={k} className="rounded-2xl border border-line p-3">
                    <dt className="label flex items-center gap-1.5"><span className="material-symbols-outlined !text-[16px]">{icon}</span>{k}</dt>
                    <dd>
                      <ul className="mt-2 space-y-1.5 text-sm text-ink-2">
                        {v.length ? v.map((x) => <li key={x} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />{x}</li>) : <li>-</li>}
                      </ul>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : <p className="text-sm text-ink-2">{role.blurb}</p>}
            <ProfileBody agentRole={role.agentRole} />
          </div>
        )}
        {tab === "artifacts" && <ArtifactsPanel role={role} q={sp.q?.trim() || undefined} a={sp.a} b={sp.b} />}
        {tab === "memory" && <MemoryPanel role={role} />}
        {tab === "chat" && <AgentChat slug={role.slug} name={name} initials={initials(name)} greeting={VOICES[role.agentRole]?.greeting ?? "Hai! Ada yang bisa gue bantu?"} avatar={avatarUrl(role.agentRole)} />}
        {tab === "focus" && <Kanban items={work.items} name={name} />}
      </section>
      </div>
    </div>
  );
}
