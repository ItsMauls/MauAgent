import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ACCOUNT_PUBLIC_SELECT, tokenStatus } from "@/lib/accounts";
import * as instagram from "@/lib/providers/instagram";
import * as tiktok from "@/lib/providers/tiktok";
import { AccountControls, SyncBufferButton } from "../ui";

export const dynamic = "force-dynamic";

const FILTERS = {
  active: { label: "Active", where: { active: true } },
  inactive: { label: "Inactive", where: { active: false } },
  all: { label: "All", where: {} },
} satisfies Record<string, { label: string; where: Prisma.SocialAccountWhereInput }>;
type Filter = keyof typeof FILTERS;

const PLATFORM = {
  threads: { label: "Threads", configured: false, env: "Buffer" },
  twitter: { label: "X", configured: false, env: "Buffer" },
  instagram: { label: "Instagram", configured: instagram.configured(), env: "IG_APP_ID and IG_APP_SECRET" },
  tiktok: { label: "TikTok", configured: tiktok.configured(), env: "TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET" },
};

const TOKEN_PILL = {
  ok: ["Token OK", "border-emerald-200 bg-ok-soft text-emerald-800"],
  expiring: ["Token expiring", "border-amber-200 bg-amber-soft text-amber-800"],
  reauth: ["Reconnect needed", "border-red-200 bg-bad-soft text-red-800"],
} as const;

const PUBLISHER_LABEL = { instagram_graph: "Instagram Graph", tiktok_inbox: "TikTok inbox", orshot: "Orshot", buffer: "Buffer" };
const AUDIT_LABEL: Record<string, string> = { not_submitted: "Audit not submitted", pending: "Audit pending", approved: "Audit approved", rejected: "Audit rejected" };

