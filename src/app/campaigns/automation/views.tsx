// The three ways to show the campaign list: grid of cards, kanban by stage, table. Presentational; page.tsx loads and
// filters the rows.
import Link from "next/link";
import type { AutomationStatus } from "@prisma/client";
import { PLATFORM_LABEL } from "@/lib/automation/config";
import { CampaignStatusPill } from "./parts";

export type Row = {
  id: string;
  name: string;
  status: AutomationStatus;
  pauseReason: string | null;
  kind: "personal" | "brand";
  brandName?: string;
  platforms: string[];
  startDate: string;
  endDate: string;
  /** Texts in the plan, texts written so far, texts approved (by QC or you) and texts waiting for you. */
  slots: number;
  written: number;
  approved: number;
  review: number;
  spent: number;
  /** Campaign cap in US$, 0 = pay as you go. */
  cap: number;
  createdAt: Date;
};

export const KANBAN: { id: string; title: string; icon: string; statuses: AutomationStatus[] }[] = [
  { id: "draft", title: "Draft", icon: "edit_note", statuses: ["draft"] },
  { id: "pilot", title: "Pilot", icon: "science", statuses: ["piloting", "awaiting_scale"] },
  { id: "running", title: "Running", icon: "autorenew", statuses: ["running"] },
  { id: "paused", title: "Paused", icon: "pause_circle", statuses: ["paused"] },
  { id: "done", title: "Done", icon: "task_alt", statuses: ["completed", "cancelled"] },
];

const usd = (n: number) => `US$${n.toFixed(2)}`;
const pct = (a: number, b: number) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
const budget = (r: Row) => (r.cap > 0 ? `${usd(r.spent)} / ${usd(r.cap)}` : `${usd(r.spent)} · pay as you go`);
const who = (r: Row) => (r.kind === "brand" ? r.brandName || "Brand" : "Personal");
const initials = (s: string) => s.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

function Bar({ value, tone = "bg-brand" }: { value: number; tone?: string }) {
  return <div className="h-1.5 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${tone}`} style={{ width: `${value}%` }} /></div>;
}

const ReviewBadge = ({ n }: { n: number }) =>
  n > 0 ? <span className="pill border-amber-200 bg-amber-soft text-amber-800"><span className="material-symbols-outlined !text-[14px]">priority_high</span>{n} to review</span> : null;

/** One campaign as a card (grid) or a compact card (kanban column). */
function CampaignCard({ r, compact }: { r: Row; compact?: boolean }) {
  return (
    <Link href={`/campaigns/automation/${r.id}`} className="card block p-4 transition hover:border-brand/40 hover:shadow-md">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">{initials(r.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{r.name}</p>
          <p className="truncate text-xs text-ink-2">{who(r)} · {r.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(", ")}</p>
        </div>
        {!compact && <CampaignStatusPill status={r.status} />}
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-ink-2"><span>{r.written} of {r.slots} written</span><span>{r.approved} approved</span></div>
        <Bar value={pct(r.written, r.slots)} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
        <span>{r.startDate} → {r.endDate}</span>
        <span className="font-semibold text-ink">{budget(r)}</span>
      </div>
      {(r.review > 0 || r.pauseReason) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <ReviewBadge n={r.review} />
          {r.pauseReason && <span className="pill border-amber-200 bg-amber-soft text-amber-800">Paused: {r.pauseReason.replace("_", " ")}</span>}
        </div>
      )}
    </Link>
  );
}

export const GridView = ({ rows }: { rows: Row[] }) => (
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rows.map((r) => <CampaignCard key={r.id} r={r} />)}</div>
);

export const KanbanView = ({ rows }: { rows: Row[] }) => (
  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
    {KANBAN.map((col) => {
      const items = rows.filter((r) => col.statuses.includes(r.status));
      return (
        <section key={col.id} aria-label={col.title} className="min-w-0 rounded-3xl bg-canvas p-3">
          <h3 className="mb-3 flex items-center gap-2 px-1 text-sm font-bold">
            <span className="material-symbols-outlined text-ink-3">{col.icon}</span>{col.title}
            <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs text-ink-2">{items.length}</span>
          </h3>
          <div className="space-y-3">
            {items.map((r) => <CampaignCard key={r.id} r={r} compact />)}
            {!items.length && <p className="rounded-2xl border border-dashed border-line px-3 py-6 text-center text-xs text-ink-3">Nothing here</p>}
          </div>
        </section>
      );
    })}
  </div>
);

export const TableView = ({ rows }: { rows: Row[] }) => (
  <section className="card overflow-hidden">
    <div className="overflow-x-auto">
      <table className="w-full min-w-180 text-left text-sm">
        <thead>
          <tr className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2">
            <th className="px-6 py-4">Campaign</th><th className="px-4 py-4">Status</th><th className="px-4 py-4">Account</th><th className="px-4 py-4">Range</th>
            <th className="px-4 py-4">Progress</th><th className="px-4 py-4">To review</th><th className="px-4 py-4">Spend</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.id} className="transition hover:bg-canvas/60">
              <td className="px-6 py-4">
                <Link href={`/campaigns/automation/${r.id}`} className="flex items-center gap-3 font-semibold hover:text-brand">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">{initials(r.name)}</span>
                  {r.name}
                </Link>
              </td>
              <td className="px-4 py-4"><CampaignStatusPill status={r.status} /></td>
              <td className="px-4 py-4 text-ink-2">{who(r)}<div className="text-xs text-ink-3">{r.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(", ")}</div></td>
              <td className="px-4 py-4 whitespace-nowrap text-ink-2">{r.startDate} → {r.endDate}</td>
              <td className="w-44 px-4 py-4"><div className="mb-1 text-xs text-ink-2">{r.written} / {r.slots} written · {r.approved} approved</div><Bar value={pct(r.written, r.slots)} /></td>
              <td className="px-4 py-4">{r.review > 0 ? <ReviewBadge n={r.review} /> : <span className="text-ink-3">—</span>}</td>
              <td className="px-4 py-4 whitespace-nowrap">{budget(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);
