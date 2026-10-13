import Link from "next/link";
import { db } from "@/lib/db";
import { ACCOUNT_PUBLIC_SELECT } from "@/lib/accounts";
import { STATUS_LABEL } from "@/lib/connections";
import { ChannelControls } from "./controls";

export const PLATFORM = { instagram: ["Instagram", "photo_camera"], tiktok: ["TikTok", "music_note"], threads: ["Threads", "alternate_email"], twitter: ["X", "tag"] } as const;
const CHIP = {
  connected: "border-emerald-200 bg-ok-soft text-emerald-800",
  needs_reauth: "border-red-200 bg-bad-soft text-red-800",
  disabled: "border-slate-200 bg-slate-50 text-slate-700",
  missing: "border-amber-200 bg-amber-soft text-amber-800",
} as const;

/** Buffer channels from the database (never calls Buffer). Read-only unless `editable`. */
export async function ChannelList({ editable = false, platform, status }: { editable?: boolean; platform?: string; status?: string }) {
  const channels = await db.socialAccount.findMany({
      where: {
        publisher: "buffer",
        ...(platform && platform in PLATFORM ? { platform: platform as keyof typeof PLATFORM } : {}),
        ...(status && status in STATUS_LABEL ? { status: status as keyof typeof STATUS_LABEL } : {}),
      },
      orderBy: [{ platform: "asc" }, { handle: "asc" }],
      select: ACCOUNT_PUBLIC_SELECT,
  });
  if (!channels.length)
    return (
      <div className="card p-10 text-center text-ink-2">
        No channels yet. Connect accounts in Buffer, then sync.{" "}
        {!editable && <Link href="/connections" className="font-semibold underline">Open Connections</Link>}
      </div>
    );
  return (
    <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {channels.map((c) => (
        <li key={c.id} className={`card flex flex-col gap-4 p-5 transition hover:shadow-lg ${c.status === "missing" ? "opacity-70" : ""}`}>
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              {c.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft font-bold text-brand">{c.handle.replace(/^@/, "").slice(0, 2).toUpperCase()}</span>
              )}
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm">
                <span className="material-symbols-outlined text-[13px]">{PLATFORM[c.platform][1]}</span>
              </span>
            </div>
            <div className="min-w-0">
              <p className="truncate font-bold">{c.handle}</p>
              <p className="text-xs text-ink-2">{PLATFORM[c.platform][0]} · {c.timezone}</p>
              {c.lastSyncedAt && <p className="text-[11px] text-ink-3">Last synced {c.lastSyncedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</p>}
            </div>
            <a href="https://publish.buffer.com" target="_blank" rel="noreferrer" aria-label="Manage in Buffer" className="ml-auto text-ink-2 hover:text-brand">
              <span className="material-symbols-outlined text-[20px]">open_in_new</span>
            </a>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className={`pill ${CHIP[c.status]}`}>{STATUS_LABEL[c.status]}</span>
            {c.active && <span className="pill border-line bg-white text-ink-2">Enabled</span>}
            {c.isDefaultForPlatform && <span className="pill border-blue-200 bg-brand-soft text-brand-dark">Default</span>}
          </div>
          {c.quotaUsage != null && c.quotaTotal ? (
            <div className="rounded-2xl bg-canvas p-3 text-xs text-ink-2">
              <div className="mb-1 flex justify-between"><span>Quota</span><span className="font-semibold text-ink">{c.quotaUsage}/{c.quotaTotal}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (c.quotaUsage / c.quotaTotal) * 100)}%` }} /></div>
            </div>
          ) : null}
          {c.status === "missing" ? (
            <p className="rounded-xl bg-amber-soft p-3 text-sm text-amber-900">This channel is no longer in Buffer. It cannot be a publish target; its history is kept.</p>
          ) : (
            c.lastError && <p className="rounded-xl bg-amber-soft p-3 text-sm text-amber-900">{c.lastError}</p>
          )}
          {editable && <div className="mt-auto border-t border-line pt-4"><ChannelControls id={c.id} active={c.active} isDefault={c.isDefaultForPlatform} missing={c.status === "missing"} /></div>}
        </li>
      ))}
    </ul>
  );
}
