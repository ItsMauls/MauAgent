import Link from "next/link";
import { notFound } from "next/navigation";
import { roleBySlug, type RoleTab } from "@/lib/boards/roles";
import { boardSnapshot } from "@/lib/boards/snapshot";
import { roleWork } from "@/lib/boards/status";
import { formatDuration } from "@/lib/status";
import { getPersona, isAgentRole } from "@/lib/agents/persona";
import { agentExperience } from "@/lib/agents/memory";
import AccountsPage from "../../accounts/page";
import { Empty } from "../../campaigns/[id]/shots";
import { CreatorLibrary } from "../library";
import { ArtifactsPanel, ExecutionQueue, MemoryPanel, QuickTask, ReadyTalent, ResultsPanel, Schedule, TalentRequests } from "../workspace";
import { TASKS } from "@/lib/boards/tasks";
import { initials, STATE_PILL } from "../cards";

export const dynamic = "force-dynamic";

type Tab = "task" | "focus" | RoleTab | "results" | "artifacts" | "memory";
const TAB_LABEL: Record<Tab, string> = {
  task: "Quick task",
  focus: "Current focus",
  results: "Results & feedback",
  artifacts: "Artifacts",
  memory: "Memory",
  accounts: "Accounts",
  ready: "Ready talent",
  queue: "Execution queue",
  schedule: "Schedule & publishing",
  library: "Library",
  talent: "Talent",
};

/** Character detail, rendered inside the dialog of /boards/roles. */
export async function RoleDetail({ slug, sp }: { slug: string; sp: Record<string, string | undefined> }) {
  const role = roleBySlug(slug);
  if (!role) notFound();
  const llmRole = isAgentRole(role.agentRole);
  const tabs: Tab[] = [
    ...(TASKS[role.agentRole] ? (["task"] as const) : []),
    ...role.tabs.filter((t) => t === "queue"),
    ...(llmRole ? (["memory"] as const) : []),
    "focus",
    ...role.tabs.filter((t) => t !== "queue"),
    "results",
    "artifacts",
  ];
  const tab: Tab = tabs.includes(sp.tab as Tab) ? (sp.tab as Tab) : tabs[0];

  const [persona, exp, work] = await Promise.all([
    isAgentRole(role.agentRole) ? getPersona(role.agentRole).then((p) => p.persona) : null,
    isAgentRole(role.agentRole) ? agentExperience().then((e) => e[role.agentRole as keyof typeof e]) : null,
    boardSnapshot().then((s) => roleWork(role.agentRole, s)),
  ]);
  const name = persona?.nickname ?? role.label;
  const [stateLabel, stateCls] = STATE_PILL[work.state];

  return (
    <div className="space-y-6">
      <header className="card flex flex-wrap items-center gap-5 p-6">
        <span aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-agent-soft text-xl font-bold text-violet-700">{initials(name)}</span>
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
        </div>
        {exp && (
          <dl className="grid grid-cols-2 gap-x-6 text-sm">
            <dt className="text-ink-2">Delivered</dt><dd className="font-semibold">{exp.delivered}</dd>
            <dt className="text-ink-2">First-pass rate</dt><dd className="font-semibold">{Math.round(exp.firstPassRate * 100)}%</dd>
          </dl>
        )}
      </header>

      {persona && (
        <dl className="card grid gap-4 p-6 text-sm sm:grid-cols-2">
          {([["Values", persona.values], ["Strengths", persona.strengths], ["Blind spots", persona.blindSpots], ["Non-negotiables", persona.nonNegotiables]] as const).map(([k, v]) => (
            <div key={k}>
              <dt className="label">{k}</dt>
              <dd className="text-ink-2">{v.join(" · ") || "-"}</dd>
            </div>
          ))}
        </dl>
      )}

      <nav aria-label={`${role.label} sections`} className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t}
            href={`/boards/roles?role=${role.slug}&tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${t === tab ? "bg-brand text-white" : "bg-white text-ink-2 hover:bg-brand-soft"}`}
          >
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>

      <section className={tab === "accounts" ? "" : "card p-6"}>
        {tab === "task" && <QuickTask role={role} taskId={sp.task} />}
        {tab === "artifacts" && <ArtifactsPanel role={role} q={sp.q?.trim() || undefined} a={sp.a} b={sp.b} />}
        {tab === "memory" && <MemoryPanel role={role} />}
        {tab === "results" && <ResultsPanel role={role} />}
        {tab === "focus" &&
          (work.items.length ? (
            <ul className="space-y-2">
              {work.items.map((i) => (
                <li key={i.key}>
                  <Link href={i.href} className="flex flex-wrap items-center gap-3 rounded-2xl bg-canvas p-4 hover:bg-brand-soft">
                    <span className={`pill ${STATE_PILL[i.state][1]}`}>{STATE_PILL[i.state][0]}</span>
                    <span className="font-semibold">{i.title}</span>
                    <span className="text-sm text-ink-2">{i.stage}</span>
                    <span className="ml-auto text-xs text-ink-2">{formatDuration(Date.now() - i.since.getTime())}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="coffee" text={`${name} is idle: no campaign or task in progress.`} />
          ))}
        {tab === "accounts" && <AccountsPage searchParams={Promise.resolve({})} />}
        {tab === "library" && <CreatorLibrary />}
        {tab === "talent" && <><TalentRequests /><CreatorLibrary kinds={["character"]} /></>}
        {tab === "ready" && <ReadyTalent />}
        {tab === "queue" && <ExecutionQueue />}
        {tab === "schedule" && <Schedule />}
      </section>
    </div>
  );
}
