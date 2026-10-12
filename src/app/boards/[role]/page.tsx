import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { roleBySlug, type RoleTab } from "@/lib/boards/roles";
import { boardSnapshot } from "@/lib/boards/snapshot";
import { roleWork } from "@/lib/boards/status";
import { formatDuration } from "@/lib/status";
import { getPersona, isAgentRole } from "@/lib/agents/persona";
import { agentExperience } from "@/lib/agents/memory";
import AccountsPage from "../../accounts/page";
import { AssetsTab, Empty, ShotsTab } from "../../campaigns/[id]/shots";
import { CreatorLibrary } from "../library";
import { ArtifactsPanel, MemoryPanel, QuickTask, ReadyTalent, TalentRequests } from "../workspace";
import { TASKS } from "@/lib/boards/tasks";
import { initials, STATE_PILL } from "../cards";

export const dynamic = "force-dynamic";

type Tab = "task" | "focus" | RoleTab | "artifacts" | "memory";
const TAB_LABEL: Record<Tab, string> = {
  task: "Quick task",
  focus: "Current focus",
  artifacts: "Artifacts",
  memory: "Memory",
  accounts: "Accounts",
  ready: "Ready talent",
  queue: "Execution queue",
  schedule: "Schedule & publishing",
  library: "Library",
  talent: "Talent",
};

export default async function RolePage({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ role: slug }, sp] = await Promise.all([params, searchParams]);
  const role = roleBySlug(slug);
  if (!role) notFound();
  const llmRole = isAgentRole(role.agentRole);
  const tabs: Tab[] = [...(TASKS[role.agentRole] ? (["task"] as const) : []), "focus", ...role.tabs, "artifacts", ...(llmRole ? (["memory"] as const) : [])];
  const tab: Tab = tabs.includes(sp.tab as Tab) ? (sp.tab as Tab) : tabs[0];

  const [persona, exp, work] = await Promise.all([
    isAgentRole(role.agentRole) ? getPersona(role.agentRole).then((p) => p.persona) : null,
    isAgentRole(role.agentRole) ? agentExperience().then((e) => e[role.agentRole as keyof typeof e]) : null,
    boardSnapshot().then((s) => roleWork(role.agentRole, s)),
  ]);
  const name = persona?.nickname ?? role.label;
  const [stateLabel, stateCls] = STATE_PILL[work.state];

  return (
    <div className="space-y-6 pt-4">
      <Link href="/boards" className="inline-flex items-center gap-1 text-sm font-semibold text-brand">
        <span className="material-symbols-outlined !text-[18px]">arrow_back</span>Boards
      </Link>

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

      <nav aria-label={`${role.label} sections`} className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t}
            href={`/boards/${role.slug}?tab=${t}`}
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

/** Shots waiting for footage across all campaigns: the same cards as the campaign Shots/Assets tabs. */
async function ExecutionQueue() {
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

async function Schedule() {
  const jobs = await db.publishJob.findMany({
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    take: 50,
    select: { id: true, campaignId: true, platform: true, status: true, scheduledAt: true, permalink: true, socialAccount: { select: { handle: true } } },
  });
  if (!jobs.length) return <Empty icon="schedule_send" text="No publish jobs yet. Publishing to Instagram and TikTok is not built yet (PRD F11)." />;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2">
        <tr><th className="py-2">Account</th><th>Status</th><th>Scheduled</th><th /></tr>
      </thead>
      <tbody className="divide-y divide-line">
        {jobs.map((j) => (
          <tr key={j.id}>
            <td className="py-2">{j.platform} @{j.socialAccount.handle}</td>
            <td>{j.status}</td>
            <td>{j.scheduledAt?.toLocaleString("en-GB") ?? "—"}</td>
            <td className="text-right"><Link href={j.permalink ?? `/campaigns/${j.campaignId}?tab=publication`} className="font-semibold text-brand">Open</Link></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
