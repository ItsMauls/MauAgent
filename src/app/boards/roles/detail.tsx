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
import { initials, RoleAvatar, STATE_PILL } from "../cards";
import { ProfileModal } from "../profile";
import { profileOf } from "@/lib/agents/profiles";
import { ScrapButton } from "../task-form";
import { AgentChat } from "../chat";
import type { WorkColumn, WorkItem } from "@/lib/boards/status";

export const dynamic = "force-dynamic";

type Tab = "chat" | "memory" | "focus" | "artifacts";
const TAB_LABEL: Record<Tab, string> = {
  focus: "Current focus",
  chat: "Chat",
  artifacts: "Artifacts",
  memory: "Memory",
};

const TAB_ICON: Record<Tab, string> = {
  focus: "center_focus_strong", chat: "chat", artifacts: "inventory_2", memory: "neurology",
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
  const tabs: Tab[] = [...(llmRole ? (["chat", "memory"] as const) : []), "focus", "artifacts"];
  const features = FEATURES.filter((f) => (f.roles as readonly string[]).includes(role.slug));
  const tab: Tab = tabs.includes(sp.tab as Tab) ? (sp.tab as Tab) : tabs[0];

  const [persona, exp, work] = await Promise.all([
    isAgentRole(role.agentRole) ? getPersona(role.agentRole).then((p) => p.persona) : null,
    isAgentRole(role.agentRole) ? agentExperience().then((e) => e[role.agentRole as keyof typeof e]) : null,
    boardSnapshot().then((s) => roleWork(role.agentRole, s)),
  ]);
  const name = persona?.nickname ?? profileOf(role.agentRole)?.name ?? role.label;
  const [stateLabel, stateCls] = STATE_PILL[work.state];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="card flex shrink-0 flex-wrap items-center gap-5 p-6">
        <ProfileModal agentRole={role.agentRole} className="shrink-0 rounded-full" trigger={<RoleAvatar role={role.agentRole} className="h-16 w-16" />} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
            <span className={`pill ${stateCls}`}>{stateLabel}</span>
            {exp && <span className="pill border-violet-200 bg-agent-soft text-violet-700">{exp.level}</span>}
          </div>
          <p className="text-sm font-semibold text-ink-2">
            <span className="material-symbols-outlined !text-[16px] align-[-3px]">{role.icon}</span> {role.label}
          </p>
          <p className="mt-1 text-sm text-ink-2">{persona?.communicationStyle ?? role.blurb}</p>
          {features.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-ink-2">Works in</span>
              {features.map((f) => (
                <Link key={f.slug} href={`/boards/feature/${f.slug}`} className="flex items-center gap-1 rounded-full bg-canvas px-2.5 py-1 font-semibold text-brand hover:bg-brand-soft">
                  <span className="material-symbols-outlined !text-[14px]">{f.icon}</span>{f.label}
                </Link>
              ))}
            </p>
          )}
        </div>
        {exp && (
          <dl className="grid grid-cols-2 gap-x-6 text-sm">
            <dt className="text-ink-2">Delivered</dt><dd className="font-semibold">{exp.delivered}</dd>
            <dt className="text-ink-2">First-pass rate</dt><dd className="font-semibold">{Math.round(exp.firstPassRate * 100)}%</dd>
          </dl>
        )}
      </header>

      {persona && (
        <details className="card shrink-0 px-6 py-3 text-sm">
          <summary className="cursor-pointer font-semibold">Persona <span className="font-normal text-ink-2">· values, strengths, blind spots</span></summary>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2">
          {([["Values", persona.values], ["Strengths", persona.strengths], ["Blind spots", persona.blindSpots], ["Non-negotiables", persona.nonNegotiables]] as const).map(([k, v]) => (
            <div key={k}>
              <dt className="label">{k}</dt>
              <dd className="text-ink-2">{v.join(" · ") || "-"}</dd>
            </div>
          ))}
          </dl>
        </details>
      )}

      <nav aria-label={`${role.label} sections`} className="quiet-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-line">
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

      <section className="quiet-scroll card min-h-0 flex-1 overflow-y-auto p-6">
        {tab === "artifacts" && <ArtifactsPanel role={role} q={sp.q?.trim() || undefined} a={sp.a} b={sp.b} />}
        {tab === "memory" && <MemoryPanel role={role} />}
        {tab === "chat" && <AgentChat slug={role.slug} name={name} initials={initials(name)} />}
        {tab === "focus" && <Kanban items={work.items} name={name} />}
      </section>
    </div>
  );
}
