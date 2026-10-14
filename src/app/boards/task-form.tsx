"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { deleteBatch, estimateFlow, estimateTaskAction, requestTask, retryTask, runFlow, scrapTask } from "./actions";

type Prop = {
  type?: string; title?: string; enum?: string[]; items?: { enum?: string[] }; ref?: string; library?: string; multiline?: boolean;
};
export type Option = { id: string; label: string };
type Estimate = Awaited<ReturnType<typeof estimateTaskAction>>;

const label = (k: string, p: Prop) => p.title ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

/** Collect a form into the shape the role's Zod schema expects (empty optional fields are omitted). */
function collect(form: HTMLFormElement, props: Record<string, Prop>) {
  const fd = new FormData(form);
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(props)) {
    if (p.type === "array") out[k] = fd.getAll(k).map(String);
    else if (p.type === "number" || p.type === "integer") { const v = fd.get(k); if (v !== "" && v != null) out[k] = Number(v); }
    else { const v = String(fd.get(k) ?? "").trim(); if (v) out[k] = v; }
  }
  return out;
}

/** Task form generated from the role's input schema (z.toJSONSchema): text, select, checkboxes, artifact pickers. */
export function TaskForm({ slug, schema, refs, library, llm, defaults = {}, thenRole }: {
  slug: string;
  schema: { properties: Record<string, Prop>; required?: string[] };
  refs: Record<string, Option[]>;
  library: Record<string, Option[]>;
  llm: boolean;
  /** Prefilled values (e.g. the artifact a "Continue to…" link came from). */
  defaults?: Record<string, string>;
  /** Role that runs automatically on this task's output (Concept: Account Manager → Creative Director). */
  thenRole?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [est, setEst] = useState<Estimate | null>(null);
  const [confirm, setConfirm] = useState(false);
  const props = schema.properties;
  const required = new Set(schema.required ?? []);

  const act = (fn: () => Promise<unknown>) =>
    start(async () => {
      setError(null);
      try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const input = collect(form, props);
    if (!est && llm) return act(async () => setEst(await estimateTaskAction(slug, input, thenRole)));
    act(async () => {
      await requestTask(slug, input, confirm, thenRole);
      form.reset();
      setEst(null);
      setConfirm(false);
      router.refresh();
      form.closest("dialog")?.close();
    });
  };

  return (
    <form onSubmit={onSubmit} onChange={() => { setEst(null); setConfirm(false); }} className="space-y-4">
      {Object.entries(props).map(([k, p]) => {
        const id = `f-${k}`;
        const req = required.has(k);
        const choices = p.ref ? refs[p.ref] ?? [] : p.library ? library[p.library] ?? [] : p.items?.enum?.map((v) => ({ id: v, label: v })) ?? null;
        if (p.type === "array" && choices)
          return (
            <fieldset key={k}>
              <legend className="label">{label(k, p)}</legend>
              {!choices.length && <p className="text-sm text-ink-3">Nothing to pick yet.</p>}
              <div className="flex flex-wrap gap-2">
                {choices.map((c) => (
                  <label key={c.id} className="pill cursor-pointer border-line bg-white px-3.5 py-2 text-ink-2 has-checked:border-brand has-checked:bg-brand-soft has-checked:text-brand has-focus-visible:ring-2 has-focus-visible:ring-brand/40">
                    <input type="checkbox" name={k} value={c.id} className="sr-only" />{c.label}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        const select = p.ref ? refs[p.ref] ?? [] : p.enum?.map((v) => ({ id: v, label: v }));
        return (
          <label key={k} htmlFor={id} className="block">
            <span className="label">{label(k, p)}{!req && " (optional)"}</span>
            {select ? (
              <select id={id} name={k} required={req} defaultValue={defaults[k]} className="input">
                {!req || p.ref ? <option value="">{p.ref ? (select.length ? "— pick one —" : "— none yet —") : "—"}</option> : null}
                {select.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            ) : p.multiline ? (
              <textarea id={id} name={k} required={req} rows={3} defaultValue={defaults[k]} className="input" />
            ) : (
              <input id={id} name={k} required={req} defaultValue={defaults[k]} type={p.type === "number" || p.type === "integer" ? "number" : "text"} className="input" />
            )}
          </label>
        );
      })}

      {est && <EstimateNote est={est} confirm={confirm} setConfirm={setConfirm} />}
      {error && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-red-800">{error}</p>}
      <button disabled={pending || (!!est?.blocked && !confirm)} className="btn-primary">
        <span className="material-symbols-outlined">{est || !llm ? "play_arrow" : "calculate"}</span>
        {pending ? "Working…" : est || !llm ? "Run task" : "Estimate cost"}
      </button>
      {!llm && <p className="text-xs text-ink-2">Deterministic code, no AI call: US$0.</p>}
    </form>
  );
}

function EstimateNote({ est, confirm, setConfirm }: { est: Estimate; confirm: boolean; setConfirm: (v: boolean) => void }) {
  return (
    <div role="status" className={`rounded-2xl p-4 text-sm ${est.blocked ? "bg-amber-soft text-amber-900" : "bg-brand-soft text-ink"}`}>
      <p>
        Estimate: <strong>US${est.estUsd.toFixed(4)}</strong> (upper bound). Month: US${est.monthUsd.toFixed(2)} of US${est.monthCapUsd.toFixed(2)} cap.
      </p>
      {est.blocked && (
        <>
          <p className="mt-1">{est.reasons.join(" ")}</p>
          <label className="mt-2 flex items-center gap-2 font-semibold">
            <input type="checkbox" checked={confirm} onChange={(e) => { e.stopPropagation(); setConfirm(e.target.checked); }} /> Run anyway, over the cap
          </label>
        </>
      )}
    </div>
  );
}

/** Multi-agent feature: one pick, every role of the flow runs on it (estimate first, then run). */
export function FlowForm({ slug, label, options, defaultPick, runLabel }: { slug: string; label: string; options: Option[]; defaultPick?: string; runLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [est, setEst] = useState<Estimate | null>(null);
  const [confirm, setConfirm] = useState(false);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const pick = String(new FormData(e.currentTarget).get("pick") ?? "");
    start(async () => {
      setError(null);
      try {
        if (!est) return setEst(await estimateFlow(slug, pick));
        await runFlow(slug, pick, confirm);
        setEst(null);
        setConfirm(false);
        router.refresh();
      } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    });
  };
  return (
    <form onSubmit={onSubmit} onChange={() => { setEst(null); setConfirm(false); }} className="space-y-3">
      <label className="block">
        <span className="label">{label}</span>
        <select name="pick" required defaultValue={defaultPick} className="input">
          <option value="">{options.length ? "— pick one —" : "— none yet —"}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      {est && <EstimateNote est={est} confirm={confirm} setConfirm={setConfirm} />}
      {error && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-red-800">{error}</p>}
      <button disabled={pending || (!!est?.blocked && !confirm)} className="btn-primary">
        <span className="material-symbols-outlined">{est ? "play_arrow" : "calculate"}</span>
        {pending ? "Working…" : est ? runLabel : "Estimate cost"}
      </button>
    </form>
  );
}

export function ScrapButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button
        disabled={pending}
        aria-label="Scrap this queued task"
        title="Scrap: remove it before a worker picks it up"
        onClick={() => confirm("Scrap this queued task? It will be removed.") && start(async () => { try { await scrapTask(taskId); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } })}
        className="flex items-center gap-1 text-xs font-semibold text-red-700 hover:underline"
      >
        <span className="material-symbols-outlined !text-[16px]">delete</span>Scrap
      </button>
      {error && <span role="alert" className="ml-2 text-xs text-red-700">{error}</span>}
    </span>
  );
}

/** Trash icon on a batch: scraps it while queued, deletes it when done or failed. A running batch cannot go. */
export function DeleteBatchButton({ taskId, running, selected }: { taskId: string; running: boolean; selected: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending || running}
      aria-label="Delete this batch"
      title={running ? "Being written now: wait until it finishes" : "Delete this batch"}
      onClick={() => confirm("Delete this batch and its posts? This cannot be undone.") && start(async () => {
        try {
          await deleteBatch(taskId);
          // The open batch is gone: drop it from the address so the panel does not point at nothing.
          if (selected) router.replace(path, { scroll: false });
          router.refresh();
        } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
      })}
      className="flex size-8 items-center justify-center rounded-full text-ink-3 transition hover:bg-bad-soft hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="material-symbols-outlined !text-[18px]">{pending ? "progress_activity" : "delete"}</span>
    </button>
  );
}

export function RetryButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button
        disabled={pending}
        onClick={() => start(async () => { try { await retryTask(taskId); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } })}
        className="text-sm font-semibold text-brand hover:underline"
      >
        Retry
      </button>
      {error && <span role="alert" className="ml-2 text-xs text-red-700">{error}</span>}
    </span>
  );
}
