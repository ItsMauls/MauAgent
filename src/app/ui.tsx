"use client";

import { useState, useTransition } from "react";
import { confirmUpload, decide, getUploadUrl } from "./actions";

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

export function DecisionButtons({ campaignId }: { campaignId: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-3">
      <button disabled={pending} onClick={() => start(() => decide(campaignId, "approve"))} className="btn bg-ok text-white shadow-[0_4px_14px_rgba(16,185,129,0.3)] hover:bg-emerald-600">
        <span className="material-symbols-outlined">check</span>Approve
      </button>
      <button
        disabled={pending}
        onClick={() => confirm("Reject this campaign?") && start(() => decide(campaignId, "reject"))}
        className="btn border border-red-200 bg-bad-soft text-red-800 hover:bg-red-100"
      >
        <span className="material-symbols-outlined">close</span>Reject
      </button>
    </div>
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
