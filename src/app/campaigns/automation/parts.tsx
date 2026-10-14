// Small shared bits for the automation campaign pages.
import type { AutomationStatus, CampaignPostStatus } from "@prisma/client";
import { PLATFORM_LABEL } from "@/lib/automation/config";

const CAMPAIGN_STYLE: Record<AutomationStatus, string> = {
  draft: "border-line bg-canvas text-ink-2",
  piloting: "border-blue-200 bg-brand-soft text-brand-dark",
  awaiting_scale: "border-amber-200 bg-amber-soft text-amber-800",
  running: "border-emerald-200 bg-ok-soft text-emerald-800",
  paused: "border-amber-200 bg-amber-soft text-amber-800",
  completed: "border-emerald-200 bg-ok-soft text-emerald-800",
  cancelled: "border-red-200 bg-bad-soft text-red-800",
};

export const POST_STYLE: Record<CampaignPostStatus, string> = {
  planned: "border-line bg-canvas text-ink-2",
  generating: "border-blue-200 bg-brand-soft text-brand-dark",
  qc: "border-blue-200 bg-brand-soft text-brand-dark",
  needs_review: "border-amber-200 bg-amber-soft text-amber-800",
  approved: "border-emerald-200 bg-ok-soft text-emerald-800",
  scheduled: "border-emerald-200 bg-ok-soft text-emerald-800",
  published: "border-emerald-300 bg-emerald-100 text-emerald-900",
  failed: "border-red-200 bg-bad-soft text-red-800",
  rejected: "border-red-200 bg-bad-soft text-red-800",
  skipped: "border-line bg-canvas text-ink-3",
  cancelled: "border-line bg-canvas text-ink-3",
};

const label = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export const CampaignStatusPill = ({ status }: { status: AutomationStatus }) => <span className={`pill ${CAMPAIGN_STYLE[status]}`}>{label(status)}</span>;
export const PostStatusPill = ({ status }: { status: CampaignPostStatus }) => <span className={`pill ${POST_STYLE[status]}`}>{label(status)}</span>;
export const platformName = (p: string) => PLATFORM_LABEL[p] ?? p;
