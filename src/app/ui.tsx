"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PublishTargetsPanel, usePublishTargets, type TargetOptions } from "./publishTargets";
import { budgetDecision, confirmUpload, decide, getRegenerateEstimate, getUploadUrl, planPublish, refreshAccounts, cancelPublish, retryPublish, setAccountActive, syncBuffer, updateAccount } from "./actions";

export function SourceToggle({ name, defaultValue }: { name: string; defaultValue: string }) {
  return (
    <fieldset>
      <legend className="label">Video source</legend>
      <div className="flex flex-wrap gap-2">
        {[["seedance_api", "Seedance API (automatic)"], ["manual_upload", "Manual upload"]].map(([v, t]) => (
          <label key={v} className="cursor-pointer">
            <input type="radio" name={name} value={v} defaultChecked={defaultValue === v} className="peer sr-only" />
            <span className="pill border-line bg-white px-4 py-2 text-ink-2 peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:text-brand">{t}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function CopyBlock({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2">
        {label}
        <button
          type="button"
          className="pill border-blue-100 bg-brand-soft normal-case tracking-normal text-brand hover:bg-blue-100"
          onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}
        >
          {done ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap rounded-xl bg-canvas p-3 font-sans text-sm normal-case text-ink">{text}</pre>
    </div>
  );
}

export function UploadSlot({ shotDbId }: { shotDbId: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const onFile = (file: File) =>
    start(async () => {
      setMsg(null);
      try {
        const { key, url } = await getUploadUrl(shotDbId);
        const put = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": "video/mp4" } });
        if (!put.ok) throw new Error(`S3 upload failed (${put.status})`);
        const res = await confirmUpload(shotDbId, key);
        setMsg(res.ok ? { ok: true, text: "Passed validation." } : { ok: false, text: res.errors.join(" ") });
      } catch (e) {
        setMsg({ ok: false, text: String(e) });
      }
    });

  return (
    <div>
      <input
        type="file"
        accept="video/mp4"
        disabled={pending}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        className="block w-full cursor-pointer rounded-xl border border-dashed border-blue-200 bg-brand-soft/50 p-4 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-1.5 file:text-sm file:font-semibold file:text-white"
      />
      {pending && <p className="mt-2 text-sm text-ink-2">Uploading and validating…</p>}
      {msg && <p role="status" className={`mt-2 text-sm font-medium ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
    </div>
  );
}

/** Run a server action with pending + error state. */
export function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<unknown>, after?: () => void) =>
    start(async () => {
      setError(null);
      try {
        await fn();
        after?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  return { pending, error, run };
}

export const ErrorText = ({ error }: { error: string | null }) =>
  error ? <p role="alert" className="mt-2 text-sm font-medium text-red-700">{error}</p> : null;

type Mode = null | "approve" | "revise" | "regenerate";
type Estimate = Awaited<ReturnType<typeof getRegenerateEstimate>>;

/** Approve / Revise / Regenerate / Reject. Every action creates a Decision and sends campaign/client.decision. */
export function DecisionButtons({ campaignId, shots, publish }: { campaignId: string; shots: { shotId: string; source: string }[]; publish?: TargetOptions }) {
  const { pending, error, run } = useAction();
  const [mode, setMode] = useState<Mode>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [est, setEst] = useState<Estimate | null>(null);
  const [confirmOver, setConfirmOver] = useState(false);
  const targets = usePublishTargets(publish ?? { accounts: [], captions: {}, hashtags: [], platforms: [], timezone: "UTC" });

  const toggleShot = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    setEst(null);
    setConfirmOver(false);
    if (next.length) run(async () => setEst(await getRegenerateEstimate(campaignId, next)));
  };

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <button disabled={pending} aria-expanded={publish ? mode === "approve" : undefined} onClick={() => (publish ? setMode(mode === "approve" ? null : "approve") : run(() => decide(campaignId, { type: "approve" })))} className="btn bg-ok text-white shadow-[0_4px_14px_rgba(16,185,129,0.3)] hover:bg-emerald-600">
          <span className="material-symbols-outlined">check</span>Approve
        </button>
        <button disabled={pending} aria-expanded={mode === "revise"} onClick={() => setMode(mode === "revise" ? null : "revise")} className="btn-soft">
          <span className="material-symbols-outlined">edit_note</span>Revise
        </button>
        <button disabled={pending} aria-expanded={mode === "regenerate"} onClick={() => setMode(mode === "regenerate" ? null : "regenerate")} className="btn border border-violet-200 bg-agent-soft text-violet-700 hover:bg-violet-100">
          <span className="material-symbols-outlined">autorenew</span>Regenerate
        </button>
        <button
          disabled={pending}
          onClick={() => confirm("Reject this campaign?") && run(() => decide(campaignId, { type: "reject" }))}
          className="btn border border-red-200 bg-bad-soft text-red-800 hover:bg-red-100"
        >
          <span className="material-symbols-outlined">close</span>Reject
        </button>
      </div>

      {mode === "approve" && publish && (
        <div className="mt-4 space-y-4 rounded-2xl bg-canvas p-4">
          <PublishTargetsPanel s={targets} />
          <button
            disabled={pending || !targets.ready}
            onClick={() => confirm(`${targets.summary}?`) && run(() => decide(campaignId, { type: "approve", publishTargets: targets.targets }))}
            className="btn bg-ok text-white hover:bg-emerald-600"
          >
            <span className="material-symbols-outlined">check</span>{targets.chosen.length ? "Approve and publish" : "Approve"}
          </button>
        </div>
      )}

      {mode === "revise" && (
        <form
          className="mt-4 space-y-3 rounded-2xl bg-canvas p-4"
          action={(f) =>
            run(() =>
              decide(campaignId, {
                type: "revise",
                notes: String(f.get("notes") ?? ""),
                targetAgent: (f.get("targetAgent") || undefined) as "creativeDirector" | "artDirector" | "postProduction" | undefined,
              }),
            )
          }
        >
          <label className="block">
            <span className="label">Revision notes</span>
            <textarea name="notes" required rows={3} className="input" placeholder="e.g. make the hook punchier in the first 2 seconds" />
          </label>
          <label className="block">
            <span className="label">Route to</span>
            <select name="targetAgent" className="input" defaultValue="">
              <option value="">Automatic (classified from the notes)</option>
              <option value="creativeDirector">Concept → Creative Director</option>
              <option value="artDirector">Visuals → Art Director</option>
              <option value="postProduction">Edit / pacing / subtitles → Post-production</option>
            </select>
          </label>
          <button disabled={pending} className="btn-primary">Send revision</button>
        </form>
      )}

      {mode === "regenerate" && (
        <div className="mt-4 space-y-3 rounded-2xl bg-canvas p-4">
          <fieldset>
            <legend className="label">Shots to regenerate</legend>
            <div className="flex flex-wrap gap-2">
              {shots.map((s) => (
                <label key={s.shotId} className="cursor-pointer">
                  <input type="checkbox" checked={picked.includes(s.shotId)} onChange={() => toggleShot(s.shotId)} className="peer sr-only" />
                  <span className="pill border-line bg-white px-4 py-2 text-ink-2 peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:text-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand">
                    {s.shotId} · {s.source === "seedance_api" ? "API" : "manual"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {est && (
            <p role="status" className={`rounded-xl p-3 text-sm ${est.overCap ? "bg-bad-soft text-red-800" : "bg-white text-ink"}`}>
              Regenerate {est.n} shot{est.n === 1 ? "" : "s"} × {est.model} × {est.seconds}s ≈ <b>US${est.addUsd.toFixed(2)}</b>; campaign total becomes{" "}
              <b>US${est.totalUsd.toFixed(2)}</b> of cap US${est.capUsd.toFixed(2)}.
              {est.seconds === 0 && " Manual shots cost no API dollars; they reopen the upload slot."}
            </p>
          )}
          {est?.overCap && (
            <label className="flex items-center gap-2 text-sm font-medium text-red-800">
              <input type="checkbox" checked={confirmOver} onChange={(e) => setConfirmOver(e.target.checked)} />
              I understand this exceeds the campaign budget cap.
            </label>
          )}
          <button
            disabled={pending || !est || (est.overCap && !confirmOver)}
            onClick={() => run(() => decide(campaignId, { type: "regenerate", shotIds: picked, confirmOverCap: confirmOver }))}
            className="btn-primary"
          >
            Regenerate {picked.length || ""} shot{picked.length === 1 ? "" : "s"}
          </button>
        </div>
      )}
      {pending && <p className="mt-2 text-sm text-ink-2">Working…</p>}
      <ErrorText error={error} />
    </div>
  );
}

export type GateInfo = { estUsd: number; spentUsd: number; capUsd: number; monthSpentUsd: number; monthCapUsd: number; reasons: string[] };

/** Budget gate dialog: shown while the Producer estimate exceeds a cap. */
export function BudgetGatePanel({ campaignId, gate }: { campaignId: string; gate: GateInfo }) {
  const { pending, error, run } = useAction();
  const [cap, setCap] = useState(String(Math.ceil(gate.spentUsd + gate.estUsd)));
  const row = (k: string, v: number) => (
    <div className="flex justify-between"><dt className="text-ink-2">{k}</dt><dd className="font-semibold">US${v.toFixed(2)}</dd></div>
  );
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-soft/60 p-4 text-sm">
      <p className="font-semibold text-amber-900">Budget gate: production estimate exceeds a cap</p>
      <ul className="mt-1 list-disc pl-5 text-amber-900">{gate.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      <dl className="mt-3 space-y-1">
        {row("Production estimate", gate.estUsd)}
        {row("Spent so far", gate.spentUsd)}
        {row("Campaign cap", gate.capUsd)}
        {row("Spent this month", gate.monthSpentUsd)}
        {row("Monthly cap", gate.monthCapUsd)}
      </dl>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <button disabled={pending} onClick={() => confirm("Proceed over the cap?") && run(() => budgetDecision(campaignId, { action: "proceed" }))} className="btn-primary">
          Proceed anyway
        </button>
        <label className="block">
          <span className="label">New campaign cap (USD)</span>
          <input type="number" min="0.01" step="0.01" value={cap} onChange={(e) => setCap(e.target.value)} className="input w-36" />
        </label>
        <button disabled={pending || !(Number(cap) > 0)} onClick={() => run(() => budgetDecision(campaignId, { action: "raiseCap", newCapUsd: Number(cap) }))} className="btn-soft">
          Change cap &amp; proceed
        </button>
        <button disabled={pending} onClick={() => confirm("Cancel this campaign?") && run(() => budgetDecision(campaignId, { action: "cancel" }))} className="btn border border-red-200 bg-bad-soft text-red-800 hover:bg-red-100">
          Cancel campaign
        </button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

/** Re-render the server page every `seconds` while the tab is visible (light polling, no websocket). */
export function AutoRefresh({ seconds, quiet = false }: { seconds: number; quiet?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  if (quiet) return null;
  return <p className="text-xs text-ink-3">Auto-refreshes every {seconds}s</p>;
}

/** A select that submits its GET form on change (filters without a separate Apply button). */
export function AutoSubmitSelect(props: React.ComponentProps<"select">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

/** Small button for free restores (final cut / shot asset). */
export function RestoreButton({ label, action }: { label: string; action: () => Promise<unknown> }) {
  const { pending, error, run } = useAction();
  return (
    <span>
      <button disabled={pending} onClick={() => run(action)} className="pill border-blue-100 bg-brand-soft text-brand hover:bg-blue-100">
        <span className="material-symbols-outlined !text-[14px]">history</span>{pending ? "Restoring…" : label}
      </button>
      <ErrorText error={error} />
    </span>
  );
}

type AccountSettings = Parameters<typeof updateAccount>[1];
const PUBLISHERS: Record<string, [string, string][]> = {
  instagram: [["buffer", "Buffer"], ["instagram_graph", "Instagram Graph API"], ["orshot", "Orshot"]],
  tiktok: [["buffer", "Buffer"], ["tiktok_inbox", "TikTok inbox (draft)"], ["orshot", "Orshot"]],
  threads: [["buffer", "Buffer"]],
  twitter: [["buffer", "Buffer"]],
};

/** Per-account settings (publisher, brand, type, time zone, TikTok audit) plus check / deactivate. */
export function AccountControls({ id, platform, active, values, brandKits }: {
  id: string; platform: string; active: boolean; brandKits: { id: string; name: string }[];
  values: { publisher: string; brandKitId: string | null; accountType: string | null; timezone: string; tiktokAuditStatus: string | null };
}) {
  const { pending, error, run } = useAction();
  const [note, setNote] = useState<string | null>(null);
  const opt = (f: FormData, k: string) => (f.get(k) ? String(f.get(k)) : null);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      action={(f) =>
        run(
          () =>
            updateAccount(id, {
              publisher: String(f.get("publisher")) as AccountSettings["publisher"],
              brandKitId: opt(f, "brandKitId"),
              accountType: opt(f, "accountType") as AccountSettings["accountType"],
              timezone: String(f.get("timezone")),
              tiktokAuditStatus: opt(f, "tiktokAuditStatus") as AccountSettings["tiktokAuditStatus"],
            }),
          () => setNote("Saved."),
        )
      }
      onChange={() => setNote(null)}
    >
      <label className="block">
        <span className="label">Publisher</span>
        <select name="publisher" defaultValue={values.publisher} className="input">
          {PUBLISHERS[platform].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">Brand kit</span>
        <select name="brandKitId" defaultValue={values.brandKitId ?? ""} className="input">
          <option value="">None</option>
          {brandKits.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">Account type</span>
        <select name="accountType" defaultValue={values.accountType ?? ""} className="input">
          <option value="">Unknown</option>
          <option value="BUSINESS">Business</option>
          <option value="CREATOR">Creator</option>
          <option value="MEDIA_CREATOR">Media creator</option>
        </select>
      </label>
      <label className="block">
        <span className="label">Time zone</span>
        <input name="timezone" defaultValue={values.timezone} required className="input" />
      </label>
      {platform === "tiktok" && (
        <label className="block">
          <span className="label">TikTok audit</span>
          <select name="tiktokAuditStatus" defaultValue={values.tiktokAuditStatus ?? "not_submitted"} className="input">
            <option value="not_submitted">Not submitted</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      )}
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
        <button disabled={pending} className="btn-primary">Save</button>
        <button type="button" disabled={pending || !active} onClick={() => run(() => refreshAccounts(id), () => setNote("Check queued. Reload in a few seconds."))} className="btn-soft">
          <span className="material-symbols-outlined">sync</span>Check now
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => (active ? confirm("Deactivate this account? Its history is kept.") : true) && run(() => setAccountActive(id, !active))}
          className={active ? "btn border border-red-200 bg-bad-soft text-red-800 hover:bg-red-100" : "btn-soft"}
        >
          {active ? "Deactivate" : "Reactivate"}
        </button>
        {note && !pending && <span role="status" className="text-sm text-emerald-700">{note}</span>}
      </div>
      <div className="sm:col-span-2 lg:col-span-3"><ErrorText error={error} /></div>
    </form>
  );
}

/** Budget field: a slider and a number input kept in sync; the input stays the source of the submitted value. */
export function BudgetField({ label, name, defaultValue, max, step }: { label: string; name: string; defaultValue: string; max: number; step: number }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        type="range"
        min={step}
        max={max}
        step={step}
        value={Math.min(Number(value) || step, max)}
        onChange={(e) => setValue(e.target.value)}
        className="mb-2 w-full accent-brand"
      />
      <input name={name} type="number" step="0.01" min="0.01" value={value} onChange={(e) => setValue(e.target.value)} className="input" required />
    </label>
  );
}

export function SyncBufferButton({ compact = false }: { compact?: boolean }) {
  const { pending, error, run } = useAction();
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div>
      <button
        disabled={pending}
        onClick={() => run(async () => { const r = await syncBuffer(); setNote(`${r.linked} linked${r.added ? `, ${r.added} new` : ""}${r.missing ? `, ${r.missing} missing` : ""}.`); router.refresh(); })}
        className={compact ? "flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand transition hover:bg-blue-100 disabled:opacity-60" : "btn-primary"}
        aria-label="Sync from Buffer"
        title="Sync from Buffer"
      >
        <span className={`material-symbols-outlined ${compact && pending ? "animate-spin" : ""}`}>sync</span>{!compact && (pending ? "Syncing…" : "Sync from Buffer")}
      </button>
      {note && !pending && <p role="status" className="mt-1 text-sm text-emerald-700">{note}</p>}
      <ErrorText error={error} />
    </div>
  );
}

/** Content Creator: choose the accounts and how to publish an approved campaign through Buffer. */
export function PublishForm({ campaigns, timezone }: {
  campaigns: { id: string; label: string; options: Omit<TargetOptions, "timezone"> }[];
  timezone: string;
}) {
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const c = campaigns.find((x) => x.id === campaignId);
  return (
    <div className="grid gap-4 rounded-2xl bg-canvas p-5">
      <label className="block">
        <span className="label">Approved campaign</span>
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="input">
          {campaigns.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      {c && <PublishCampaign key={c.id} campaignId={c.id} options={{ ...c.options, timezone }} />}
    </div>
  );
}

function PublishCampaign({ campaignId, options }: { campaignId: string; options: TargetOptions }) {
  const { pending, error, run } = useAction();
  const router = useRouter();
  const t = usePublishTargets(options);
  return (
    <div className="space-y-4">
      <PublishTargetsPanel s={t} />
      <div>
        <button
          disabled={pending || !t.chosen.length || !t.ready}
          onClick={() => confirm(`${t.summary}?`) && run(() => planPublish({ campaignId, targets: t.targets }), () => router.refresh())}
          className="btn-primary"
        >
          {pending ? "Queuing…" : "Publish"}
        </button>
        <ErrorText error={error} />
      </div>
    </div>
  );
}

export function RetryPublishButton({ jobId }: { jobId: string }) {
  const { pending, error, run } = useAction();
  const router = useRouter();
  return (
    <span>
      <button disabled={pending} onClick={() => run(() => retryPublish(jobId), () => router.refresh())} className="font-semibold text-brand">Retry</button>
      <ErrorText error={error} />
    </span>
  );
}

export function CancelPublishButton({ jobId }: { jobId: string }) {
  const { pending, error, run } = useAction();
  const router = useRouter();
  return (
    <span>
      <button disabled={pending} onClick={() => confirm("Cancel this post?") && run(() => cancelPublish(jobId), () => router.refresh())} className="font-semibold text-red-700">Cancel</button>
      <ErrorText error={error} />
    </span>
  );
}
