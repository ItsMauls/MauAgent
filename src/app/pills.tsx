const STATUS: Record<string, [string, string]> = {
  DRAFTING: ["Drafting", "border-slate-200 bg-slate-50 text-slate-700"],
  AWAITING_VIDEO_UPLOAD: ["Awaiting video upload", "border-amber-200 bg-amber-soft text-amber-800"],
  POST_PRODUCTION: ["Post-production", "border-blue-200 bg-brand-soft text-brand-dark"],
  AWAITING_APPROVAL: ["Awaiting approval", "border-amber-200 bg-amber-soft text-amber-800"],
  REVISING: ["Needs revision", "border-red-200 bg-bad-soft text-red-800"],
  REGENERATING: ["Regenerating", "border-violet-200 bg-agent-soft text-violet-700"],
  APPROVED: ["Approved", "border-emerald-200 bg-ok-soft text-emerald-800"],
  PUBLISHING: ["Publishing", "border-blue-200 bg-brand-soft text-brand-dark"],
  PUBLISHED: ["Published", "border-emerald-200 bg-ok-soft text-emerald-800"],
  REJECTED: ["Rejected", "border-red-200 bg-bad-soft text-red-800"],
  EXPIRED: ["Expired", "border-slate-200 bg-slate-50 text-slate-700"],
  FAILED: ["Failed", "border-red-200 bg-bad-soft text-red-800"],
};

export function StatusPill({ status }: { status: string }) {
  const [label, cls] = STATUS[status] ?? [status, STATUS.DRAFTING[1]];
  return <span className={`pill ${cls}`}>{label}</span>;
}

export function SourcePill({ source }: { source: string }) {
  return source === "seedance_api" ? (
    <span className="pill border-violet-200 bg-agent-soft text-violet-700">
      <span className="material-symbols-outlined !text-[14px]">auto_awesome</span>Seedance API
    </span>
  ) : (
    <span className="pill border-line bg-white text-ink-2">
      <span className="material-symbols-outlined !text-[14px]">cloud_upload</span>Manual upload
    </span>
  );
}
