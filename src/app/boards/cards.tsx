import Link from "next/link";
import { db } from "@/lib/db";
import { ACCOUNT_PUBLIC_SELECT } from "@/lib/accounts";
import { integrationViews, STATE_LABEL, type IntegrationState } from "@/lib/integrations";
import { addDays, agendaItems, countdown, dayKey, monthGrid, type AgendaKind } from "@/lib/boards/agenda";
import type { AgentState } from "@/lib/boards/status";
import { checkIntegrations } from "../actions";
import { Modal } from "./modal";

// ---------- shared bits ----------

export const STATE_PILL: Record<AgentState, [string, string]> = {
  busy: ["Busy", "border-emerald-200 bg-ok-soft text-emerald-800"],
  waiting: ["Waiting", "border-amber-200 bg-amber-soft text-amber-800"],
  idle: ["Idle", "border-slate-200 bg-slate-50 text-slate-700"],
};

export const initials = (s: string) => s.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export function CardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div aria-busy="true" aria-label="Loading" className={`card animate-pulse space-y-3 p-6 ${className}`}>
      <div className="h-4 w-1/3 rounded-full bg-line" />
      <div className="h-3 w-2/3 rounded-full bg-line" />
      <div className="h-3 w-1/2 rounded-full bg-line" />
    </div>
  );
}

export function CardError({ title, className = "" }: { title: string; className?: string }) {
  return (
    <section role="alert" className={`card p-6 ${className}`}>
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-2 rounded-2xl bg-bad-soft p-3 text-sm text-red-800">This card could not load. The rest of the board is unaffected; refresh to retry.</p>
    </section>
  );
}

/** Runs a card loader; a failure renders the card's own error state instead of breaking the page. */
export async function load<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    console.error("[boards]", e);
    return { ok: false };
  }
}

// ---------- A. Date + agenda ----------

const KIND: Record<AgendaKind, { label: string; cls: string; icon: string }> = {
  publish: { label: "Publish", cls: "bg-brand-soft text-brand-dark", icon: "send" },
  deadline: { label: "Deadline", cls: "bg-bad-soft text-red-800", icon: "flag" },
  approval: { label: "Approval", cls: "bg-amber-soft text-amber-800", icon: "fact_check" },
  budget: { label: "Budget", cls: "bg-agent-soft text-violet-700", icon: "savings" },
};