const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ filter?: string; connected?: string; error?: string }> }) {
  const sp = await searchParams;
  const filter: Filter = sp.filter && sp.filter in FILTERS ? (sp.filter as Filter) : "active";
  const [accounts, brandKits, attention] = await Promise.all([
    db.socialAccount.findMany({
      where: FILTERS[filter].where,
      orderBy: [{ platform: "asc" }, { handle: "asc" }],
      select: {
        ...ACCOUNT_PUBLIC_SELECT,
        brandKit: { select: { name: true } },
        _count: { select: { publishJobs: { where: { status: "scheduled" } } } },
      },
    }),
    db.brandKit.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.socialAccount.findMany({ where: { active: true }, select: { id: true, platform: true, handle: true, tokenExpiresAt: true, refreshExpiresAt: true, lastError: true } }),
  ]);
  const flagged = attention.map((a) => ({ ...a, status: tokenStatus(a) })).filter((a) => a.status !== "ok");

  return (
    <div className="space-y-6 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Accounts</h1>
          <p className="mt-2 text-ink-2">Instagram, TikTok and Threads accounts linked through Buffer (Sync from Buffer), plus direct connections: publisher, quota and scheduled posts.</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <SyncBufferButton />
          <a href="https://publish.buffer.com" target="_blank" rel="noreferrer" className="btn-soft"><span className="material-symbols-outlined">open_in_new</span>Add or manage channels in Buffer</a>
          {(["instagram", "tiktok"] as const).map((p) =>
            PLATFORM[p].configured ? (
              <a key={p} href={`/api/oauth/${p}`} className="btn-primary">
                <span className="material-symbols-outlined">add_link</span>Connect {PLATFORM[p].label}
              </a>
            ) : (
              <span key={p} className="btn-soft cursor-not-allowed opacity-60" aria-disabled="true" title={`Set ${PLATFORM[p].env} in .env`}>
                <span className="material-symbols-outlined">link_off</span>Connect {PLATFORM[p].label}
              </span>
            ),
          )}
        </div>
      </div>

      {(!PLATFORM.instagram.configured || !PLATFORM.tiktok.configured) && (
        <p className="text-sm text-ink-2">
          {[PLATFORM.instagram, PLATFORM.tiktok].filter((p) => !p.configured).map((p) => `${p.label}: set ${p.env} in .env`).join(" · ")}.
        </p>
      )}

      {sp.connected && <p role="status" className="rounded-2xl bg-ok-soft p-4 text-sm font-semibold text-emerald-800">Connected {sp.connected.replace(":", " @")}.</p>}
      {sp.error && <p role="alert" className="rounded-2xl bg-bad-soft p-4 text-sm font-semibold text-red-800">Connect failed: {sp.error}</p>}

      {flagged.length > 0 && (
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-soft/60 p-4 text-sm text-amber-900">
          <p className="font-semibold">{flagged.length} account{flagged.length === 1 ? " needs" : "s need"} attention</p>
          <ul className="mt-1 space-y-1">
            {flagged.map((a) => (
              <li key={a.id}>
                {PLATFORM[a.platform].label} @{a.handle}: {a.status === "reauth" ? "reconnect required" : "token expires soon"}
                {PLATFORM[a.platform].configured && <> · <a href={`/api/oauth/${a.platform}`} className="font-semibold underline">Reconnect</a></>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <nav aria-label="Filter accounts" className="flex flex-wrap gap-2">
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <Link
            key={f}
            href={`/accounts?filter=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${f === filter ? "bg-brand text-white" : "bg-white text-ink-2 hover:bg-brand-soft"}`}
          >
            {FILTERS[f].label}
          </Link>
        ))}
      </nav>

      {!accounts.length && (
        <div className="card p-12 text-center text-ink-2">
          {filter === "active" ? "No accounts yet. Link them in Buffer, then use Sync from Buffer above." : "No accounts in this view."}
        </div>
      )}

      <ul className="space-y-4">
        {accounts.map((a) => {
          const [tokenLabel, tokenCls] = TOKEN_PILL[tokenStatus(a)];
          return (
            <li key={a.id} className={`card space-y-4 p-6 ${a.active ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold">@{a.handle}</span>
                <span className="pill border-line bg-white text-ink-2">{PLATFORM[a.platform].label}</span>
                {a.accountType && <span className="pill border-line bg-white text-ink-2">{a.accountType.toLowerCase().replace("_", " ")}</span>}
                {a.publisher !== "buffer" && <span className={`pill ${tokenCls}`}>{tokenLabel}</span>}
                {!a.active && <span className="pill border-slate-200 bg-slate-50 text-slate-700">Inactive</span>}
              </div>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-ink-2">Publisher</dt><dd className="font-semibold">{PUBLISHER_LABEL[a.publisher]}</dd></div>
                <div><dt className="text-ink-2">Brand</dt><dd className="font-semibold">{a.brandKit?.name ?? "—"}</dd></div>
                <div><dt className="text-ink-2">Scheduled posts</dt><dd className="font-semibold">{a._count.publishJobs}</dd></div>
                {a.platform === "threads" || a.publisher === "buffer" ? null : a.platform === "instagram" ? (
                  <div>
                    <dt className="text-ink-2">Publishing quota (24 h)</dt>
                    <dd className="font-semibold">
                      {a.quotaUsage != null ? `${a.quotaUsage} / ${a.quotaTotal ?? "?"} used` : "Not checked yet"}
                      {a.quotaCheckedAt && <span className="block text-xs font-normal text-ink-3">checked {a.quotaCheckedAt.toLocaleString("en-GB")}</span>}
                    </dd>
                  </div>
                ) : (
                  <div><dt className="text-ink-2">TikTok audit</dt><dd className="font-semibold">{AUDIT_LABEL[a.tiktokAuditStatus ?? "not_submitted"]}</dd></div>
                )}
                {a.publisher !== "buffer" && <div><dt className="text-ink-2">Token renewable until</dt><dd className="font-semibold">{fmtDate(a.refreshExpiresAt ?? a.tokenExpiresAt)}</dd></div>}
                <div><dt className="text-ink-2">Time zone</dt><dd className="font-semibold">{a.timezone}</dd></div>
                <div><dt className="text-ink-2">Connected</dt><dd className="font-semibold">{fmtDate(a.createdAt)}</dd></div>
              </dl>
              {a.lastError && <p className="rounded-xl bg-bad-soft p-3 text-sm text-red-800">Last check failed: {a.lastError}</p>}
              <details className="rounded-2xl bg-canvas p-4">
                <summary className="cursor-pointer text-sm font-semibold">Settings</summary>
                <div className="mt-4">
                  <AccountControls
                    id={a.id}
                    platform={a.platform}
                    active={a.active}
                    brandKits={brandKits}
                    values={a}
                  />
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
