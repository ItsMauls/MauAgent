import { cache } from "react";
import Link from "next/link";
import { db } from "@/lib/db";
import { STATE_LABEL, integrationViews, type IntegrationState, type IntegrationView } from "@/lib/integrations";
import { ACCOUNT_PUBLIC_SELECT } from "@/lib/accounts";
import { SyncBufferButton } from "../ui";
import { ChannelList, PLATFORM } from "./channels";

export const dynamic = "force-dynamic";

const STATE_CLS: Record<IntegrationState, string> = {
  connected: "border-emerald-200 bg-ok-soft text-emerald-800",
  configured: "border-blue-200 bg-brand-soft text-brand-dark",
  attention: "border-amber-200 bg-amber-soft text-amber-800",
  inactive: "border-line bg-canvas text-ink-3",
  soon: "border-dashed border-line bg-canvas text-ink-3",
};

// Each section catches its own failure so one broken query never takes down the page.
async function section<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    return { ok: true, data: await fn() };
  } catch {
    return { ok: false };
  }
}
const Failed = ({ what }: { what: string }) => <div role="alert" className="card p-6 text-sm text-red-800">Could not load {what}. Try reloading.</div>;

const GROUPS = [
  { title: "AI video, voice & visual engines", blurb: "Models that write, render and voice the content.", ids: ["openrouter", "seedance", "elevenlabs"] },
  { title: "Data & trends", blurb: "Trend research that feeds the agents.", ids: ["apify"] },
];
const SHOWN = new Set(GROUPS.flatMap((g) => g.ids));

// One query set per request, shared by the header badge, the summary cards and the integration groups.
const loadViews = cache(async () => {
  const [accounts, cached] = await Promise.all([db.socialAccount.findMany({ select: ACCOUNT_PUBLIC_SELECT }), db.integrationStatus.findMany()]);
  const views = integrationViews({ accounts, cache: Object.fromEntries(cached.map((c) => [c.id, c])), env: process.env }).filter((v) => SHOWN.has(v.id));
  return { accounts, views };
});

async function Summary() {
  const r = await section(loadViews);
  if (!r.ok) return <Failed what="the summary" />;
  const { accounts, views } = r.data;
  const buffer = accounts.filter((a) => a.publisher === "buffer");
  const enabled = buffer.filter((a) => a.active);
  const platforms = [...new Set(enabled.map((a) => a.platform))];
  const live = views;
  const broken = [
    ...live.filter((v) => v.state === "attention").map((v) => v.name),
    ...enabled.filter((a) => a.status !== "connected").map((a) => a.handle),
  ];
  const cards = [
    { icon: "share", label: "Social channels", value: `${enabled.length} enabled`, sub: `${buffer.length} synced from Buffer`, foot: platforms.map((p) => p[0].toUpperCase() + p.slice(1)).join(" · ") || "No platform enabled" },
    { icon: "hub", label: "Integrations", value: `${live.filter((v) => v.state === "connected").length} of ${live.length} connected`, sub: "Verified by the health check", foot: `${live.filter((v) => v.state === "inactive").length} not active` },
    { icon: broken.length ? "warning" : "verified_user", label: "Needs attention", value: String(broken.length), sub: broken.length ? broken.slice(0, 3).join(", ") + (broken.length > 3 ? ` +${broken.length - 3}` : "") : "Everything looks healthy", foot: broken.length ? "Fix before publishing" : "No action needed" },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className="card flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between text-sm font-semibold text-ink-2">
            {c.label}
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-brand"><span className="material-symbols-outlined text-[18px]">{c.icon}</span></span>
          </div>
          <p className="text-2xl font-bold tracking-tight">{c.value}</p>
          <p className="truncate text-xs text-ink-2">{c.sub}</p>
          <p className="text-xs font-semibold text-brand">{c.foot}</p>
        </div>
      ))}
    </div>
  );
}

async function ConnectedBadge() {
  const r = await section(loadViews);
  if (!r.ok) return null;
  const n = r.data.views.filter((v) => v.state === "connected").length;
  return <span className="pill border-blue-200 bg-brand-soft text-brand-dark"><span className="h-2 w-2 animate-pulse rounded-full bg-brand" />{n} service{n === 1 ? "" : "s"} connected</span>;
}

function IntegrationCard({ v }: { v: IntegrationView }) {
  return (
    <li className="card flex flex-col gap-3 p-5 transition hover:shadow-lg">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand"><span className="material-symbols-outlined">{v.icon}</span></span>
        <div className="min-w-0">
          <p className="font-bold">{v.name}</p>
          <p className="text-sm text-ink-2">{v.summary}</p>
        </div>
        <span className={`pill ml-auto shrink-0 ${STATE_CLS[v.state]}`}>{STATE_LABEL[v.state]}</span>
      </div>
      {v.details.length > 0 && <ul className="space-y-1 rounded-2xl bg-canvas p-3 text-xs text-ink-2">{v.details.map((d) => <li key={d}>{d}</li>)}</ul>}
      <Link href={v.href} className="mt-auto text-sm font-semibold text-brand hover:underline">Configure →</Link>
    </li>
  );
}

async function OtherIntegrations() {
  const r = await section(loadViews);
  if (!r.ok) return <Failed what="the integrations" />;
  const groups = GROUPS.map((g) => ({ ...g, items: r.data.views.filter((v) => g.ids.includes(v.id)) })).filter((g) => g.items.length);
  return (
    <>
      {groups.map((g) => (
        <section key={g.title} aria-label={g.title} className="space-y-4">
          <div>
            <h2 className="text-xl font-bold">{g.title}</h2>
            {g.blurb && <p className="text-sm text-ink-2">{g.blurb}</p>}
          </div>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{g.items.map((v) => <IntegrationCard key={v.id} v={v} />)}</ul>
        </section>
      ))}
    </>
  );
}

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ platform?: string }> }) {
  const sp = await searchParams;
  const tab = (v: string | undefined, label: string) => (
    <Link
      key={label}
      href={v ? `/connections?platform=${v}` : "/connections"}
      aria-current={sp.platform === v ? "page" : undefined}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${sp.platform === v ? "bg-brand text-white" : "bg-white text-ink-2 hover:bg-brand-soft"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="space-y-8 pt-4">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Connections</h1>
          <ConnectedBadge />
        </div>
        <p className="mt-2 max-w-3xl text-ink-2">Social channels linked through Buffer, AI engines and trend data, and the health of each one.</p>
      </div>

      <Summary />

      <section aria-labelledby="buf-h" className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 id="buf-h" className="text-xl font-bold">Social Media (Connected Via Buffer)</h2>
          <SyncBufferButton compact />
        </div>
        <nav aria-label="Filter channels" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-1">
            {tab(undefined, "All")}
            {(Object.keys(PLATFORM) as (keyof typeof PLATFORM)[]).map((p) => tab(p, PLATFORM[p][0]))}
          </div>
        </nav>
        <ChannelList editable platform={sp.platform} />
      </section>

      <OtherIntegrations />

    </div>
  );
}