export async function AgendaCard({ day: dayParam, tz, qs }: { day?: string; tz: string; qs: (p: Record<string, string | undefined>) => string }) {
  const r = await load(async () => {
    const [jobs, campaigns] = await Promise.all([
      db.publishJob.findMany({
        where: { scheduledAt: { not: null } },
        select: { campaignId: true, platform: true, scheduledAt: true, socialAccount: { select: { handle: true } } },
      }),
      db.campaign.findMany({
        where: { status: { notIn: ["REJECTED", "EXPIRED", "FAILED", "PUBLISHED"] } },
        select: {
          id: true, status: true, clientBrief: true,
          // The decision wait starts when the gate's step finishes: QC for approval, Producer for the budget gate.
          runs: {
            orderBy: { startedAt: "desc" }, take: 1,
            select: { steps: { where: { agentRole: { in: ["accountTeam", "producer"] }, status: "done" }, orderBy: { startedAt: "desc" }, select: { agentRole: true, endedAt: true } } },
          },
        },
      }),
    ]);
    return agendaItems(
      {
        jobs: jobs.map((j) => ({ ...j, handle: j.socialAccount.handle })),
        campaigns: campaigns.map((c) => {
          const b = c.clientBrief as { product?: string; deadline?: string };
          const gateRole = c.status === "AWAITING_APPROVAL" ? "accountTeam" : "producer";
          return {
            id: c.id, status: c.status, product: b.product ?? c.id, deadline: b.deadline ?? "",
            gateStartedAt: c.runs[0]?.steps.find((s) => s.agentRole === gateRole)?.endedAt ?? null,
          };
        }),
      },
      tz,
    );
  });
  if (!r.ok) return <CardError title="Agenda" />;

  const now = new Date();
  const today = dayKey(now, tz);
  const day = dayParam ?? today;
  const items = r.data.filter((i) => i.day === day);
  const busy = new Set(r.data.map((i) => i.day));
  const grid = monthGrid(day);
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <section aria-labelledby="agenda-h" className="card h-full space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="label">{day === today ? "Today" : "Agenda"} · {tz}</p>
          <h2 id="agenda-h" className="text-xl font-bold">{label}</h2>
        </div>
        <div className="flex gap-1">
          <Link href={qs({ day: addDays(day, -1) })} aria-label="Previous day" className="flex h-9 w-9 items-center justify-center rounded-full bg-canvas hover:bg-brand-soft">
            <span className="material-symbols-outlined">chevron_left</span>
          </Link>
          {day !== today && (
            <Link href={qs({ day: undefined })} className="rounded-full bg-canvas px-3 py-2 text-xs font-semibold hover:bg-brand-soft">Today</Link>
          )}
          <Link href={qs({ day: addDays(day, 1) })} aria-label="Next day" className="flex h-9 w-9 items-center justify-center rounded-full bg-canvas hover:bg-brand-soft">
            <span className="material-symbols-outlined">chevron_right</span>
          </Link>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-ink-2">{grid.title}</p>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} aria-hidden className="font-bold text-ink-3">{d}</span>)}
          {grid.cells.map((c, i) =>
            c ? (
              <Link
                key={c}
                href={qs({ day: c })}
                aria-label={`${c}${busy.has(c) ? ", has items" : ""}`}
                aria-current={c === day ? "date" : undefined}
                className={`relative rounded-full py-1 font-semibold ${c === day ? "bg-brand text-white" : c === today ? "text-brand" : "text-ink-2 hover:bg-brand-soft"}`}
              >
                {Number(c.slice(8))}
                {busy.has(c) && <span className={`absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${c === day ? "bg-white" : "bg-brand"}`} />}
              </Link>
            ) : (
              <span key={`p${i}`} />
            ),
          )}
        </div>
      </div>

      {!items.length ? (
        <p className="rounded-2xl bg-canvas p-4 text-center text-sm text-ink-2">Nothing scheduled this day.</p>
      ) : (
        <ul className="max-h-36 space-y-1 overflow-y-auto">
          {items.map((i, n) => (
            <li key={n}>
              <Link href={i.href} className="flex items-center gap-3 rounded-2xl p-2 hover:bg-canvas">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${KIND[i.kind].cls}`}>
                  <span className="material-symbols-outlined !text-[16px]">{KIND[i.kind].icon}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{i.title}</span>
                  <span className="text-xs text-ink-2">
                    {KIND[i.kind].label}
                    {i.at && ` · ${i.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz })}`}
                    {(i.kind === "approval" || i.kind === "budget") && i.at && ` · ${countdown(i.at.getTime() - now.getTime())}`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- B. Integrations ----------

const STATE_CLS: Record<IntegrationState, string> = {
  connected: "bg-ok-soft text-emerald-700 ring-emerald-200",
  configured: "bg-brand-soft text-brand-dark ring-blue-200",
  attention: "bg-amber-soft text-amber-800 ring-amber-300",
  inactive: "bg-canvas text-ink-3 ring-line",
  soon: "bg-canvas text-ink-3 ring-line border-dashed",
};

export async function IntegrationsCard() {
  const r = await load(async () => {
    const [accounts, cache] = await Promise.all([
      // Public columns only: tokens never leave the server.
      db.socialAccount.findMany({ select: ACCOUNT_PUBLIC_SELECT }),
      db.integrationStatus.findMany(),
    ]);
    // Background infrastructure the owner never manages here; its health checks still run (integrationsHealth).
    const hidden = new Set(["openrouter", "s3", "apify"]);
    return integrationViews({ accounts, cache: Object.fromEntries(cache.map((c) => [c.id, c])), env: process.env }).filter((v) => !hidden.has(v.id));
  });
  if (!r.ok) return <CardError title="Integrations" />;
  const views = r.data;
  const connected = views.filter((v) => v.state === "connected").length;

  return (
    <section aria-labelledby="int-h" className="card h-full space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="int-h" className="text-xl font-bold">Integrations</h2>
          <p className="text-sm text-ink-2">Connected ({connected})</p>
        </div>
        <div className="flex items-center gap-2">
          <form action={checkIntegrations}>
            <button className="btn-soft px-4 py-2" title="Run the free health checks now">
              <span className="material-symbols-outlined">refresh</span>Check
            </button>
          </form>
          <Link href="/accounts" className="btn-soft px-4 py-2">Manage</Link>
          <Link href="/accounts" aria-label="Add an integration" className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white hover:bg-brand-dark">
            <span className="material-symbols-outlined">add</span>
          </Link>
        </div>
      </div>
      <ul className="flex flex-wrap gap-3">
        {views.map((v) => (
          <li key={v.id}>
            <Modal
              title={v.name}
              label={`${v.name}: ${STATE_LABEL[v.state]}`}
              className={`group relative flex h-12 w-12 items-center justify-center rounded-full ring-2 ${STATE_CLS[v.state]}`}
              trigger={
                <>
                  <span className="material-symbols-outlined">{v.icon}</span>
                  <span role="tooltip" className="pointer-events-none absolute -top-9 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white group-hover:block group-focus-visible:block">
                    {v.name}
                  </span>
                </>
              }
            >
              <p><span className={`pill ring-0 ${STATE_CLS[v.state]}`}>{STATE_LABEL[v.state]}</span></p>
              <p className="text-sm text-ink-2">{v.summary}</p>
              {v.details.length > 0 && <ul className="space-y-1 text-sm text-ink-2">{v.details.map((d) => <li key={d}>{d}</li>)}</ul>}
              <Link href={v.href} className="btn-soft">Open settings</Link>
            </Modal>
          </li>
        ))}
      </ul>
    </section>
  );
}
